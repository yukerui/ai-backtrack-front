export const MAX_TRIGGER_REALTIME_TIMEOUT_SECONDS = 599;
export const DEFAULT_TRIGGER_REALTIME_TIMEOUT_SECONDS = 60;

export function normalizeRealtimeTimeoutSeconds(
  value: unknown,
  fallback = DEFAULT_TRIGGER_REALTIME_TIMEOUT_SECONDS
) {
  const parsed =
    typeof value === "number"
      ? Math.trunc(value)
      : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return Math.min(
      Math.max(Math.trunc(fallback), 1),
      MAX_TRIGGER_REALTIME_TIMEOUT_SECONDS
    );
  }
  return Math.min(parsed, MAX_TRIGGER_REALTIME_TIMEOUT_SECONDS);
}
