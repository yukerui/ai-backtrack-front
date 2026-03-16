import {
  assertBotFatherBotAccess,
  proxyBotFatherJson,
  requireBotFatherSession,
  toBotFatherRouteErrorResponse,
} from "../../../_lib";

type RouteContext = {
  params: Promise<{
    botSlug: string;
  }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const access = await requireBotFatherSession();
    const { botSlug } = await context.params;
    assertBotFatherBotAccess({
      botSlug,
      isAdmin: access.isAdmin,
      accessibleBotSlugs: access.accessibleBotSlugs,
    });
    const { searchParams } = new URL(request.url);
    const lines = searchParams.get("lines") || "120";
    return proxyBotFatherJson(
      `/v1/bot-father/bots/${encodeURIComponent(botSlug)}/logs?lines=${encodeURIComponent(lines)}`
    );
  } catch (error) {
    return toBotFatherRouteErrorResponse(error, "Failed to load bot logs");
  }
}
