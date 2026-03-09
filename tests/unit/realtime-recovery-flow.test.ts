import assert from "node:assert/strict";
import test from "node:test";
import { runRealtimeOperationWithRecovery } from "../../lib/realtime-recovery-flow";
import {
  shouldRefreshRealtimeTokenOnError,
  shouldRetryRealtimeStreamError,
} from "../../lib/task-recovery";

const EXPIRED_TOKEN_MESSAGE =
  "Public Access Token has expired. See https://trigger.dev/docs/frontend/overview#authentication for more information.";

function createWaitCollector() {
  const waits: number[] = [];
  return {
    waits,
    wait: async (ms: number) => {
      waits.push(ms);
    },
  };
}

test("realtime chain should recover when auth error only exposes string status", async () => {
  let streamAttempts = 0;
  let statusAttempts = 0;
  let refreshCalls = 0;
  const waitCollector = createWaitCollector();

  const refreshToken = async () => {
    refreshCalls += 1;
    return true;
  };

  const streamResult = await runRealtimeOperationWithRecovery<string>({
    runOperation: async () => {
      streamAttempts += 1;
      if (streamAttempts === 1) {
        throw Object.assign(new Error("Unauthorized"), {
          response: { status: "401" },
        });
      }
      return "stream_ok";
    },
    shouldRefreshToken: shouldRefreshRealtimeTokenOnError,
    shouldRetry: shouldRetryRealtimeStreamError,
    refreshToken,
    isActive: () => true,
    wait: waitCollector.wait,
    refreshRetryDelayMs: 25,
    retryDelayMs: 10,
  });
  assert.equal(streamResult.ok, true);
  assert.equal(streamAttempts, 2);

  const statusResult = await runRealtimeOperationWithRecovery<string>({
    runOperation: async () => {
      statusAttempts += 1;
      if (statusAttempts === 1) {
        throw Object.assign(new Error("Unauthorized"), {
          response: { status: "401" },
        });
      }
      return "completed";
    },
    shouldRefreshToken: shouldRefreshRealtimeTokenOnError,
    shouldRetry: () => false,
    refreshToken,
    isActive: () => true,
    wait: waitCollector.wait,
    refreshRetryDelayMs: 25,
    retryDelayMs: 10,
  });

  assert.equal(statusResult.ok, true);
  assert.equal(statusAttempts, 2);
  assert.equal(refreshCalls, 2);
  assert.deepEqual(waitCollector.waits, [25, 25]);
});

test("realtime chain should recover from explicit expired token message", async () => {
  let attempts = 0;
  let refreshCalls = 0;
  const waitCollector = createWaitCollector();

  const result = await runRealtimeOperationWithRecovery<string>({
    runOperation: async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error(EXPIRED_TOKEN_MESSAGE);
      }
      return "ok";
    },
    shouldRefreshToken: shouldRefreshRealtimeTokenOnError,
    shouldRetry: shouldRetryRealtimeStreamError,
    refreshToken: async () => {
      refreshCalls += 1;
      return true;
    },
    isActive: () => true,
    wait: waitCollector.wait,
    refreshRetryDelayMs: 30,
    retryDelayMs: 15,
  });

  assert.equal(result.ok, true);
  assert.equal(refreshCalls, 1);
  assert.deepEqual(waitCollector.waits, [30]);
});

test("realtime chain should fail fast when token refresh fails", async () => {
  const result = await runRealtimeOperationWithRecovery<string>({
    runOperation: async () => {
      throw new Error(EXPIRED_TOKEN_MESSAGE);
    },
    shouldRefreshToken: shouldRefreshRealtimeTokenOnError,
    shouldRetry: shouldRetryRealtimeStreamError,
    refreshToken: async () => false,
    isActive: () => true,
    wait: async () => {},
    refreshRetryDelayMs: 30,
    retryDelayMs: 15,
  });

  assert.equal(result.ok, false);
});

test("single operation should recover after two 401 errors and succeed on third attempt", async () => {
  let attempts = 0;
  let refreshCalls = 0;
  const waitCollector = createWaitCollector();

  const result = await runRealtimeOperationWithRecovery<string>({
    runOperation: async () => {
      attempts += 1;
      if (attempts <= 2) {
        throw Object.assign(new Error("Unauthorized"), {
          response: { status: "401 Unauthorized" },
        });
      }
      return "ok_after_double_refresh";
    },
    shouldRefreshToken: shouldRefreshRealtimeTokenOnError,
    shouldRetry: () => false,
    refreshToken: async () => {
      refreshCalls += 1;
      return true;
    },
    isActive: () => true,
    wait: waitCollector.wait,
    refreshRetryDelayMs: 40,
    retryDelayMs: 15,
    maxRefreshAttempts: 2,
  });

  assert.equal(result.ok, true);
  assert.equal(attempts, 3);
  assert.equal(refreshCalls, 2);
  assert.deepEqual(waitCollector.waits, [40, 40]);
});
