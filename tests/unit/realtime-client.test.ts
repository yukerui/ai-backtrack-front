import assert from "node:assert/strict";
import test from "node:test";

import {
  readRealtimeRunStream,
  subscribeRealtimeRunStatus,
} from "../../lib/realtime-client";

test("legacy global configure race can mismatch run and token", async () => {
  let activeToken = "";

  const configure = (token: string) => {
    activeToken = token;
  };

  const subscribeLegacy = async (runId: string) => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    return { runId, tokenUsed: activeToken };
  };

  const runA = (async () => {
    configure("tokenA");
    return subscribeLegacy("runA");
  })();

  const runB = (async () => {
    configure("tokenB");
    return subscribeLegacy("runB");
  })();

  const [resultA, resultB] = await Promise.all([runA, runB]);

  assert.equal(resultB.tokenUsed, "tokenB");
  assert.notEqual(
    resultA.tokenUsed,
    "tokenA",
    "legacy global configure may cause runA to read tokenB"
  );
});

test("readRealtimeRunStream should call withAuth using run-scoped token", async () => {
  const withAuthCalls: Array<{ baseURL: string; accessToken: string }> = [];
  const readCalls: Array<{ runId: string; streamId: string }> = [];

  const streamResult = Symbol("stream");
  const result = await readRealtimeRunStream({
    runId: "run_1",
    streamId: "fund-chat-realtime",
    signal: undefined,
    timeoutInSeconds: 30,
    realtime: {
      apiUrl: "https://api.trigger.dev",
      publicAccessToken: "token_run_1",
    },
    withAuth: async (config, fn) => {
      withAuthCalls.push(config);
      return fn();
    },
    readStream: async (runId, streamId) => {
      readCalls.push({ runId, streamId });
      return streamResult as unknown;
    },
  });

  assert.equal(result, streamResult);
  assert.deepEqual(withAuthCalls, [
    { baseURL: "https://api.trigger.dev", accessToken: "token_run_1" },
  ]);
  assert.deepEqual(readCalls, [
    { runId: "run_1", streamId: "fund-chat-realtime" },
  ]);
});

test("subscribeRealtimeRunStatus should call withAuth using run-scoped token", async () => {
  const withAuthCalls: Array<{ baseURL: string; accessToken: string }> = [];
  const subscribeCalls: Array<{ runId: string; skipColumns: string[] }> = [];

  const subscription = {
    unsubscribe: () => {
      return;
    },
    [Symbol.asyncIterator]: async function* () {
      yield { id: "run_2", isCompleted: false, isFailed: false, status: "RUNNING" };
    },
  };

  const result = await subscribeRealtimeRunStatus({
    runId: "run_2",
    realtime: {
      apiUrl: "https://api.trigger.dev",
      publicAccessToken: "token_run_2",
    },
    skipColumns: ["payload", "output"],
    withAuth: async (config, fn) => {
      withAuthCalls.push(config);
      return fn();
    },
    subscribeToRun: (runId, options) => {
      subscribeCalls.push({
        runId,
        skipColumns: [...(options?.skipColumns ?? [])],
      });
      return subscription;
    },
  });

  assert.equal(result, subscription);
  assert.deepEqual(withAuthCalls, [
    { baseURL: "https://api.trigger.dev", accessToken: "token_run_2" },
  ]);
  assert.deepEqual(subscribeCalls, [
    { runId: "run_2", skipColumns: ["payload", "output"] },
  ]);
});
