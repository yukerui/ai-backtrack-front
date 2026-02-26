import { createHmac, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { ChatSDKError } from "@/lib/errors";

function getRepoRoot() {
  const cwd = process.cwd();
  const candidate = path.resolve(cwd, "..");
  if (fs.existsSync(path.resolve(cwd, "backend")) && fs.existsSync(path.resolve(cwd, "front"))) {
    return cwd;
  }
  if (
    fs.existsSync(path.resolve(candidate, "backend")) &&
    fs.existsSync(path.resolve(candidate, "front"))
  ) {
    return candidate;
  }
  return cwd;
}

const REPO_ROOT = getRepoRoot();
const ARTIFACT_ROOTS = [
  path.resolve(REPO_ROOT, "artifacts"),
  path.resolve(REPO_ROOT, "backend/artifacts"),
  path.resolve(REPO_ROOT, "front/artifacts"),
];

function normalizeRemoteBase(raw: string) {
  const trimmed = raw.replace(/\/+$/, "");
  if (trimmed.endsWith("/v1/chat/completions")) {
    return trimmed.replace(/\/v1\/chat\/completions$/, "");
  }
  return trimmed;
}

function isLoopbackHost(hostname: string) {
  const lower = hostname.toLowerCase();
  return (
    lower === "127.0.0.1" ||
    lower === "localhost" ||
    lower === "::1" ||
    lower.endsWith(".localhost")
  );
}

function getRequestHost(requestUrl: string) {
  try {
    return new URL(requestUrl).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function inferRemoteBaseFromRequest(requestUrl: string) {
  let parsed: URL;
  try {
    parsed = new URL(requestUrl);
  } catch {
    return "";
  }

  const host = parsed.hostname.toLowerCase();
  if (host === "www.freebacktrack.tech" || host === "freebacktrack.tech") {
    return `${parsed.protocol}//ai-backend.freebacktrack.tech`;
  }
  return "";
}

function resolveRemoteBase(requestUrl: string) {
  const configured = process.env.ARTIFACTS_REMOTE_BASE || process.env.CLAUDE_CODE_API_BASE || "";
  if (configured) {
    const normalized = normalizeRemoteBase(configured);
    try {
      const parsed = new URL(normalized);
      const requestHost = getRequestHost(requestUrl);
      if (!isLoopbackHost(parsed.hostname) || isLoopbackHost(requestHost)) {
        return normalized;
      }
    } catch {
      return normalized;
    }
  }
  return inferRemoteBaseFromRequest(requestUrl);
}
const TOKEN_TTL_MS = Number.parseInt(process.env.ARTIFACTS_TOKEN_TTL_MS || "3600000", 10);
const ARTIFACTS_SIGNING_SECRET =
  process.env.ARTIFACTS_SIGNING_SECRET ||
  process.env.NEXTAUTH_SECRET ||
  process.env.AUTH_SECRET ||
  "";

function toBase64Url(input: Buffer | string) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input, "utf8");
  return buffer
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function fromBase64Url(input: string) {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = base64.length % 4 === 0 ? "" : "=".repeat(4 - (base64.length % 4));
  return Buffer.from(base64 + pad, "base64");
}

function signToken(pathValue: string) {
  if (!ARTIFACTS_SIGNING_SECRET) {
    return "";
  }
  const payload = JSON.stringify({ p: pathValue, e: Date.now() + TOKEN_TTL_MS });
  const sig = createHmac("sha256", ARTIFACTS_SIGNING_SECRET).update(payload).digest();
  return `${toBase64Url(payload)}.${toBase64Url(sig)}`;
}

function verifyToken(
  token: string
): { ok: true; path: string } | { ok: false; error: string; path?: string; expired?: boolean } {
  if (!ARTIFACTS_SIGNING_SECRET) {
    return { ok: false, error: "Missing artifact signing secret" };
  }
  const [payloadB64, sigB64] = token.split(".");
  if (!payloadB64 || !sigB64) {
    return { ok: false, error: "Invalid token" };
  }
  const payload = fromBase64Url(payloadB64);
  const expectedSig = createHmac("sha256", ARTIFACTS_SIGNING_SECRET)
    .update(payload)
    .digest();
  const providedSig = fromBase64Url(sigB64);
  if (expectedSig.length !== providedSig.length) {
    return { ok: false, error: "Invalid token" };
  }
  if (!timingSafeEqual(expectedSig, providedSig)) {
    return { ok: false, error: "Invalid token" };
  }
  let parsed: { p?: string; e?: number } | null = null;
  try {
    parsed = JSON.parse(payload.toString("utf8"));
  } catch {
    return { ok: false, error: "Invalid token" };
  }
  if (!parsed?.p || typeof parsed.e !== "number") {
    return { ok: false, error: "Invalid token" };
  }
  if (Date.now() > parsed.e) {
    return { ok: false, error: "Token expired", path: parsed.p, expired: true };
  }
  return { ok: true, path: parsed.p };
}

function getContentType(targetPath: string) {
  if (targetPath.endsWith(".html")) {
    return "text/html; charset=utf-8";
  }
  if (targetPath.endsWith(".csv")) {
    return "text/csv; charset=utf-8";
  }
  if (targetPath.endsWith(".json")) {
    return "application/json; charset=utf-8";
  }
  return "text/plain; charset=utf-8";
}

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return new ChatSDKError("unauthorized:chat").toResponse();
  }

  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token");
  const inputPath = searchParams.get("path");

  if (!token && !inputPath) {
    return NextResponse.json({ error: "Missing token query parameter" }, { status: 400 });
  }

  let resolvedPath = "";
  let tokenForUpstream = token || "";
  if (token) {
    const verified = verifyToken(token);
    if (!verified.ok) {
      if (verified.expired && verified.path) {
        resolvedPath = verified.path;
        const refreshed = signToken(resolvedPath);
        if (refreshed) {
          tokenForUpstream = refreshed;
        }
      } else {
        return NextResponse.json({ error: verified.error }, { status: 403 });
      }
    } else {
      resolvedPath = verified.path;
    }
  } else if (process.env.ALLOW_UNSAFE_ARTIFACT_PATH === "true" && inputPath) {
    resolvedPath = inputPath;
  } else {
    return NextResponse.json({ error: "Invalid artifact token" }, { status: 403 });
  }

  const normalizedPath = resolvedPath.replace(/^\/+/, "");
  const absolutePath = path.resolve(REPO_ROOT, normalizedPath);
  const isAllowed = ARTIFACT_ROOTS.some((root) => absolutePath.startsWith(root + path.sep));
  if (!isAllowed) {
    return NextResponse.json({ error: "Path traversal is not allowed" }, { status: 400 });
  }

  const candidatePaths = [absolutePath];
  if (normalizedPath.startsWith("artifacts/")) {
    candidatePaths.push(path.resolve(REPO_ROOT, `backend/${normalizedPath}`));
    candidatePaths.push(path.resolve(REPO_ROOT, `front/${normalizedPath}`));
  }

  for (const candidate of candidatePaths) {
    if (!ARTIFACT_ROOTS.some((root) => candidate.startsWith(root + path.sep))) {
      continue;
    }
    try {
      const content = await readFile(candidate);
      return new Response(content, {
        status: 200,
        headers: {
          "content-type": getContentType(candidate),
          "cache-control": "no-store",
        },
      });
    } catch {
      // try next candidate
    }
  }

  const remoteBase = resolveRemoteBase(request.url);
  if (remoteBase && tokenForUpstream) {
    try {
      const upstream = await fetch(
        `${remoteBase}/artifacts?token=${encodeURIComponent(tokenForUpstream)}`,
        {
        headers: {
          accept: "text/html, text/csv, application/json, text/plain",
        },
        cache: "no-store",
        }
      );
      if (upstream.ok) {
        const contentType = upstream.headers.get("content-type") || "application/octet-stream";
        const content = await upstream.arrayBuffer();
        return new Response(content, {
          status: 200,
          headers: {
            "content-type": contentType,
            "cache-control": "no-store",
          },
        });
      }
    } catch {
      // ignore upstream errors
    }
  }

  return NextResponse.json({ error: "Artifact file not found" }, { status: 404 });
}
