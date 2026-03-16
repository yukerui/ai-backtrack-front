import {
  proxyBotFatherJson,
  requireBotFatherAdminSession,
  requireBotFatherSession,
  toBotFatherRouteErrorResponse,
} from "../_lib";

export async function GET() {
  try {
    const access = await requireBotFatherSession();
    const response = await proxyBotFatherJson("/v1/bot-father/bots");
    const payload = await response.json();
    if (!access.isAdmin) {
      payload.bots = Array.isArray(payload?.bots)
        ? payload.bots.filter((bot: { bot_slug?: string }) =>
            access.accessibleBotSlugs.includes(String(bot?.bot_slug || ""))
          )
        : [];
    }
    return Response.json(payload, { status: response.status });
  } catch (error) {
    return toBotFatherRouteErrorResponse(error, "Failed to list bots");
  }
}

export async function POST(request: Request) {
  try {
    await requireBotFatherAdminSession();
    const body = await request.json().catch(() => ({}));
    return proxyBotFatherJson("/v1/bot-father/bots", {
      method: "POST",
      body: JSON.stringify(body),
    });
  } catch (error) {
    return toBotFatherRouteErrorResponse(error, "Failed to create bot");
  }
}
