import {
  proxyBotFatherJson,
  requireBotFatherAdminSession,
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
    await requireBotFatherAdminSession();
    const { botSlug, action } = await context.params;
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
