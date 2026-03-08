const TOKEN_PREFIX_LENGTH = 8;
const TOKEN_HASH_LOG_LENGTH = 16;

export type RealtimeTokenLogMeta = {
  tokenPresent: boolean;
  tokenPrefix: string;
  tokenHash: string;
  tokenLength: number;
};

export type RealtimeErrorLogMeta = {
  errorName: string;
  errorMessage: string;
  errorStatus: number | null;
  errorCode: string;
  errorType: string;
  requestId: string;
  correlationId: string;
  cfRay: string;
};

export type RealtimeTokenRunScopeMeta = {
  allowed: boolean;
  scopes: string[];
};

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function normalizeToken(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function decodeBase64Url(input: string): string {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4;
  const withPadding =
    padding === 0 ? normalized : `${normalized}${"=".repeat(4 - padding)}`;
  if (typeof atob === "function") {
    return atob(withPadding);
  }
  if (typeof Buffer !== "undefined") {
    return Buffer.from(withPadding, "base64").toString("utf8");
  }
  return "";
}

function djb2Hex(input: string) {
  let hash = 5381;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 33) ^ input.charCodeAt(i);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function headersToRecord(value: unknown): Record<string, string> {
  if (typeof Headers !== "undefined" && value instanceof Headers) {
    return Object.fromEntries(value.entries());
  }
  const source = toRecord(value);
  const result: Record<string, string> = {};
  for (const [key, val] of Object.entries(source)) {
    if (typeof val === "string" && val.trim()) {
      result[key.toLowerCase()] = val.trim();
    }
  }
  return result;
}

async function sha256Hex(input: string) {
  if (!input) {
    return "";
  }
  if (globalThis.crypto?.subtle && typeof TextEncoder !== "undefined") {
    const bytes = new TextEncoder().encode(input);
    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    const array = Array.from(new Uint8Array(digest));
    return array.map((value) => value.toString(16).padStart(2, "0")).join("");
  }
  return djb2Hex(input);
}

export async function buildRealtimeTokenLogMeta(
  token: string | null | undefined
): Promise<RealtimeTokenLogMeta> {
  const normalized = normalizeToken(token);
  if (!normalized) {
    return {
      tokenPresent: false,
      tokenPrefix: "",
      tokenHash: "",
      tokenLength: 0,
    };
  }

  const hash = await sha256Hex(normalized);
  return {
    tokenPresent: true,
    tokenPrefix: normalized.slice(0, TOKEN_PREFIX_LENGTH),
    tokenHash: hash.slice(0, TOKEN_HASH_LOG_LENGTH),
    tokenLength: normalized.length,
  };
}

export function buildRealtimeTokenLogMetaSync(
  token: string | null | undefined
): RealtimeTokenLogMeta {
  const normalized = normalizeToken(token);
  if (!normalized) {
    return {
      tokenPresent: false,
      tokenPrefix: "",
      tokenHash: "",
      tokenLength: 0,
    };
  }
  return {
    tokenPresent: true,
    tokenPrefix: normalized.slice(0, TOKEN_PREFIX_LENGTH),
    tokenHash: djb2Hex(normalized).slice(0, TOKEN_HASH_LOG_LENGTH),
    tokenLength: normalized.length,
  };
}

function parseTokenScopes(token: string): string[] {
  const normalized = normalizeToken(token);
  if (!normalized) {
    return [];
  }
  const parts = normalized.split(".");
  if (parts.length < 2 || !parts[1]) {
    return [];
  }
  try {
    const decoded = decodeBase64Url(parts[1]);
    const payload = JSON.parse(decoded) as { scopes?: unknown };
    if (!Array.isArray(payload.scopes)) {
      return [];
    }
    return payload.scopes
      .filter((scope): scope is string => typeof scope === "string")
      .map((scope) => scope.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function validateRealtimeTokenRunScope(
  token: string | null | undefined,
  runId: string
): RealtimeTokenRunScopeMeta {
  const scopes = parseTokenScopes(normalizeToken(token));
  const targetScope = `read:runs:${String(runId || "").trim()}`;
  const allowed =
    scopes.includes(targetScope) ||
    scopes.includes("read:runs") ||
    scopes.includes("read:runs:*");
  return { allowed, scopes };
}

export function normalizeRealtimeApiHost(apiUrl: string): string {
  if (!apiUrl) {
    return "";
  }
  try {
    return new URL(apiUrl).host;
  } catch {
    return apiUrl;
  }
}

export function normalizeRealtimeError(error: unknown): RealtimeErrorLogMeta {
  const record = toRecord(error);
  const headers = headersToRecord(record.headers);
  const status =
    typeof record.status === "number" && Number.isFinite(record.status)
      ? Math.trunc(record.status)
      : null;
  const message =
    typeof record.message === "string" && record.message.trim()
      ? record.message.trim()
      : String(error || "");

  return {
    errorName:
      typeof record.name === "string" && record.name.trim()
        ? record.name.trim()
        : "UnknownError",
    errorMessage: message,
    errorStatus: status,
    errorCode:
      typeof record.code === "string" && record.code.trim()
        ? record.code.trim()
        : "",
    errorType:
      typeof record.type === "string" && record.type.trim()
        ? record.type.trim()
        : "",
    requestId: headers["x-request-id"] || "",
    correlationId:
      headers["x-correlation-id"] || headers["x-correlationid"] || "",
    cfRay: headers["cf-ray"] || "",
  };
}
