import assert from "node:assert/strict";
import test from "node:test";

import { createUploadHandler } from "./upload-handler";

function buildRequestWithCsv() {
  const formData = new FormData();
  formData.append(
    "file",
    new File(["c1,c2\n1,2\n"], "sample.csv", {
      type: "text/csv",
    })
  );

  return new Request("http://localhost/api/files/upload", {
    method: "POST",
    body: formData,
  });
}

test("returns clear config error when blob token is missing", async () => {
  let putCalled = false;

  const handler = createUploadHandler({
    authResolver: async () => ({ user: { id: "u1" } }),
    putBlob: async () => {
      putCalled = true;
      throw new Error(
        "Vercel Blob: No token found. Either configure the BLOB_READ_WRITE_TOKEN environment variable, or pass a token option to your calls."
      );
    },
    now: () => 1700000000000,
    getBlobToken: () => "",
  });

  const response = await handler(buildRequestWithCsv());
  const payload = (await response.json()) as { error?: string };

  assert.equal(response.status, 500);
  assert.match(payload.error ?? "", /BLOB_READ_WRITE_TOKEN/i);
  assert.equal(putCalled, false);
});

test("uses fallback token resolver and passes token to Vercel Blob", async () => {
  let receivedToken = "";

  const handler = createUploadHandler({
    authResolver: async () => ({ user: { id: "u1" } }),
    putBlob: async (_name, _data, options) => {
      receivedToken = options.token ?? "";
      return {
        url: "https://blob.example.com/1700000000000-sample.csv",
        pathname: "1700000000000-sample.csv",
        contentType: "text/csv",
      };
    },
    now: () => 1700000000000,
    getBlobToken: () => "blob_test_token",
  });

  const response = await handler(buildRequestWithCsv());
  const payload = (await response.json()) as {
    url?: string;
    pathname?: string;
    contentType?: string;
  };

  assert.equal(response.status, 200);
  assert.equal(receivedToken, "blob_test_token");
  assert.equal(payload.pathname, "1700000000000-sample.csv");
  assert.equal(payload.contentType, "text/csv");
});
