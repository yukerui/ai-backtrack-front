import { expect, test } from "@playwright/test";

type ChatRequestBody = {
  message?: {
    role?: string;
    parts?: Array<{
      type?: string;
      url?: string;
      name?: string;
      mediaType?: string;
    }>;
  };
  messages?: Array<{
    role?: string;
    parts?: Array<{
      type?: string;
      url?: string;
      name?: string;
      mediaType?: string;
    }>;
  }>;
};

function findLatestUserFilePart(body: ChatRequestBody) {
  const fromMessage =
    body?.message?.role === "user" && Array.isArray(body.message.parts)
      ? body.message.parts
      : [];

  const fromMessages = Array.isArray(body?.messages)
    ? [...body.messages]
        .reverse()
        .find((item) => item?.role === "user" && Array.isArray(item.parts))
        ?.parts || []
    : [];

  const parts = fromMessage.length > 0 ? fromMessage : fromMessages;
  return parts.find((part) => part?.type === "file");
}

test.describe("Attachment Upload", () => {
  test("shows backend upload error message", async ({ page }) => {
    await page.route("**/api/files/upload", async (route) => {
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({
          error: "Unsupported file type. Allowed: image/pdf/txt/md/csv/json/xls/xlsx",
        }),
      });
    });

    await page.goto("/");

    const fileInput = page.locator("input[type='file']");
    await fileInput.setInputFiles({
      name: "bad.exe",
      mimeType: "application/octet-stream",
      buffer: Buffer.from("MZ"),
    });

    await expect(page.getByText(/Unsupported file type/i).first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test("includes uploaded file in /api/chat request payload", async ({
    page,
  }) => {
    await page.route("**/api/files/upload", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          url: "https://blob.example.com/1700000000000-test.csv",
          pathname: "1700000000000-test.csv",
          contentType: "text/csv",
        }),
      });
    });

    let capturedBody: ChatRequestBody | null = null;
    await page.route("**/api/chat", async (route) => {
      capturedBody = route.request().postDataJSON() as ChatRequestBody;
      await route.fulfill({
        status: 200,
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "x-vercel-ai-data-stream": "v1",
        },
        body: "",
      });
    });

    await page.goto("/");

    const fileInput = page.locator("input[type='file']");
    await fileInput.setInputFiles({
      name: "test.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("d,p\n1,2\n"),
    });

    await expect(page.getByTestId("attachments-preview")).toBeVisible({
      timeout: 10_000,
    });

    await page.getByTestId("multimodal-input").fill("读取附件");
    await page.getByTestId("send-button").click();

    await expect
      .poll(() => Boolean(capturedBody), { timeout: 10_000 })
      .toBeTruthy();

    const filePart = findLatestUserFilePart(
      capturedBody as unknown as ChatRequestBody
    );
    expect(filePart).toBeTruthy();
    expect(filePart?.url).toBe("https://blob.example.com/1700000000000-test.csv");
    expect(filePart?.name).toBe("1700000000000-test.csv");
    expect(filePart?.mediaType).toBe("text/csv");
  });
});
