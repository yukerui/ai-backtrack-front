import assert from "node:assert/strict";
import test from "node:test";
import { ChatSDKError } from "../lib/errors";
import { shouldRejectByDailyQuota } from "../app/(chat)/api/chat/quota-guard";

test("returns false when quota is disabled", async () => {
  let called = false;
  const shouldReject = await shouldRejectByDailyQuota({
    disabled: true,
    userId: "user-1",
    maxMessagesPerDay: 1,
    getMessageCountByUserId: async () => {
      called = true;
      return 100;
    },
  });

  assert.equal(shouldReject, false);
  assert.equal(called, false);
});

test("returns true when message count exceeds quota", async () => {
  const shouldReject = await shouldRejectByDailyQuota({
    disabled: false,
    userId: "user-1",
    maxMessagesPerDay: 5,
    getMessageCountByUserId: async () => 6,
  });

  assert.equal(shouldReject, true);
});

test("returns false when quota query hits database error", async () => {
  let warning = "";
  const shouldReject = await shouldRejectByDailyQuota({
    disabled: false,
    userId: "user-1",
    maxMessagesPerDay: 5,
    getMessageCountByUserId: async () => {
      throw new ChatSDKError(
        "bad_request:database",
        "Failed to get message count by user id"
      );
    },
    logger: {
      warn: (message: string) => {
        warning = message;
      },
    },
  });

  assert.equal(shouldReject, false);
  assert.match(warning, /skip daily quota check/i);
});

test("rethrows non-database errors", async () => {
  await assert.rejects(
    shouldRejectByDailyQuota({
      disabled: false,
      userId: "user-1",
      maxMessagesPerDay: 5,
      getMessageCountByUserId: async () => {
        throw new Error("boom");
      },
    }),
    /boom/
  );
});
