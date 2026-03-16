import {
  assertBotFatherBotAccess,
  proxyBotFatherJson,
  requireBotFatherSession,
  toBotFatherRouteErrorResponse,
} from "../../_lib";

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
    return proxyBotFatherJson(
      `/v1/bot-father/bots/${encodeURIComponent(botSlug)}`,
      { method: "DELETE" }
    );
  } catch (error) {
    return toBotFatherRouteErrorResponse(error, "Failed to delete bot");
  }
}
