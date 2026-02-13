import type { UserType } from "@/app/(auth)/auth";

type Entitlements = {
  maxMessagesPerDay: number;
};

function readQuotaEnv(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

export const entitlementsByUserType: Record<UserType, Entitlements> = {
  /*
   * For users without an account
   */
  guest: {
    maxMessagesPerDay: readQuotaEnv("CHAT_MAX_MESSAGES_PER_DAY_GUEST", 20),
  },

  /*
   * For users with an account
   */
  regular: {
    maxMessagesPerDay: readQuotaEnv("CHAT_MAX_MESSAGES_PER_DAY_REGULAR", 50),
  },

  /*
   * TODO: For users with an account and a paid membership
   */
};
