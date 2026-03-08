import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_TRIGGER_REALTIME_TIMEOUT_SECONDS,
  MAX_TRIGGER_REALTIME_TIMEOUT_SECONDS,
  normalizeRealtimeTimeoutSeconds,
} from "../../lib/realtime-timeout";

test("normalizeRealtimeTimeoutSeconds should cap value to trigger max", () => {
  const normalized = normalizeRealtimeTimeoutSeconds(1800);
  assert.equal(normalized, MAX_TRIGGER_REALTIME_TIMEOUT_SECONDS);
});

test("normalizeRealtimeTimeoutSeconds should return parsed positive value", () => {
  const normalized = normalizeRealtimeTimeoutSeconds("120");
  assert.equal(normalized, 120);
});

test("normalizeRealtimeTimeoutSeconds should fallback for invalid values", () => {
  const normalized = normalizeRealtimeTimeoutSeconds(
    "invalid",
    DEFAULT_TRIGGER_REALTIME_TIMEOUT_SECONDS
  );
  assert.equal(normalized, DEFAULT_TRIGGER_REALTIME_TIMEOUT_SECONDS);
});
