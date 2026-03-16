import {
  proxyBotFatherJson,
  requireBotFatherAdminSession,
  toBotFatherRouteErrorResponse,
} from "../_lib";

export async function GET() {
  try {
    await requireBotFatherAdminSession();
    return proxyBotFatherJson("/v1/bot-father/info");
  } catch (error) {
    return toBotFatherRouteErrorResponse(error, "Failed to load Bot Father info");
  }
}
