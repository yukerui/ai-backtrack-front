import assert from "node:assert/strict";
import test from "node:test";
import { decideTaskRecovery } from "../../lib/task-recovery";

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
