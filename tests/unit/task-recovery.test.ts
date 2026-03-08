import assert from "node:assert/strict";
import test from "node:test";
import {
  decideTaskRecovery,
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
