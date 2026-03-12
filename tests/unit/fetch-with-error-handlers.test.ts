import assert from "node:assert/strict";
import test from "node:test";

import { ChatSDKError } from "../../lib/errors";
import { fetchWithErrorHandlers } from "../../lib/utils";

const originalFetch = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("fetchWithErrorHandlers converts text error responses into ChatSDKError", async () => {
  globalThis.fetch = async () =>
    new Response("Claude proxy precheck failed (500): upstream timeout", {
      status: 500,
      headers: {
        "content-type": "text/plain; charset=utf-8",
      },
    });

  await assert.rejects(
    () => fetchWithErrorHandlers("http://localhost/api/chat"),
    (error: unknown) => {
      assert.ok(error instanceof ChatSDKError);
      assert.equal(error.type, "offline");
      assert.equal(error.surface, "chat");
      assert.match(String(error.cause ?? ""), /upstream timeout/i);
      return true;
    }
  );
});

test("fetchWithErrorHandlers converts empty upstream errors into ChatSDKError", async () => {
  globalThis.fetch = async () =>
    new Response(null, {
      status: 502,
      statusText: "Bad Gateway",
    });

  await assert.rejects(
    () => fetchWithErrorHandlers("http://localhost/api/chat"),
    (error: unknown) => {
      assert.ok(error instanceof ChatSDKError);
      assert.equal(error.type, "offline");
      assert.equal(error.surface, "chat");
      assert.match(String(error.cause ?? ""), /bad gateway/i);
      return true;
    }
  );
});
