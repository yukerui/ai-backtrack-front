import assert from "node:assert/strict";
import test from "node:test";
import {
  decideTaskRecovery,
  shouldRefreshRealtimeTokenOnError,
  shouldRetryRealtimeStreamError,
} from "../../lib/task-recovery";

test("missing realtime token should fallback to polling when cursor signature exists", () => {
  const decision = decideTaskRecovery({
    reason: "missing_realtime",
    hasCursorSig: true,
  });

  assert.equal(decision.shouldStartPolling, true);
});

test("realtime stream error should fallback to polling when cursor signature exists", () => {
  const decision = decideTaskRecovery({
    reason: "realtime_stream_error",
    hasCursorSig: true,
  });

  assert.equal(decision.shouldStartPolling, true);
});

test("realtime status error should fallback to polling when cursor signature exists", () => {
  const decision = decideTaskRecovery({
    reason: "realtime_status_error",
    hasCursorSig: true,
  });

  assert.equal(decision.shouldStartPolling, true);
});

test("should keep manual recovery when cursor signature is missing", () => {
  const decision = decideTaskRecovery({
    reason: "realtime_stream_error",
    hasCursorSig: false,
  });

  assert.equal(decision.shouldStartPolling, false);
});

test("should retry realtime stream when stream is not ready yet", () => {
  assert.equal(
    shouldRetryRealtimeStreamError(new Error("404 stream not found")),
    true
  );
  assert.equal(
    shouldRetryRealtimeStreamError(
      new Error("Could not fetch stream: status=404")
    ),
    true
  );
  assert.equal(
    shouldRetryRealtimeStreamError(
      new Error("403 Could not subscribe to stream")
    ),
    true
  );
});

test("should not retry realtime stream on auth failure", () => {
  assert.equal(
    shouldRetryRealtimeStreamError(new Error("401 unauthorized")),
    false
  );
});

test("should detect realtime token expired from direct error message", () => {
  assert.equal(
    shouldRefreshRealtimeTokenOnError(
      new Error(
        "Public Access Token has expired. See https://trigger.dev/docs/frontend/overview#authentication for more information."
      )
    ),
    true
  );
});

test("should detect realtime token expired from nested api error payload", () => {
  assert.equal(
    shouldRefreshRealtimeTokenOnError({
      status: 401,
      body: {
        error:
          "Public Access Token has expired. See https://trigger.dev/docs/frontend/overview#authentication for more information.",
      },
      message: "Unauthorized",
    }),
    true
  );
});

test("should not treat non-expired permission errors as refreshable", () => {
  assert.equal(
    shouldRefreshRealtimeTokenOnError(
      new Error(
        "Unauthorized: Public Access Token is missing required permissions."
      )
    ),
    false
  );
});
