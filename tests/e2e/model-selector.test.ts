import { expect, test } from "@playwright/test";

const MODEL_BUTTON_REGEX = /Gemini|Claude|GPT|Grok/i;

test.describe("Model Selector", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("does not display model selector controls", async ({ page }) => {
    const modelButton = page
      .locator("button")
      .filter({ hasText: MODEL_BUTTON_REGEX });
    await expect(modelButton).toHaveCount(0);
    await expect(page.getByPlaceholder("Search models...")).toHaveCount(0);
  });

  test("message send still works without selector", async ({ page }) => {
    const input = page.getByTestId("multimodal-input");
    await input.fill("hello without selector");
    await page.getByTestId("send-button").click();
    await expect(page).toHaveURL(/\/chat\/[\w-]+/, { timeout: 10_000 });
  });
});
