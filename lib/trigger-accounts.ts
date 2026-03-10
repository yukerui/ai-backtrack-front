const DEFAULT_TRIGGER_API_URL = "https://api.trigger.dev";
const DEFAULT_TRIGGER_ACCOUNT_ID = "default";
const ROUND_ROBIN_KEY_PREFIX = "trigger:account:rr:";
const DEFAULT_WEIGHT = 1;

type TriggerAccountJson = {
  id?: unknown;
  apiUrl?: unknown;
  accessToken?: unknown;
  weight?: unknown;
  enabled?: unknown;
};

export type TriggerAccount = {
  id: string;
  apiUrl: string;
  accessToken: string;
  weight: number;
};

let memoryRoundRobinCounter = 0;
let cachedAccounts: TriggerAccount[] | null = null;

function toPositiveInt(value: unknown, fallback: number) {
  const parsed =
    typeof value === "number"
      ? Math.trunc(value)
      : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function normalizeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeAccount(raw: TriggerAccountJson, index: number) {
  const enabled =
    typeof raw.enabled === "boolean" ? raw.enabled : raw.enabled !== "false";
  if (!enabled) {
    return null;
  }

  const id = normalizeString(raw.id) || `account_${index + 1}`;
  const apiUrl = normalizeString(raw.apiUrl) || DEFAULT_TRIGGER_API_URL;
  const accessToken = normalizeString(raw.accessToken);
  if (!accessToken) {
    throw new Error(`Invalid TRIGGER_ACCOUNTS_JSON: accessToken missing for ${id}`);
  }

  return {
    id,
    apiUrl,
    accessToken,
    weight: toPositiveInt(raw.weight, DEFAULT_WEIGHT),
  } satisfies TriggerAccount;
}

function parseAccountsFromJson(rawJson: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson) as unknown;
  } catch (error) {
    throw new Error(
      `Invalid TRIGGER_ACCOUNTS_JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  if (!Array.isArray(parsed)) {
    throw new Error("Invalid TRIGGER_ACCOUNTS_JSON: must be a JSON array");
  }

  const accounts = parsed
    .map((item, index) => normalizeAccount(item as TriggerAccountJson, index))
    .filter((item): item is TriggerAccount => Boolean(item));

  if (accounts.length === 0) {
    throw new Error("Invalid TRIGGER_ACCOUNTS_JSON: no enabled accounts");
  }
  return accounts;
}

function getLegacySingleAccount() {
  const accessToken = normalizeString(process.env.TRIGGER_SECRET_KEY);
  if (!accessToken) {
    throw new Error("Missing TRIGGER_SECRET_KEY");
  }

  return {
    id: DEFAULT_TRIGGER_ACCOUNT_ID,
    apiUrl: normalizeString(process.env.TRIGGER_API_URL) || DEFAULT_TRIGGER_API_URL,
    accessToken,
    weight: DEFAULT_WEIGHT,
  } satisfies TriggerAccount;
}

function buildWeightedAccounts(accounts: TriggerAccount[]) {
  return accounts.flatMap((account) =>
    Array.from({ length: account.weight }, () => account)
  );
}

function getAccountsInternal() {
  if (cachedAccounts) {
    return cachedAccounts;
  }

  const rawJson = normalizeString(process.env.TRIGGER_ACCOUNTS_JSON);
  if (!rawJson) {
    cachedAccounts = [getLegacySingleAccount()];
    return cachedAccounts;
  }

  cachedAccounts = parseAccountsFromJson(rawJson);
  return cachedAccounts;
}

export function resetTriggerAccountCacheForTests() {
  cachedAccounts = null;
  memoryRoundRobinCounter = 0;
}

export function getTriggerAccounts() {
  return getAccountsInternal();
}

export function resolveTriggerAccountById(accountId?: string | null) {
  const accounts = getAccountsInternal();
  if (!accountId) {
    return accounts[0] || null;
  }
  return accounts.find((item) => item.id === accountId) || null;
}

export function toTriggerClientConfig(account: TriggerAccount) {
  return {
    baseURL: account.apiUrl,
    accessToken: account.accessToken,
  };
}

function isMemoryRoundRobinForced() {
  return (
    normalizeString(process.env.TRIGGER_ROUND_ROBIN_MEMORY_ONLY).toLowerCase() ===
    "true"
  );
}

async function getRoundRobinIndex(scope: string, weightedLength: number) {
  if (weightedLength <= 0) {
    return 0;
  }
  if (isMemoryRoundRobinForced()) {
    const index = memoryRoundRobinCounter % weightedLength;
    memoryRoundRobinCounter += 1;
    return index;
  }
  const redisModule = await import("./redis");
  if (!redisModule.isRedisConfigured()) {
    const index = memoryRoundRobinCounter % weightedLength;
    memoryRoundRobinCounter += 1;
    return index;
  }
  const counter = await redisModule
    .getRedisClient()
    .incr(`${ROUND_ROBIN_KEY_PREFIX}${scope}`);
  return (Math.max(counter, 1) - 1) % weightedLength;
}

export async function pickNextTriggerAccount(scope = "default") {
  const weightedAccounts = buildWeightedAccounts(getAccountsInternal());
  if (weightedAccounts.length === 1) {
    return weightedAccounts[0];
  }
  const index = await getRoundRobinIndex(scope, weightedAccounts.length);
  return weightedAccounts[index] || weightedAccounts[0];
}
