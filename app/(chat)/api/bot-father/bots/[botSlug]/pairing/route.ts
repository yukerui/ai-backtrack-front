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
      `/v1/bot-father/bots/${encodeURIComponent(botSlug)}/pairing`
    );
  } catch (error) {
    return toBotFatherRouteErrorResponse(error, "Failed to load pairing");
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const access = await requireBotFatherSession();
    const { botSlug } = await context.params;
    assertBotFatherBotAccess({
      botSlug,
      isAdmin: access.isAdmin,
      accessibleBotSlugs: access.accessibleBotSlugs,
    });
    const body = await request.json().catch(() => ({}));
    return proxyBotFatherJson(
      `/v1/bot-father/bots/${encodeURIComponent(botSlug)}/pairing`,
      {
        method: "POST",
        body: JSON.stringify(body),
      }
    );
  } catch (error) {
    return toBotFatherRouteErrorResponse(error, "Failed to create pairing");
  }
}
