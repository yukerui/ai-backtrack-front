import {
  assertBotFatherBotAccess,
  fetchBotFatherBackend,
  proxyBotFatherJson,
  requireBotFatherSession,
  toBotFatherRouteErrorResponse,
} from "../../_lib";
import { deleteBotFatherBinding } from "@/lib/db/queries";

type RouteContext = {
  params: Promise<{
    botSlug: string;
  }>;
};

export async function GET(_: Request, context: RouteContext) {
  try {
    const access = await requireBotFatherSession();
    const { botSlug } = await context.params;
    assertBotFatherBotAccess({
      botSlug,
      isAdmin: access.isAdmin,
      accessibleBotSlugs: access.accessibleBotSlugs,
    });
    return proxyBotFatherJson(
      `/v1/bot-father/bots/${encodeURIComponent(botSlug)}`
    );
  } catch (error) {
    return toBotFatherRouteErrorResponse(error, "Failed to load bot detail");
  }
}

export async function DELETE(_: Request, context: RouteContext) {
  try {
    const access = await requireBotFatherSession();
    const { botSlug } = await context.params;
    assertBotFatherBotAccess({
      botSlug,
      isAdmin: access.isAdmin,
      accessibleBotSlugs: access.accessibleBotSlugs,
    });
    const response = await fetchBotFatherBackend(
      `/v1/bot-father/bots/${encodeURIComponent(botSlug)}`,
      { method: "DELETE" }
    );
    const raw = await response.text();
    if (!response.ok) {
      return Response.json(
        {
          code:
            response.status === 401
              ? "unauthorized:api"
              : response.status === 403
                ? "forbidden:api"
                : "bad_request:api",
          message: raw.trim() || "Bot Father request failed",
          cause: raw.trim() || "Bot Father request failed",
        },
        { status: response.status }
      );
    }
    await deleteBotFatherBinding({ botSlug });
    return new Response(raw || "{}", {
      status: response.status,
      headers: {
        "Content-Type":
          response.headers.get("content-type") || "application/json",
      },
    });
  } catch (error) {
    return toBotFatherRouteErrorResponse(error, "Failed to delete bot");
  }
}
