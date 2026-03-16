import { upsertBotFatherBinding } from "@/lib/db/queries";
import {
  fetchBotFatherBackend,
  requireBotFatherSession,
  toBotFatherRouteErrorResponse,
} from "../_lib";

async function toBotFatherJsonResponse(response: Response) {
  const raw = await response.text();
  if (!response.ok) {
    let parsed: Partial<{
      error: { message?: unknown };
      message?: unknown;
      cause?: unknown;
    }> | null = null;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      parsed = null;
    }
    const cause =
      (typeof parsed?.error?.message === "string" && parsed.error.message) ||
      (typeof parsed?.cause === "string" && parsed.cause) ||
      (typeof parsed?.message === "string" && parsed.message) ||
      raw.trim() ||
      "Bot Father request failed";
    return Response.json(
      {
        code:
          response.status === 401
            ? "unauthorized:api"
            : response.status === 403
              ? "forbidden:api"
              : "bad_request:api",
        message: cause,
        cause,
      },
      { status: response.status }
    );
  }
  return {
    payload: raw ? JSON.parse(raw) : {},
    status: response.status,
  };
}

export async function GET() {
  try {
    const access = await requireBotFatherSession();
    const response = await fetchBotFatherBackend("/v1/bot-father/bots");
    const normalized = await toBotFatherJsonResponse(response);
    if (normalized instanceof Response) {
      return normalized;
    }
    const payload = normalized.payload;
    if (!access.isAdmin) {
      payload.bots = Array.isArray(payload?.bots)
        ? payload.bots.filter((bot: { bot_slug?: string }) =>
            access.accessibleBotSlugs.includes(String(bot?.bot_slug || ""))
          )
        : [];
    }
    return Response.json(payload, { status: normalized.status });
  } catch (error) {
    return toBotFatherRouteErrorResponse(error, "Failed to list bots");
  }
}

export async function POST(request: Request) {
  try {
    const access = await requireBotFatherSession();
    const body = await request.json().catch(() => ({}));
    const normalizedBody = body && typeof body === "object" ? { ...body } : {};
    const botSlug = String(normalizedBody.botSlug || "").trim();
    if (!access.isAdmin) {
      const canUpdateExisting =
        botSlug.length > 0 && access.accessibleBotSlugs.includes(botSlug);
      normalizedBody.force = canUpdateExisting;
      if (canUpdateExisting) {
        const detailResponse = await fetchBotFatherBackend(
          `/v1/bot-father/bots/${encodeURIComponent(botSlug)}`
        );
        const detail = await toBotFatherJsonResponse(detailResponse);
        if (detail instanceof Response) {
          return detail;
        }
        const existingOwnerOpenId = String(
          detail.payload?.bot?.owner_open_id || ""
        ).trim();
        if (existingOwnerOpenId) {
          normalizedBody.ownerOpenId = existingOwnerOpenId;
        }
      }
    }
    const response = await fetchBotFatherBackend("/v1/bot-father/bots", {
      method: "POST",
      body: JSON.stringify(normalizedBody),
    });
    const normalized = await toBotFatherJsonResponse(response);
    if (normalized instanceof Response) {
      return normalized;
    }
    const payload = normalized.payload;
    if (!access.isAdmin && botSlug) {
      await upsertBotFatherBinding({
        botSlug,
        userId: access.session.user.id,
        userEmail: access.session.user.email || "",
      });
    }
    return Response.json(payload, { status: normalized.status });
  } catch (error) {
    return toBotFatherRouteErrorResponse(error, "Failed to create bot");
  }
}
