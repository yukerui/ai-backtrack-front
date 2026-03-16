import {
  proxyBotFatherJson,
  requireBotFatherAdminSession,
  toBotFatherRouteErrorResponse,
} from "../_lib";

export async function GET() {
  try {
    await requireBotFatherAdminSession();
    return proxyBotFatherJson("/v1/bot-father/bots");
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
