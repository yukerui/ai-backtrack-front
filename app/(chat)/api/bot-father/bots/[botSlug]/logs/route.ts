import {
  proxyBotFatherJson,
  requireBotFatherAdminSession,
  toBotFatherRouteErrorResponse,
} from "../../../_lib";

type RouteContext = {
  params: Promise<{
    botSlug: string;
  }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    await requireBotFatherAdminSession();
    const { botSlug } = await context.params;
    const { searchParams } = new URL(request.url);
    const lines = searchParams.get("lines") || "120";
    return proxyBotFatherJson(
      `/v1/bot-father/bots/${encodeURIComponent(botSlug)}/logs?lines=${encodeURIComponent(lines)}`
    );
  } catch (error) {
    return toBotFatherRouteErrorResponse(error, "Failed to load bot logs");
  }
}
