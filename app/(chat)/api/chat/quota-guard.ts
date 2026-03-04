const LOOKBACK_HOURS = 24;
const DATABASE_SURFACE = "database";

type GetMessageCountByUserId = (params: {
  id: string;
  differenceInHours: number;
}) => Promise<number>;

function isDatabaseSurfaceError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }

  return (error as { surface?: unknown }).surface === DATABASE_SURFACE;
}

export async function shouldRejectByDailyQuota(params: {
  disabled: boolean;
  userId: string;
  maxMessagesPerDay: number;
  getMessageCountByUserId: GetMessageCountByUserId;
  logger?: Pick<Console, "warn">;
}) {
  const {
    disabled,
    userId,
    maxMessagesPerDay,
    getMessageCountByUserId,
    logger = console,
  } = params;

  if (disabled) {
    return false;
  }

  try {
    const messageCount = await getMessageCountByUserId({
      id: userId,
      differenceInHours: LOOKBACK_HOURS,
    });

    return messageCount > maxMessagesPerDay;
  } catch (error) {
    if (isDatabaseSurfaceError(error)) {
      logger.warn(
        "[chat-api][quota] skip daily quota check because message count query failed"
      );
      return false;
    }

    throw error;
  }
}
