import { auth } from "@/app/(auth)/auth";
import {
  getBotFatherAccessibleBotSlugs,
  hasBotFatherConsoleAccess,
  isBotFatherAdminEmail,
} from "@/lib/bot-father-admin";
import { ChatSDKError, type ErrorCode } from "@/lib/errors";

function normalizeBase(url: string) {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

export async function requireBotFatherSession() {
  const session = await auth();
  if (!session?.user) {
    throw new ChatSDKError("unauthorized:api", "login_required");
  }
  if (!hasBotFatherConsoleAccess(session.user.email)) {
    throw new ChatSDKError("forbidden:api", "bot_father_admin_required");
  }
  return {
    session,
    isAdmin: isBotFatherAdminEmail(session.user.email),
    accessibleBotSlugs: getBotFatherAccessibleBotSlugs(session.user.email),
  };
}

export async function requireBotFatherAdminSession() {
  const access = await requireBotFatherSession();
  if (!access.isAdmin) {
    throw new ChatSDKError("forbidden:api", "bot_father_admin_required");
  }
  return access;
}

export function assertBotFatherBotAccess({
  botSlug,
  isAdmin,
  accessibleBotSlugs,
}: {
  botSlug: string;
  isAdmin: boolean;
  accessibleBotSlugs: string[];
}) {
  if (isAdmin) {
    return;
  }
  if (!accessibleBotSlugs.includes(botSlug)) {
    throw new ChatSDKError("forbidden:api", "bot_father_bot_not_accessible");
  }
}

export function getBotFatherBackendConfig() {
  const rawBase = process.env.CLAUDE_CODE_API_BASE || "http://127.0.0.1:15722";
  const token = process.env.CLAUDE_CODE_GATEWAY_TOKEN;
  if (!token) {
    throw new Error("Missing CLAUDE_CODE_GATEWAY_TOKEN");
  }
  return {
    base: normalizeBase(rawBase),
    token,
  };
}

export async function fetchBotFatherBackend(
  path: string,
  init: RequestInit = {}
) {
  const { base, token } = getBotFatherBackendConfig();
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers || {}),
    },
    cache: "no-store",
  });
  return response;
}

export async function proxyBotFatherJson(
  path: string,
  init: RequestInit = {}
) {
  const response = await fetchBotFatherBackend(path, init);
  const raw = await response.text();
  if (!response.ok) {
    let parsed:
      | Partial<{ error: { message?: unknown }; message?: unknown; cause?: unknown }>
      | null = null;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      parsed = null;
    }
    const code: ErrorCode =
      response.status === 401
        ? "unauthorized:api"
        : response.status === 403
          ? "forbidden:api"
          : "bad_request:api";
    const cause =
      (typeof parsed?.error?.message === "string" && parsed.error.message) ||
      (typeof parsed?.cause === "string" && parsed.cause) ||
      (typeof parsed?.message === "string" && parsed.message) ||
      raw.trim() ||
      "Bot Father request failed";
    return Response.json(
      {
        code,
        message: cause,
        cause,
      },
      { status: response.status }
    );
  }
  return new Response(raw || "{}", {
    status: response.status,
    headers: {
      "Content-Type": response.headers.get("content-type") || "application/json",
    },
  });
}

export function toBotFatherRouteErrorResponse(error: unknown, fallback: string) {
  if (error instanceof ChatSDKError) {
    return error.toResponse();
  }
  const cause =
    error instanceof Error && error.message.trim()
      ? error.message.trim()
      : fallback;
  return Response.json(
    {
      code: "bad_request:api",
      message: cause,
      cause,
    },
    { status: 500 }
  );
}
