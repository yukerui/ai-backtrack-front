import assert from "node:assert/strict";
import test from "node:test";
import {
  getTriggerAccounts,
  pickNextTriggerAccount,
  resetTriggerAccountCacheForTests,
  resolveTriggerAccountById,
  toTriggerClientConfig,
} from "../../lib/trigger-accounts";

type EnvValue = string | undefined;

async function withEnv(
  entries: Record<string, EnvValue>,
  run: () => Promise<void> | void
) {
  const keys = Object.keys(entries);
  const snapshot = new Map<string, EnvValue>(
    keys.map((key) => [key, process.env[key]])
  );
  for (const [key, value] of Object.entries(entries)) {
    if (typeof value === "string") {
      process.env[key] = value;
      continue;
    }
    delete process.env[key];
  }

  resetTriggerAccountCacheForTests();
  try {
    await run();
  } finally {
    for (const [key, value] of snapshot.entries()) {
      if (typeof value === "string") {
        process.env[key] = value;
        continue;
      }
      delete process.env[key];
    }
    resetTriggerAccountCacheForTests();
  }
}

test("should fallback to legacy single trigger account when multi config is missing", async () => {
  await withEnv(
    {
      TRIGGER_ACCOUNTS_JSON: undefined,
      TRIGGER_SECRET_KEY: "tr_test_single",
      TRIGGER_API_URL: "https://api.trigger.dev",
      TRIGGER_ROUND_ROBIN_MEMORY_ONLY: "true",
    },
    async () => {
      const accounts = getTriggerAccounts();
      assert.equal(accounts.length, 1);
      assert.equal(accounts[0].id, "default");
      assert.equal(accounts[0].accessToken, "tr_test_single");
      assert.equal(accounts[0].apiUrl, "https://api.trigger.dev");

      const picked = await pickNextTriggerAccount("fund-chat-task");
      assert.equal(picked.id, "default");
    }
  );
});

test("should rotate across multiple trigger accounts by weight", async () => {
  await withEnv(
    {
      TRIGGER_SECRET_KEY: undefined,
      TRIGGER_API_URL: undefined,
      TRIGGER_ROUND_ROBIN_MEMORY_ONLY: "true",
      TRIGGER_ACCOUNTS_JSON: JSON.stringify([
        {
          id: "acc_a",
          apiUrl: "https://api.trigger.dev",
          accessToken: "tr_a",
          weight: 1,
        },
        {
          id: "acc_b",
          apiUrl: "https://api.trigger.dev",
          accessToken: "tr_b",
          weight: 2,
        },
      ]),
    },
    async () => {
      const picked1 = await pickNextTriggerAccount("fund-chat-task");
      const picked2 = await pickNextTriggerAccount("fund-chat-task");
      const picked3 = await pickNextTriggerAccount("fund-chat-task");
      const picked4 = await pickNextTriggerAccount("fund-chat-task");
      assert.deepEqual(
        [picked1.id, picked2.id, picked3.id, picked4.id],
        ["acc_a", "acc_b", "acc_b", "acc_a"]
      );

      const byId = resolveTriggerAccountById("acc_b");
      assert.equal(byId?.id, "acc_b");
      assert.equal(byId?.accessToken, "tr_b");
      assert.deepEqual(toTriggerClientConfig(byId!), {
        baseURL: "https://api.trigger.dev",
        accessToken: "tr_b",
      });
    }
  );
});
