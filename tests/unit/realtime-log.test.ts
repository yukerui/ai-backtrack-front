import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRealtimeTokenLogMeta,
  buildRealtimeTokenLogMetaSync,
  normalizeRealtimeApiHost,
  normalizeRealtimeError,
  validateRealtimeTokenRunScope,
} from "../../lib/realtime-log";

function toBase64Url(value: string) {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function buildJwtWithScopes(scopes: string[]) {
  const header = toBase64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = toBase64Url(JSON.stringify({ scopes }));
  return `${header}.${payload}.sig`;
}

test("buildRealtimeTokenLogMeta should return empty metadata when token is missing", async () => {
  const meta = await buildRealtimeTokenLogMeta("");
  assert.equal(meta.tokenPresent, false);
  assert.equal(meta.tokenPrefix, "");
  assert.equal(meta.tokenHash, "");
  assert.equal(meta.tokenLength, 0);
});

test("buildRealtimeTokenLogMeta should only expose prefix and hash", async () => {
  const token = "tr_pub_1234567890abcdefghijklmn";
  const meta = await buildRealtimeTokenLogMeta(token);
  assert.equal(meta.tokenPresent, true);
  assert.equal(meta.tokenPrefix, "tr_pub_1");
  assert.equal(meta.tokenLength, token.length);
  assert.equal(meta.tokenHash.length > 0, true);
  assert.equal(meta.tokenHash.includes(token), false);
});

test("buildRealtimeTokenLogMetaSync should only expose prefix and hash", () => {
  const token = "tr_pub_sync_1234567890abcdefghijklmn";
  const meta = buildRealtimeTokenLogMetaSync(token);
  assert.equal(meta.tokenPresent, true);
  assert.equal(meta.tokenPrefix, "tr_pub_s");
  assert.equal(meta.tokenLength, token.length);
  assert.equal(meta.tokenHash.length > 0, true);
});

test("normalizeRealtimeApiHost should return hostname for valid URL", () => {
  const host = normalizeRealtimeApiHost("https://api.trigger.dev/realtime");
  assert.equal(host, "api.trigger.dev");
});

test("normalizeRealtimeError should map status and headers from api error shape", () => {
  const error = {
    name: "TriggerApiError",
    message: "403 Could not subscribe to stream",
    status: 403,
    headers: {
      "x-request-id": "req_123",
      "x-correlation-id": "corr_456",
      "cf-ray": "ray_789",
    },
    code: "permission_denied",
    type: "forbidden",
  };
  const normalized = normalizeRealtimeError(error);
  assert.equal(normalized.errorName, "TriggerApiError");
  assert.equal(normalized.errorStatus, 403);
  assert.equal(normalized.requestId, "req_123");
  assert.equal(normalized.correlationId, "corr_456");
  assert.equal(normalized.cfRay, "ray_789");
  assert.equal(normalized.errorCode, "permission_denied");
  assert.equal(normalized.errorType, "forbidden");
});

test("normalizeRealtimeError should return defaults for plain errors", () => {
  const normalized = normalizeRealtimeError(new Error("network failed"));
  assert.equal(normalized.errorName, "Error");
  assert.equal(normalized.errorMessage, "network failed");
  assert.equal(normalized.errorStatus, null);
  assert.equal(normalized.requestId, "");
});

test("validateRealtimeTokenRunScope should allow exact run scope", () => {
  const token = buildJwtWithScopes(["read:runs:run_abc"]);
  const check = validateRealtimeTokenRunScope(token, "run_abc");
  assert.equal(check.allowed, true);
});

test("validateRealtimeTokenRunScope should reject mismatched run scope", () => {
  const token = buildJwtWithScopes(["read:runs:run_abc"]);
  const check = validateRealtimeTokenRunScope(token, "run_xyz");
  assert.equal(check.allowed, false);
});

test("validateRealtimeTokenRunScope should allow wildcard run scope", () => {
  const token = buildJwtWithScopes(["read:runs"]);
  const check = validateRealtimeTokenRunScope(token, "run_any");
  assert.equal(check.allowed, true);
});
