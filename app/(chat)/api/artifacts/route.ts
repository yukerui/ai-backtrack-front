import { createHmac, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { ChatSDKError } from "@/lib/errors";

const ARTIFACT_ROOTS = [
  path.resolve(process.cwd(), "artifacts"),
  path.resolve(process.cwd(), "backend/artifacts"),
  path.resolve(process.cwd(), "front/artifacts"),
];
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

function verifyToken(token: string) {
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
    return { ok: false, error: "Token expired" };
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
  if (token) {
    const verified = verifyToken(token);
    if (!verified.ok) {
      return NextResponse.json({ error: verified.error }, { status: 403 });
    }
    resolvedPath = verified.path;
  } else if (process.env.ALLOW_UNSAFE_ARTIFACT_PATH === "true" && inputPath) {
    resolvedPath = inputPath;
  } else {
    return NextResponse.json({ error: "Invalid artifact token" }, { status: 403 });
  }

  const normalizedPath = resolvedPath.replace(/^\/+/, "");
  const absolutePath = path.resolve(process.cwd(), normalizedPath);
  const isAllowed = ARTIFACT_ROOTS.some((root) => absolutePath.startsWith(root + path.sep));
  if (!isAllowed) {
    return NextResponse.json({ error: "Path traversal is not allowed" }, { status: 400 });
  }

  try {
    const content = await readFile(absolutePath);
    return new Response(content, {
      status: 200,
      headers: {
        "content-type": getContentType(absolutePath),
        "cache-control": "no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "Artifact file not found" }, { status: 404 });
  }
}
