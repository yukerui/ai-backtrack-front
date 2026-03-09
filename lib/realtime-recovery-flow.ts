export type RealtimeOperationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: unknown };

type RunRealtimeOperationWithRecoveryInput<T> = {
  runOperation: () => Promise<T>;
  shouldRefreshToken: (error: unknown) => boolean;
  shouldRetry: (error: unknown) => boolean;
  refreshToken: () => Promise<boolean>;
  isActive: () => boolean;
  wait: (ms: number) => Promise<void>;
  refreshRetryDelayMs: number;
  retryDelayMs: number;
  maxRefreshAttempts?: number;
  onAttemptError?: (input: {
    error: unknown;
    willRetry: boolean;
  }) => Promise<void> | void;
};

const DEFAULT_MAX_REFRESH_ATTEMPTS = 1;

export async function runRealtimeOperationWithRecovery<T>(
  input: RunRealtimeOperationWithRecoveryInput<T>
): Promise<RealtimeOperationResult<T>> {
  const maxRefreshAttempts =
    typeof input.maxRefreshAttempts === "number" &&
    Number.isFinite(input.maxRefreshAttempts) &&
    input.maxRefreshAttempts >= 0
      ? Math.trunc(input.maxRefreshAttempts)
      : DEFAULT_MAX_REFRESH_ATTEMPTS;

  let refreshAttempts = 0;
  while (input.isActive()) {
    try {
      const value = await input.runOperation();
      return { ok: true, value };
    } catch (error) {
      const shouldTryRefresh =
        input.isActive() &&
        refreshAttempts < maxRefreshAttempts &&
        input.shouldRefreshToken(error);
      const shouldTryRetry = input.isActive() && input.shouldRetry(error);
      const willRetry = shouldTryRefresh || shouldTryRetry;

      await input.onAttemptError?.({ error, willRetry });

      if (shouldTryRefresh) {
        refreshAttempts += 1;
        const refreshed = await input.refreshToken();
        if (refreshed && input.isActive()) {
          await input.wait(input.refreshRetryDelayMs);
          continue;
        }
      }

      if (shouldTryRetry) {
        await input.wait(input.retryDelayMs);
        continue;
      }

      return { ok: false, error };
    }
  }

  return {
    ok: false,
    error: new Error("realtime_operation_inactive"),
  };
}
