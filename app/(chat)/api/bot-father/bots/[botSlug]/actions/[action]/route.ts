import {
  assertBotFatherBotAccess,
  proxyBotFatherJson,
  requireBotFatherSession,
  toBotFatherRouteErrorResponse,
} from "../../../../_lib";

type RouteContext = {
  params: Promise<{
    botSlug: string;
    action: string;
  }>;
};

export async function POST(_: Request, context: RouteContext) {
  try {
    const access = await requireBotFatherSession();
    const { botSlug, action } = await context.params;
    assertBotFatherBotAccess({
      botSlug,
      isAdmin: access.isAdmin,
      accessibleBotSlugs: access.accessibleBotSlugs,
    });
    return proxyBotFatherJson(
      `/v1/bot-father/bots/${encodeURIComponent(botSlug)}/actions/${encodeURIComponent(action)}`,
      {
        method: "POST",
      }
    );
  } catch (error) {
    return toBotFatherRouteErrorResponse(error, "Failed to run bot action");
  }
}
