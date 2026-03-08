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
