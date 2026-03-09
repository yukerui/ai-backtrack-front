import {
  auth as triggerAuth,
  runs as triggerRuns,
  streams as triggerStreams,
} from "@trigger.dev/sdk/v3";

const DEFAULT_REALTIME_API_URL = "https://api.trigger.dev";

type WithAuthConfig = {
  baseURL: string;
  accessToken: string;
};

type WithAuthFn = <T>(
  config: WithAuthConfig,
  fn: () => Promise<T> | T
) => Promise<T>;

type RealtimeStreamReadFn<TStream> = (
  runId: string,
  streamId: string,
  options: { signal?: AbortSignal; timeoutInSeconds: number }
) => Promise<TStream>;

type SubscribeToRunFn<TSubscription> = (
  runId: string,
  options: {
    stopOnCompletion?: boolean;
    skipColumns?: string[];
  }
) => TSubscription;

export type RealtimeScopedAuth = {
  apiUrl: string;
  publicAccessToken: string;
};

export type RealtimeRunStatusSubscription = AsyncIterable<{
  isFailed?: boolean;
  isCompleted?: boolean;
  status?: string;
}> & {
  unsubscribe: () => void;
};

function normalizeAuthConfig(realtime: RealtimeScopedAuth): WithAuthConfig {
  const baseURL = realtime.apiUrl.trim() || DEFAULT_REALTIME_API_URL;
  const accessToken = realtime.publicAccessToken.trim();
  if (!accessToken) {
    throw new Error("Missing realtime public access token");
  }
  return { baseURL, accessToken };
}

export async function readRealtimeRunStream<TStream = AsyncIterable<string>>({
  runId,
  streamId,
  signal,
  timeoutInSeconds,
  realtime,
  withAuth = triggerAuth.withAuth,
  readStream = triggerStreams.read as RealtimeStreamReadFn<TStream>,
}: {
  runId: string;
  streamId: string;
  signal?: AbortSignal;
  timeoutInSeconds: number;
  realtime: RealtimeScopedAuth;
  withAuth?: WithAuthFn;
  readStream?: RealtimeStreamReadFn<TStream>;
}): Promise<TStream> {
  const authConfig = normalizeAuthConfig(realtime);
  return withAuth(authConfig, () =>
    readStream(runId, streamId, { signal, timeoutInSeconds })
  );
}

export async function subscribeRealtimeRunStatus({
  runId,
  realtime,
  skipColumns,
  withAuth = triggerAuth.withAuth,
  subscribeToRun = triggerRuns.subscribeToRun as SubscribeToRunFn<RealtimeRunStatusSubscription>,
}: {
  runId: string;
  realtime: RealtimeScopedAuth;
  skipColumns: string[];
  withAuth?: WithAuthFn;
  subscribeToRun?: SubscribeToRunFn<RealtimeRunStatusSubscription>;
}): Promise<RealtimeRunStatusSubscription> {
  const authConfig = normalizeAuthConfig(realtime);
  return withAuth(authConfig, () =>
    Promise.resolve(
      subscribeToRun(runId, { stopOnCompletion: false, skipColumns })
    )
  );
}
