import "server-only";
import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { TASK_SESSION_COOKIE_NAME } from "./constants";
import { getRedisClient } from "./redis";

const TASK_OWNER_KEY_PREFIX = "task:owner:";
const TASK_MESSAGE_KEY_PREFIX = "task:message:";
const TASK_CURSOR_VALUE_KEY_PREFIX = "task:cursor:value:";
const TASK_CURSOR_SIG_KEY_PREFIX = "task:cursor:sig:";
const DEFAULT_TASK_OWNER_TTL_SECONDS = 2 * 60 * 60;
const DEFAULT_TASK_CURSOR_TOKEN_TTL_SECONDS = 2 * 60;

export type TaskRunOwnerRecord = {
  userId: string;
  sidHash: string;
  createdAt: number;
};

type TaskCursorClaims = {
  r: string;
  s: string;
  c: number;
  e: number;
  n: string;
};

function parsePositiveInt(value: string | undefined, fallback: number) {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function encodeBase64UrlJson(value: unknown) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeBase64UrlJson(value: string) {
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
  } catch {
    return null;
  }
}

function secureEquals(a: string, b: string) {
  const aBytes = Buffer.from(a, "utf8");
  const bBytes = Buffer.from(b, "utf8");
  if (aBytes.length !== bBytes.length) {
    return false;
  }
  return timingSafeEqual(aBytes, bBytes);
}

function getTaskCursorSigningSecret() {
  const secret = process.env.TASK_CURSOR_SIGNING_SECRET || process.env.AUTH_SECRET || "";
  if (!secret) {
    throw new Error("Missing TASK_CURSOR_SIGNING_SECRET (or AUTH_SECRET)");
  }
  return secret;
}

function taskOwnerKey(runId: string) {
  return `${TASK_OWNER_KEY_PREFIX}${runId}`;
}

function taskMessageKey(runId: string) {
  return `${TASK_MESSAGE_KEY_PREFIX}${runId}`;
}

function taskCursorValueKey(runId: string, sidHash: string) {
  return `${TASK_CURSOR_VALUE_KEY_PREFIX}${runId}:${sidHash}`;
}

function taskCursorSigKey(runId: string, sidHash: string) {
  return `${TASK_CURSOR_SIG_KEY_PREFIX}${runId}:${sidHash}`;
}

export function getTaskOwnerTtlSeconds() {
  return parsePositiveInt(
    process.env.TASK_OWNER_TTL_SECONDS,
    DEFAULT_TASK_OWNER_TTL_SECONDS
  );
}

export function getTaskCursorTokenTtlSeconds() {
  return parsePositiveInt(
    process.env.TASK_CURSOR_TOKEN_TTL_SECONDS,
    DEFAULT_TASK_CURSOR_TOKEN_TTL_SECONDS
  );
}

export function parseCookieValue(cookieHeader: string | null, key: string) {
  if (!cookieHeader) {
    return "";
  }
  const items = cookieHeader.split(";").map((x) => x.trim());
  for (const item of items) {
    if (!item.startsWith(`${key}=`)) {
      continue;
    }
    return decodeURIComponent(item.slice(key.length + 1));
  }
  return "";
}

export function readTaskSessionIdFromCookieHeader(cookieHeader: string | null) {
  return parseCookieValue(cookieHeader, TASK_SESSION_COOKIE_NAME);
}

export function hashTaskSessionId(sessionId: string) {
  return createHash("sha256").update(sessionId).digest("hex");
}

export function signTaskCursor({
  runId,
  sidHash,
  cursor,
  ttlSeconds = getTaskCursorTokenTtlSeconds(),
}: {
  runId: string;
  sidHash: string;
  cursor: number;
  ttlSeconds?: number;
}) {
  const now = Math.floor(Date.now() / 1000);
  const claims: TaskCursorClaims = {
    r: runId,
    s: sidHash,
    c: cursor,
    e: now + ttlSeconds,
    n: randomBytes(8).toString("base64url"),
  };
  const encodedClaims = encodeBase64UrlJson(claims);
  const signature = createHmac("sha256", getTaskCursorSigningSecret())
    .update(encodedClaims)
    .digest("base64url");
  return `${encodedClaims}.${signature}`;
}

export function verifyTaskCursorSignature({
  token,
  runId,
  sidHash,
  cursor,
}: {
  token: string;
  runId: string;
  sidHash: string;
  cursor: number;
}) {
  if (!token || !runId || !sidHash) {
    return false;
  }

  const [encodedClaims, signature] = token.split(".", 2);
  if (!encodedClaims || !signature) {
    return false;
  }

  const expectedSignature = createHmac("sha256", getTaskCursorSigningSecret())
    .update(encodedClaims)
    .digest("base64url");
  if (!secureEquals(signature, expectedSignature)) {
    return false;
  }

  const decoded = decodeBase64UrlJson(encodedClaims);
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
    return false;
  }

  const claims = decoded as Partial<TaskCursorClaims>;
  if (
    claims.r !== runId ||
    claims.s !== sidHash ||
    claims.c !== cursor ||
    typeof claims.e !== "number" ||
    typeof claims.n !== "string"
  ) {
    return false;
  }

  return claims.e >= Math.floor(Date.now() / 1000);
}

export async function saveTaskRunOwner({
  runId,
  userId,
  sidHash,
  ttlSeconds = getTaskOwnerTtlSeconds(),
}: {
  runId: string;
  userId: string;
  sidHash: string;
  ttlSeconds?: number;
}) {
  const client = getRedisClient();
  const value: TaskRunOwnerRecord = {
    userId,
    sidHash,
    createdAt: Date.now(),
  };
  await client.set(taskOwnerKey(runId), value, { ex: ttlSeconds });
}

export async function getTaskRunOwner(runId: string) {
  const client = getRedisClient();
  const raw = await client.get<unknown>(taskOwnerKey(runId));
  if (!raw) {
    return null;
  }

  let parsed: Partial<TaskRunOwnerRecord> | null = null;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw) as Partial<TaskRunOwnerRecord>;
    } catch {
      return null;
    }
  } else if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    parsed = raw as Partial<TaskRunOwnerRecord>;
  }

  if (
    !parsed ||
    typeof parsed.userId !== "string" ||
    typeof parsed.sidHash !== "string" ||
    typeof parsed.createdAt !== "number"
  ) {
    return null;
  }
  return parsed as TaskRunOwnerRecord;
}

export async function saveTaskRunMessageId({
  runId,
  messageId,
  ttlSeconds = getTaskOwnerTtlSeconds(),
}: {
  runId: string;
  messageId: string;
  ttlSeconds?: number;
}) {
  const client = getRedisClient();
  await client.set(taskMessageKey(runId), messageId, { ex: ttlSeconds });
}

export async function getTaskRunMessageId(runId: string) {
  const client = getRedisClient();
  const raw = await client.get<unknown>(taskMessageKey(runId));
  if (typeof raw !== "string" || !raw) {
    return null;
  }
  return raw;
}

export async function initializeTaskCursorState({
  runId,
  sidHash,
  cursor,
  cursorSig,
  ttlSeconds = getTaskOwnerTtlSeconds(),
}: {
  runId: string;
  sidHash: string;
  cursor: number;
  cursorSig: string;
  ttlSeconds?: number;
}) {
  const client = getRedisClient();
  await Promise.all([
    client.set(taskCursorValueKey(runId, sidHash), String(cursor), {
      ex: ttlSeconds,
    }),
    client.set(taskCursorSigKey(runId, sidHash), cursorSig, {
      ex: ttlSeconds,
    }),
  ]);
}

export async function getTaskCursorState({
  runId,
  sidHash,
}: {
  runId: string;
  sidHash: string;
}) {
  const client = getRedisClient();
  const [cursorRaw, sig] = await Promise.all([
    client.get<unknown>(taskCursorValueKey(runId, sidHash)),
    client.get<unknown>(taskCursorSigKey(runId, sidHash)),
  ]);
  if (cursorRaw === null || cursorRaw === undefined || typeof sig !== "string" || !sig) {
    return null;
  }
  const cursor =
    typeof cursorRaw === "number" ? Math.trunc(cursorRaw) : Number.parseInt(String(cursorRaw), 10);
  if (!Number.isFinite(cursor) || cursor < 0) {
    return null;
  }
  return { cursor, sig };
}

export async function compareAndSwapTaskCursorState({
  runId,
  sidHash,
  expectedCursor,
  expectedSig,
  nextCursor,
  nextSig,
  ttlSeconds = getTaskOwnerTtlSeconds(),
}: {
  runId: string;
  sidHash: string;
  expectedCursor: number;
  expectedSig: string;
  nextCursor: number;
  nextSig: string;
  ttlSeconds?: number;
}) {
  const client = getRedisClient();
  const result = await (
    client as unknown as {
      eval: (
        script: string,
        keys: string[],
        args: string[]
      ) => Promise<unknown>;
    }
  ).eval(
    // CAS both cursor and signature to prevent replay and enforce monotonic polling.
    'local c=redis.call("GET",KEYS[1]); local s=redis.call("GET",KEYS[2]); if (not c) or (not s) then return -1 end; if c~=ARGV[1] then return 0 end; if s~=ARGV[2] then return 0 end; redis.call("SET",KEYS[1],ARGV[3],"EX",ARGV[5]); redis.call("SET",KEYS[2],ARGV[4],"EX",ARGV[5]); return 1',
    [taskCursorValueKey(runId, sidHash), taskCursorSigKey(runId, sidHash)],
    [
      String(expectedCursor),
      expectedSig,
      String(nextCursor),
      nextSig,
      String(ttlSeconds),
    ]
  );

  return Number(result) === 1;
}
