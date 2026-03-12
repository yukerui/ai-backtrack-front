import assert from "node:assert/strict";
import test from "node:test";

import { ChatSDKError, getClientErrorMessage } from "../../lib/errors";

test("getClientErrorMessage returns friendly ChatSDKError message", () => {
  const error = new ChatSDKError("offline:chat", "upstream timeout");

  assert.equal(
    getClientErrorMessage(error),
    "We're having trouble sending your message. Please check your internet connection and try again."
  );
});

test("getClientErrorMessage preserves plain Error messages", () => {
  const error = new Error(
    "Claude proxy precheck failed (500): upstream timeout"
  );

  assert.equal(
    getClientErrorMessage(error),
    "Claude proxy precheck failed (500): upstream timeout"
  );
});

test("getClientErrorMessage preserves object message fields", () => {
  assert.equal(
    getClientErrorMessage({
      message: "Request precheck failed. Please try again.",
    }),
    "Request precheck failed. Please try again."
  );
});

test("getClientErrorMessage falls back to generic message", () => {
  assert.equal(
    getClientErrorMessage({}),
    "Something went wrong. Please try again later."
  );
});
