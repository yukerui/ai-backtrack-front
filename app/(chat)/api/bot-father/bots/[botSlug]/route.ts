import {
  proxyBotFatherJson,
  requireBotFatherAdminSession,
  toBotFatherRouteErrorResponse,
} from "../../_lib";

type RouteContext = {
  params: Promise<{
    botSlug: string;
  }>;
};

export async function GET(_: Request, context: RouteContext) {
  try {
    await requireBotFatherAdminSession();
    const { botSlug } = await context.params;
    return proxyBotFatherJson(
      `/v1/bot-father/bots/${encodeURIComponent(botSlug)}`
    );
  } catch (error) {
    return toBotFatherRouteErrorResponse(error, "Failed to load bot detail");
  }
}

export async function DELETE(_: Request, context: RouteContext) {
  try {
    await requireBotFatherAdminSession();
    const { botSlug } = await context.params;
    return proxyBotFatherJson(
      `/v1/bot-father/bots/${encodeURIComponent(botSlug)}`,
      { method: "DELETE" }
    );
  } catch (error) {
    return toBotFatherRouteErrorResponse(error, "Failed to delete bot");
  }
}
