export type TaskRecoveryReason =
  | "missing_realtime"
  | "realtime_stream_error"
  | "realtime_status_error";

export type TaskRecoveryInput = {
  reason: TaskRecoveryReason;
  hasCursorSig: boolean;
};

export type TaskRecoveryDecision = {
  shouldStartPolling: boolean;
  issueMessage: string;
};

const TOKEN_EXPIRED_PATTERNS = [
  /public\s+access\s+token\s+has\s+expired/i,
  /\btoken\s+has\s+expired\b/i,
  /\bjwt\s+expired\b/i,
];

const RETRYABLE_REALTIME_STREAM_PATTERNS = [
  /\b404\b/i,
  /stream\s+not\s+found/i,
  /not\s+found/i,
  /could\s+not\s+fetch\s+stream/i,
  /could\s+not\s+subscribe\s+to\s+stream/i,
  /failed\s+to\s+fetch/i,
];

function collectErrorText(
  value: unknown,
  bucket: string[],
  seen: Set<unknown>,
  depth: number
) {
  if (!value || depth > 3 || seen.has(value)) {
    return;
  }
  if (typeof value === "string") {
    const normalized = value.trim();
    if (normalized) {
      bucket.push(normalized);
    }
    return;
  }
  if (typeof value !== "object") {
    return;
  }

  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 10)) {
      collectErrorText(item, bucket, seen, depth + 1);
    }
    return;
  }

  const record = value as Record<string, unknown>;
  const keys = [
    "message",
    "error",
    "detail",
    "details",
    "cause",
    "statusText",
    "body",
    "data",
    "response",
  ];
  for (const key of keys) {
    collectErrorText(record[key], bucket, seen, depth + 1);
  }
}

function extractStatusCode(error: unknown) {
  if (!error || typeof error !== "object") {
    return null;
  }
  const record = error as Record<string, unknown>;
  if (typeof record.status === "number" && Number.isFinite(record.status)) {
    return Math.trunc(record.status);
  }
  if (
    record.response &&
    typeof record.response === "object" &&
    typeof (record.response as Record<string, unknown>).status === "number"
  ) {
    return Math.trunc(
      (record.response as Record<string, number>).status
    );
  }
  return null;
}

export function shouldRefreshRealtimeTokenOnError(error: unknown) {
  const texts: string[] = [];
  collectErrorText(error, texts, new Set<unknown>(), 0);
  if (texts.length === 0 && error instanceof Error && error.message.trim()) {
    texts.push(error.message.trim());
  }

  const matchedExpiredPattern = texts.some((text) =>
    TOKEN_EXPIRED_PATTERNS.some((pattern) => pattern.test(text))
  );
  if (matchedExpiredPattern) {
    return true;
  }

  const statusCode = extractStatusCode(error);
  if (statusCode !== 401) {
    return false;
  }
  return texts.some((text) => /token|unauthorized|auth/i.test(text));
}

export function shouldRetryRealtimeStreamError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }

  const message =
    "message" in error && typeof error.message === "string"
      ? error.message
      : String(error);
  if (!message.trim()) {
    return false;
  }

  return RETRYABLE_REALTIME_STREAM_PATTERNS.some((pattern) =>
    pattern.test(message)
  );
}

export function decideTaskRecovery(
  input: TaskRecoveryInput
): TaskRecoveryDecision {
  if (!input.hasCursorSig) {
    if (input.reason === "missing_realtime") {
      return {
        shouldStartPolling: false,
        issueMessage: "未拿到实时订阅令牌，请点击“手动补拉”。",
      };
    }

    if (input.reason === "realtime_stream_error") {
      return {
        shouldStartPolling: false,
        issueMessage: "实时通道异常，请点击“手动补拉”。",
      };
    }

    return {
      shouldStartPolling: false,
      issueMessage: "实时状态订阅失败，请点击“手动补拉”。",
    };
  }

  if (input.reason === "missing_realtime") {
    return {
      shouldStartPolling: true,
      issueMessage: "未拿到实时订阅令牌，已自动切换轮询同步。",
    };
  }

  if (input.reason === "realtime_stream_error") {
    return {
      shouldStartPolling: true,
      issueMessage: "实时通道异常，已自动切换轮询同步。",
    };
  }

  return {
    shouldStartPolling: true,
    issueMessage: "实时状态订阅失败，已自动切换轮询同步。",
  };
}
