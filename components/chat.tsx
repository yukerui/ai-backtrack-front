"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { unstable_serialize } from "swr/infinite";
import { ChatHeader } from "@/components/chat-header";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useArtifactSelector } from "@/hooks/use-artifact";
import { useAutoResume } from "@/hooks/use-auto-resume";
import { useChatVisibility } from "@/hooks/use-chat-visibility";
import type { Vote } from "@/lib/db/schema";
import { ChatSDKError } from "@/lib/errors";
import type {
  Attachment,
  BacktestArtifactItem,
  ChatMessage,
  PlotlyChartPayload,
  ThinkingActivityPayload,
} from "@/lib/types";
import { fetcher, fetchWithErrorHandlers, generateUUID } from "@/lib/utils";
import { Artifact } from "./artifact";
import { useDataStream } from "./data-stream-provider";
import { Messages } from "./messages";
import { MultimodalInput } from "./multimodal-input";
import { getChatHistoryPaginationKey } from "./sidebar-history";
import { toast } from "./toast";
import type { VisibilityType } from "./visibility-selector";

const TASK_AUTH_PATTERN =
  "\\[\\[task-auth:([A-Za-z0-9_-]+):([0-9]+):([A-Za-z0-9._-]+)\\]\\]";
const TASK_POLL_INTERVAL_MS = 2000;

type TaskStatusResponse = {
  status: string;
  isCompleted: boolean;
  isFailed?: boolean;
  nextCursor?: number;
  nextCursorSig?: string;
  events?: TaskPollEvent[];
  reasoningText?: string;
  text?: string;
  artifacts?: BacktestArtifactItem[];
  plotlyCharts?: PlotlyChartPayload[];
};

type TaskPollEvent =
  | { type: "reasoning-delta"; id?: string; delta: string }
  | { type: "thinking-activity"; activity: ThinkingActivityPayload }
  | { type: "text-delta"; delta: string }
  | { type: "text-replace"; text: string }
  | { type: "plotly-spec"; chart: PlotlyChartPayload }
  | { type: "artifact-items"; items: BacktestArtifactItem[] };

type TaskPollingMeta = {
  runId: string;
  cursor: number;
  cursorSig: string;
};

type DataTaskAuthPart = {
  type: "data-task-auth";
  data?: {
    runId?: unknown;
    cursor?: unknown;
    cursorSig?: unknown;
  };
};

type SetChatMessages = (
  messages: ChatMessage[] | ((messages: ChatMessage[]) => ChatMessage[])
) => void;

function normalizeBacktestArtifactItems(
  value: unknown
): BacktestArtifactItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized: BacktestArtifactItem[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const candidate = entry as Partial<BacktestArtifactItem>;
    const path =
      typeof candidate.path === "string" ? candidate.path.trim() : "";
    const url = typeof candidate.url === "string" ? candidate.url.trim() : "";
    const title =
      typeof candidate.title === "string" ? candidate.title.trim() : "";
    const kind =
      candidate.kind === "backtest-html" ||
      candidate.kind === "csv" ||
      candidate.kind === "other"
        ? candidate.kind
        : "other";
    if (!path || !url || !title) {
      continue;
    }
    normalized.push({ path, url, title, kind });
  }
  return normalized;
}

function normalizePlotlyCharts(value: unknown): PlotlyChartPayload[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const normalized: PlotlyChartPayload[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const candidate = entry as Partial<PlotlyChartPayload>;
    const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
    const data = Array.isArray(candidate.data) ? candidate.data : [];
    if (!id || !data.length) {
      continue;
    }
    const chart: PlotlyChartPayload = {
      id,
      data: data
        .filter(
          (item: unknown) =>
            typeof item === "object" && item !== null && !Array.isArray(item)
        )
        .map((item: unknown) => ({ ...(item as Record<string, unknown>) })),
      ...(typeof candidate.title === "string" && candidate.title.trim()
        ? { title: candidate.title.trim() }
        : {}),
      ...(candidate.layout &&
      typeof candidate.layout === "object" &&
      !Array.isArray(candidate.layout)
        ? { layout: { ...(candidate.layout as Record<string, unknown>) } }
        : {}),
      ...(candidate.config &&
      typeof candidate.config === "object" &&
      !Array.isArray(candidate.config)
        ? { config: { ...(candidate.config as Record<string, unknown>) } }
        : {}),
    };
    if (!chart.data.length) {
      continue;
    }
    normalized.push(chart);
  }
  return normalized;
}

function normalizeThinkingActivity(value: unknown): ThinkingActivityPayload | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = value as Partial<ThinkingActivityPayload>;
  const reasoningId =
    typeof candidate.reasoningId === "string" ? candidate.reasoningId.trim() : "";
  const kind = typeof candidate.kind === "string" ? candidate.kind.trim() : "";
  const label =
    typeof candidate.label === "string" ? candidate.label.trim() : "";
  if (!reasoningId || !kind || !label) {
    return null;
  }
  return {
    reasoningId,
    kind,
    label,
    active: candidate.active === true,
    ...(typeof candidate.eventType === "string" && candidate.eventType.trim()
      ? { eventType: candidate.eventType.trim() }
      : {}),
    ...(typeof candidate.itemType === "string" && candidate.itemType.trim()
      ? { itemType: candidate.itemType.trim() }
      : {}),
  };
}

function normalizeTaskPollEvents(value: unknown): TaskPollEvent[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized: TaskPollEvent[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const candidate = entry as Record<string, unknown>;
    const type = typeof candidate.type === "string" ? candidate.type : "";

    if (type === "reasoning-delta" || type === "text-delta") {
      if (typeof candidate.delta === "string" && candidate.delta) {
        if (type === "reasoning-delta") {
          normalized.push({
            type,
            delta: candidate.delta,
            ...(typeof candidate.id === "string" && candidate.id.trim()
              ? { id: candidate.id.trim() }
              : {}),
          });
        } else {
          normalized.push({ type, delta: candidate.delta });
        }
      }
      continue;
    }

    if (type === "thinking-activity") {
      const activity = normalizeThinkingActivity(
        (candidate as { activity?: unknown }).activity
      );
      if (activity) {
        normalized.push({ type: "thinking-activity", activity });
      }
      continue;
    }

    if (type === "text-replace") {
      if (typeof candidate.text === "string") {
        normalized.push({ type: "text-replace", text: candidate.text });
      }
      continue;
    }

    if (type === "plotly-spec") {
      const charts = normalizePlotlyCharts([
        (candidate as { chart?: unknown }).chart,
      ]);
      if (charts.length > 0) {
        normalized.push({ type: "plotly-spec", chart: charts[0] });
      }
      continue;
    }

    if (type === "artifact-items") {
      const items = normalizeBacktestArtifactItems(
        (candidate as { items?: unknown }).items
      );
      if (items.length > 0) {
        normalized.push({ type: "artifact-items", items });
      }
    }
  }

  return normalized;
}

function extractExistingPlotlyCharts(
  message: ChatMessage
): PlotlyChartPayload[] {
  const parts = Array.isArray(message.parts) ? message.parts : [];
  const charts: PlotlyChartPayload[] = [];
  for (const part of parts) {
    if (
      typeof part !== "object" ||
      part === null ||
      (part as { type?: unknown }).type !== "data-plotly-chart"
    ) {
      continue;
    }
    const normalized = normalizePlotlyCharts([
      (part as { data?: { chart?: unknown } }).data?.chart,
    ]);
    if (normalized.length > 0) {
      charts.push(normalized[0]);
    }
  }
  return charts;
}

function extractExistingArtifactItems(
  message: ChatMessage
): BacktestArtifactItem[] {
  const parts = Array.isArray(message.parts) ? message.parts : [];
  for (const part of parts) {
    if (
      typeof part !== "object" ||
      part === null ||
      (part as { type?: unknown }).type !== "data-backtest-artifact"
    ) {
      continue;
    }
    return normalizeBacktestArtifactItems(
      (part as { data?: { items?: unknown } }).data?.items
    );
  }
  return [];
}

function extractExistingThinkingActivity(
  message: ChatMessage
): ThinkingActivityPayload | null {
  const parts = Array.isArray(message.parts) ? message.parts : [];
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const part = parts[i];
    if (
      typeof part !== "object" ||
      part === null ||
      (part as { type?: unknown }).type !== "data-thinking-activity"
    ) {
      continue;
    }
    const normalized = normalizeThinkingActivity(
      (part as { data?: unknown }).data
    );
    if (normalized) {
      return normalized;
    }
  }
  return null;
}

function extractMessageText(message: ChatMessage) {
  const parts = Array.isArray(message.parts) ? message.parts : [];
  return parts
    .filter(
      (part) =>
        typeof part === "object" &&
        part !== null &&
        (part as { type?: unknown }).type === "text"
    )
    .map((part) => String((part as { text?: unknown }).text || ""))
    .join("\n");
}

function extractReasoningText(message: ChatMessage) {
  const parts = Array.isArray(message.parts) ? message.parts : [];
  return parts
    .filter(
      (part) =>
        typeof part === "object" &&
        part !== null &&
        (part as { type?: unknown }).type === "reasoning"
    )
    .map((part) => String((part as { text?: unknown }).text || ""))
    .join("\n");
}

function extractTaskPollingMetaFromMessage(
  message: ChatMessage
): TaskPollingMeta | null {
  const text = extractMessageText(message);
  let latest: TaskPollingMeta | null = null;
  const taskAuthRegex = new RegExp(TASK_AUTH_PATTERN, "g");

  for (const match of text.matchAll(taskAuthRegex)) {
    const runId = match[1] || "";
    const cursor = Number.parseInt(match[2] || "", 10);
    const cursorSig = match[3] || "";
    if (!runId || !Number.isFinite(cursor) || cursor < 0 || !cursorSig) {
      continue;
    }
    latest = { runId, cursor, cursorSig };
  }

  return latest;
}

function findLatestTaskMessageInLatestTurn(messages: ChatMessage[]) {
  let lastUserMessageIndex = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === "user") {
      lastUserMessageIndex = i;
      break;
    }
  }

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (i <= lastUserMessageIndex) {
      break;
    }
    const message = messages[i];
    if (message.role !== "assistant") {
      continue;
    }
    const taskMeta = extractTaskPollingMetaFromMessage(message);
    if (!taskMeta) {
      continue;
    }
    return { ...taskMeta, messageId: message.id };
  }

  return null;
}

function findLatestAssistantMessageIdInLatestTurn(messages: ChatMessage[]) {
  let lastUserMessageIndex = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === "user") {
      lastUserMessageIndex = i;
      break;
    }
  }

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (i <= lastUserMessageIndex) {
      break;
    }
    const message = messages[i];
    if (message.role === "assistant" && message.id) {
      return message.id;
    }
  }
  return "";
}

function extractTaskPollingMetaFromDataPart(
  dataPart: unknown
): TaskPollingMeta | null {
  if (!dataPart || typeof dataPart !== "object") {
    return null;
  }

  const candidate = dataPart as DataTaskAuthPart;
  if (candidate.type !== "data-task-auth" || !candidate.data) {
    return null;
  }

  const runId =
    typeof candidate.data.runId === "string" ? candidate.data.runId : "";
  const rawCursor = candidate.data.cursor;
  const cursor =
    typeof rawCursor === "number"
      ? Math.trunc(rawCursor)
      : Number.parseInt(String(rawCursor ?? ""), 10);
  const cursorSig =
    typeof candidate.data.cursorSig === "string"
      ? candidate.data.cursorSig
      : "";

  if (!runId || !Number.isFinite(cursor) || cursor < 0 || !cursorSig) {
    return null;
  }

  return { runId, cursor, cursorSig };
}

export function Chat({
  id,
  initialMessages,
  initialChatModel,
  initialVisibilityType,
  isReadonly,
  autoResume,
}: {
  id: string;
  initialMessages: ChatMessage[];
  initialChatModel: string;
  initialVisibilityType: VisibilityType;
  isReadonly: boolean;
  autoResume: boolean;
}) {
  const router = useRouter();

  const { visibilityType } = useChatVisibility({
    chatId: id,
    initialVisibilityType,
  });

  const { mutate } = useSWRConfig();

  // Handle browser back/forward navigation
  useEffect(() => {
    const handlePopState = () => {
      // When user navigates back/forward, refresh to sync with URL
      router.refresh();
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [router]);
  const { setDataStream } = useDataStream();

  const [input, setInput] = useState<string>("");
  const [showCreditCardAlert, setShowCreditCardAlert] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileResetNonce, setTurnstileResetNonce] = useState(0);
  const hadInFlightRequestRef = useRef(false);
  const pollingRunIdsRef = useRef<Set<string>>(new Set());
  const pollingTimersRef = useRef<Map<string, number>>(new Map());
  const pollingMessageIdsRef = useRef<Map<string, string>>(new Map());
  const pollingCursorRef = useRef<Map<string, number>>(new Map());
  const pollingCursorSigRef = useRef<Map<string, string>>(new Map());
  const pollingAbortControllersRef = useRef<Map<string, AbortController>>(
    new Map()
  );
  const pendingTaskMetaRef = useRef<TaskPollingMeta | null>(null);
  const setMessagesRef = useRef<SetChatMessages | null>(null);
  const hasRecoveredWatchdogRef = useRef(false);
  const unmountedRef = useRef(false);
  const turnstileTokenRef = useRef("");
  const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || "";

  useEffect(() => {
    return () => {
      unmountedRef.current = true;
      for (const timerId of pollingTimersRef.current.values()) {
        window.clearTimeout(timerId);
      }
      pollingTimersRef.current.clear();
      pollingRunIdsRef.current.clear();
      pollingMessageIdsRef.current.clear();
      pollingCursorRef.current.clear();
      pollingCursorSigRef.current.clear();
      for (const controller of pollingAbortControllersRef.current.values()) {
        controller.abort();
      }
      pollingAbortControllersRef.current.clear();
      pendingTaskMetaRef.current = null;
    };
  }, []);

  useEffect(() => {
    turnstileTokenRef.current = turnstileToken;
    if (typeof document !== "undefined") {
      if (turnstileToken) {
        document.cookie = `turnstile_token=${encodeURIComponent(
          turnstileToken
        )}; Path=/; SameSite=Lax`;
      } else {
        document.cookie = "turnstile_token=; Path=/; Max-Age=0; SameSite=Lax";
      }
    }
  }, [turnstileToken]);

  const stopPollingRun = (runId: string) => {
    if (!runId) {
      return;
    }
    pollingRunIdsRef.current.delete(runId);
    const timerId = pollingTimersRef.current.get(runId);
    if (typeof timerId === "number") {
      window.clearTimeout(timerId);
    }
    pollingTimersRef.current.delete(runId);
    pollingMessageIdsRef.current.delete(runId);
    pollingCursorRef.current.delete(runId);
    pollingCursorSigRef.current.delete(runId);
    const controller = pollingAbortControllersRef.current.get(runId);
    if (controller) {
      controller.abort();
    }
    pollingAbortControllersRef.current.delete(runId);
  };

  const stopAllPollingRuns = (activeRunId = "") => {
    const knownRunIds = new Set<string>([
      ...pollingRunIdsRef.current,
      ...pollingTimersRef.current.keys(),
      ...pollingMessageIdsRef.current.keys(),
      ...pollingCursorRef.current.keys(),
      ...pollingCursorSigRef.current.keys(),
      ...pollingAbortControllersRef.current.keys(),
    ]);
    for (const runId of knownRunIds) {
      if (activeRunId && runId === activeRunId) {
        continue;
      }
      stopPollingRun(runId);
    }
  };

  const startPollingRun = (
    runId: string,
    messageId: string,
    initialCursor: number,
    initialCursorSig: string
  ) => {
    if (!runId || !messageId || !initialCursorSig) {
      return;
    }

    if (pollingRunIdsRef.current.has(runId)) {
      pollingMessageIdsRef.current.set(runId, messageId);
      if (!pollingCursorRef.current.has(runId)) {
        pollingCursorRef.current.set(runId, initialCursor);
      }
      if (!pollingCursorSigRef.current.has(runId)) {
        pollingCursorSigRef.current.set(runId, initialCursorSig);
      }
      return;
    }

    pollingMessageIdsRef.current.set(runId, messageId);
    pollingCursorRef.current.set(runId, initialCursor);
    pollingCursorSigRef.current.set(runId, initialCursorSig);
    pollingRunIdsRef.current.add(runId);

    const poll = async () => {
      if (unmountedRef.current) {
        stopPollingRun(runId);
        return;
      }

      const controller = new AbortController();
      pollingAbortControllersRef.current.set(runId, controller);
      try {
        const cursor = pollingCursorRef.current.get(runId) || 0;
        const cursorSig = pollingCursorSigRef.current.get(runId) || "";
        if (!cursorSig) {
          stopPollingRun(runId);
          return;
        }
        const response = await fetch(
          `/api/tasks/${runId}?cursor=${cursor}&cursor_sig=${encodeURIComponent(
            cursorSig
          )}`,
          {
            method: "GET",
            cache: "no-store",
            signal: controller.signal,
          }
        );
        if (!response.ok) {
          if (response.status === 403 || response.status === 401) {
            let forbiddenCause = "";
            try {
              const errorPayload = (await response.json()) as { cause?: unknown };
              if (typeof errorPayload.cause === "string") {
                forbiddenCause = errorPayload.cause.trim();
              }
            } catch {
              // ignore malformed error payloads
            }

            const isRecoverableCursorIssue =
              response.status === 403 &&
              (forbiddenCause === "stale_cursor_state" ||
                forbiddenCause === "cursor_advance_conflict" ||
                forbiddenCause === "invalid_cursor_sig");
            if (isRecoverableCursorIssue) {
              stopPollingRun(runId);
              refetchMessages().catch(() => {
                // ignore transient refresh failures
              });
              return;
            }

            const updateMessages = setMessagesRef.current;
            if (updateMessages) {
              const activeMessageId =
                pollingMessageIdsRef.current.get(runId) || messageId;
              updateMessages((current) => {
                const targetMessageId = current.some(
                  (msg) => msg.id === activeMessageId
                )
                  ? activeMessageId
                  : findLatestAssistantMessageIdInLatestTurn(current);
                if (!targetMessageId) {
                  return current;
                }

                return current.map((msg) => {
                  if (msg.id !== targetMessageId) {
                    return msg;
                  }
                  return {
                    ...msg,
                    parts: [
                      {
                        type: "text" as const,
                        text:
                          forbiddenCause === "missing_task_session" ||
                          forbiddenCause === "task_session_mismatch"
                            ? "任务会话已失效，请刷新页面后重试。"
                            : "任务轮询鉴权已失效，请刷新页面后重试。",
                      },
                    ],
                  };
                });
              });
            }
            stopPollingRun(runId);
            return;
          }
          throw new Error(`Task status fetch failed (${response.status})`);
        }

        const payload = (await response.json()) as TaskStatusResponse;
        if (
          typeof payload.nextCursor !== "number" ||
          !Number.isFinite(payload.nextCursor) ||
          payload.nextCursor < 0 ||
          typeof payload.nextCursorSig !== "string" ||
          !payload.nextCursorSig
        ) {
          stopPollingRun(runId);
          throw new Error("Task status response missing next signed cursor");
        }
        pollingCursorRef.current.set(runId, payload.nextCursor);
        pollingCursorSigRef.current.set(runId, payload.nextCursorSig);

        const activeMessageId =
          pollingMessageIdsRef.current.get(runId) || messageId;
        const updateMessages = setMessagesRef.current;
        if (!updateMessages) {
          stopPollingRun(runId);
          return;
        }

        const resolveTargetMessageId = (current: ChatMessage[]) => {
          if (current.some((msg) => msg.id === activeMessageId)) {
            return activeMessageId;
          }
          const fallbackMessageId =
            findLatestAssistantMessageIdInLatestTurn(current);
          if (fallbackMessageId) {
            pollingMessageIdsRef.current.set(runId, fallbackMessageId);
            return fallbackMessageId;
          }
          return "";
        };

        const pollEvents = normalizeTaskPollEvents(payload.events);
        if (pollEvents.length === 0) {
          const reasoningDelta =
            typeof payload.reasoningText === "string"
              ? payload.reasoningText
              : "";
          const textValue =
            typeof payload.text === "string" ? payload.text : "";
          if (reasoningDelta) {
            pollEvents.push({ type: "reasoning-delta", delta: reasoningDelta });
          }
          if (textValue) {
            pollEvents.push(
              payload.isCompleted
                ? { type: "text-replace", text: textValue }
                : { type: "text-delta", delta: textValue }
            );
          }
          if (payload.isCompleted) {
            for (const chart of normalizePlotlyCharts(payload.plotlyCharts)) {
              pollEvents.push({ type: "plotly-spec", chart });
            }
            const artifactItems = normalizeBacktestArtifactItems(
              payload.artifacts
            );
            if (artifactItems.length > 0) {
              pollEvents.push({ type: "artifact-items", items: artifactItems });
            }
          }
        }

        if (pollEvents.length > 0 || payload.isCompleted) {
          updateMessages((current) => {
            const targetMessageId = resolveTargetMessageId(current);
            if (!targetMessageId) {
              return current;
            }

            return current.map((msg) => {
              if (msg.id !== targetMessageId) {
                return msg;
              }

              let nextReasoning = extractReasoningText(msg);
              let nextText = extractMessageText(msg);
              const chartById = new Map<string, PlotlyChartPayload>();
              for (const chart of extractExistingPlotlyCharts(msg)) {
                chartById.set(chart.id, chart);
              }
              let artifactItems = extractExistingArtifactItems(msg);
              let thinkingActivity = extractExistingThinkingActivity(msg);
              let sawThinkingActivityEvent = false;

              for (const event of pollEvents) {
                if (event.type === "reasoning-delta") {
                  nextReasoning += event.delta;
                  continue;
                }
                if (event.type === "thinking-activity") {
                  sawThinkingActivityEvent = true;
                  thinkingActivity = event.activity;
                  continue;
                }
                if (event.type === "text-delta") {
                  nextText += event.delta;
                  continue;
                }
                if (event.type === "text-replace") {
                  nextText = event.text;
                  continue;
                }
                if (event.type === "plotly-spec") {
                  chartById.set(event.chart.id, event.chart);
                  continue;
                }
                if (event.type === "artifact-items") {
                  artifactItems = event.items;
                }
              }

              if (payload.isCompleted && !sawThinkingActivityEvent) {
                thinkingActivity = thinkingActivity
                  ? { ...thinkingActivity, active: false, label: "已思考" }
                  : {
                      reasoningId: `thinking-${runId}`,
                      kind: "thinking",
                      label: "已思考",
                      active: false,
                    };
              }

              const chartParts = [...chartById.values()].map((chart) => ({
                type: "data-plotly-chart" as const,
                data: { chart },
              }));

              const nextParts = [
                ...(nextReasoning || thinkingActivity
                  ? [
                      {
                        type: "reasoning" as const,
                        text: nextReasoning || " ",
                        state: payload.isCompleted
                          ? ("done" as const)
                          : ("streaming" as const),
                      },
                    ]
                  : []),
                ...(nextText
                  ? [
                      {
                        type: "text" as const,
                        text: nextText,
                      },
                    ]
                  : []),
                ...(thinkingActivity
                  ? [
                      {
                        type: "data-thinking-activity" as const,
                        data: thinkingActivity,
                      },
                    ]
                  : []),
                ...(artifactItems.length > 0
                  ? [
                      {
                        type: "data-backtest-artifact" as const,
                        data: {
                          items: artifactItems,
                        },
                      },
                    ]
                  : []),
                ...chartParts,
              ] as ChatMessage["parts"];

              return {
                ...msg,
                parts: nextParts.length > 0 ? nextParts : msg.parts,
              };
            });
          });
        }

        if (payload.isCompleted) {
          stopPollingRun(runId);
          mutate(unstable_serialize(getChatHistoryPaginationKey));
          return;
        }

        if (payload.isFailed) {
          updateMessages((current) => {
            const targetMessageId = resolveTargetMessageId(current);
            if (!targetMessageId) {
              return current;
            }

            return current.map((msg) => {
              if (msg.id !== targetMessageId) {
                return msg;
              }
              return {
                ...msg,
                parts: [
                  { type: "text", text: `任务执行失败：${payload.status}` },
                ],
              };
            });
          });
          stopPollingRun(runId);
          return;
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        console.error(`[chat-ui] Task poll failed for ${runId}:`, error);
      } finally {
        const activeController = pollingAbortControllersRef.current.get(runId);
        if (activeController === controller) {
          pollingAbortControllersRef.current.delete(runId);
        }
      }

      if (!pollingRunIdsRef.current.has(runId)) {
        return;
      }

      const nextTimer = window.setTimeout(poll, TASK_POLL_INTERVAL_MS);
      pollingTimersRef.current.set(runId, nextTimer);
    };

    const firstTimer = window.setTimeout(poll, TASK_POLL_INTERVAL_MS);
    pollingTimersRef.current.set(runId, firstTimer);
  };

  const {
    messages,
    setMessages,
    sendMessage,
    status,
    stop,
    regenerate,
    resumeStream,
    addToolApprovalResponse,
  } = useChat<ChatMessage>({
    id,
    messages: initialMessages,
    generateId: generateUUID,
    sendAutomaticallyWhen: ({ messages: currentMessages }) => {
      const lastMessage = currentMessages.at(-1);
      const shouldContinue =
        lastMessage?.parts?.some(
          (part) =>
            "state" in part &&
            part.state === "approval-responded" &&
            "approval" in part &&
            (part.approval as { approved?: boolean })?.approved === true
        ) ?? false;
      return shouldContinue;
    },
    transport: new DefaultChatTransport({
      api: "/api/chat",
      fetch: fetchWithErrorHandlers,
      headers: () => {
        const token = (turnstileTokenRef.current || "").trim();
        const headers: Record<string, string> = {};
        if (token) {
          headers["x-turnstile-token"] = token;
          headers["cf-turnstile-response"] = token;
        }
        return headers;
      },
      prepareSendMessagesRequest(request) {
        const token = (turnstileTokenRef.current || "").trim();
        const lastMessage = request.messages.at(-1);
        const isToolApprovalContinuation =
          lastMessage?.role !== "user" ||
          request.messages.some((msg) =>
            msg.parts?.some((part) => {
              const state = (part as { state?: string }).state;
              return (
                state === "approval-responded" || state === "output-denied"
              );
            })
          );

        return {
          headers: token
            ? {
                "x-turnstile-token": token,
                "cf-turnstile-response": token,
              }
            : undefined,
          body: {
            id: request.id,
            ...(isToolApprovalContinuation
              ? { messages: request.messages }
              : { message: lastMessage }),
            selectedVisibilityType: visibilityType,
            ...(token ? { turnstileToken: token } : {}),
            ...request.body,
          },
        };
      },
    }),
    onData: (dataPart) => {
      setDataStream((ds) => (ds ? [...ds, dataPart] : []));
      const taskMeta = extractTaskPollingMetaFromDataPart(dataPart);
      if (taskMeta) {
        pendingTaskMetaRef.current = taskMeta;
      }
    },
    onFinish: ({ message, isAbort, isError }) => {
      mutate(unstable_serialize(getChatHistoryPaginationKey));

      if (isAbort || isError || !message || message.role !== "assistant") {
        return;
      }

      const taskMeta =
        extractTaskPollingMetaFromMessage(message as ChatMessage) ||
        pendingTaskMetaRef.current;
      if (!taskMeta) {
        return;
      }
      pendingTaskMetaRef.current = null;

      // Create one watchdog per completed /api/chat response message.
      stopAllPollingRuns(taskMeta.runId);
      startPollingRun(
        taskMeta.runId,
        message.id,
        taskMeta.cursor,
        taskMeta.cursorSig
      );
    },
    onError: (error) => {
      if (error instanceof ChatSDKError) {
        if (
          error.message?.includes("AI Gateway requires a valid credit card")
        ) {
          setShowCreditCardAlert(true);
        } else {
          toast({
            type: "error",
            description: error.message,
          });
        }
      }
    },
  });

  setMessagesRef.current = setMessages;

  const refetchMessages = useCallback(async () => {
    try {
      const response = await fetch(`/api/chat/${id}/messages`, {
        method: "GET",
        cache: "no-store",
      });

      if (!response.ok) {
        return;
      }

      const payload = (await response.json()) as { messages?: ChatMessage[] };
      if (!Array.isArray(payload.messages)) {
        return;
      }

      setMessages(payload.messages);
    } catch {
      // ignore transient refresh failures from background/foreground switches
    }
  }, [id, setMessages]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") {
        return;
      }

      if (status === "submitted" || status === "streaming") {
        if (autoResume) {
          void resumeStream().catch(() => {
            // ignore and let the user continue manually if reconnection fails
          });
        }
        return;
      }

      if (pollingRunIdsRef.current.size > 0) {
        return;
      }

      void refetchMessages();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [autoResume, refetchMessages, resumeStream, status]);

  const searchParams = useSearchParams();
  const query = searchParams.get("query");

  const [hasAppendedQuery, setHasAppendedQuery] = useState(false);

  useEffect(() => {
    if (status === "submitted" || status === "streaming") {
      hadInFlightRequestRef.current = true;
      return;
    }

    if (!hadInFlightRequestRef.current) {
      return;
    }

    if (status === "ready" || status === "error") {
      setTurnstileToken("");
      setTurnstileResetNonce((x) => x + 1);
      hadInFlightRequestRef.current = false;
    }
  }, [status]);

  useEffect(() => {
    if (query && !hasAppendedQuery) {
      if (turnstileSiteKey && !(turnstileTokenRef.current || "").trim()) {
        return;
      }
      sendMessage({
        role: "user" as const,
        parts: [{ type: "text", text: query }],
      });

      setHasAppendedQuery(true);
      window.history.replaceState({}, "", `/chat/${id}`);
    }
  }, [
    query,
    sendMessage,
    hasAppendedQuery,
    id,
    turnstileSiteKey,
    turnstileToken,
  ]);

  useEffect(() => {
    hasRecoveredWatchdogRef.current = false;
    stopAllPollingRuns();
    pendingTaskMetaRef.current = null;
  }, [id]);

  useEffect(() => {
    // A new chat submit started; stop previous watchdogs immediately.
    if (status === "submitted") {
      stopAllPollingRuns();
      pendingTaskMetaRef.current = null;
    }
  }, [status]);

  useEffect(() => {
    // Fallback guard: if onFinish misses for any reason, recover polling from latest task metadata.
    if (status === "submitted" || status === "streaming") {
      return;
    }

    const pendingTaskFromMessage = findLatestTaskMessageInLatestTurn(messages);
    if (pendingTaskFromMessage) {
      if (pollingRunIdsRef.current.has(pendingTaskFromMessage.runId)) {
        return;
      }

      stopAllPollingRuns(pendingTaskFromMessage.runId);
      startPollingRun(
        pendingTaskFromMessage.runId,
        pendingTaskFromMessage.messageId,
        pendingTaskFromMessage.cursor,
        pendingTaskFromMessage.cursorSig
      );
      return;
    }

    const pendingTaskFromData = pendingTaskMetaRef.current;
    if (!pendingTaskFromData) {
      return;
    }
    if (pollingRunIdsRef.current.has(pendingTaskFromData.runId)) {
      return;
    }
    const latestAssistantMessageId =
      findLatestAssistantMessageIdInLatestTurn(messages);
    if (!latestAssistantMessageId) {
      return;
    }

    stopAllPollingRuns(pendingTaskFromData.runId);
    startPollingRun(
      pendingTaskFromData.runId,
      latestAssistantMessageId,
      pendingTaskFromData.cursor,
      pendingTaskFromData.cursorSig
    );
    pendingTaskMetaRef.current = null;
  }, [messages, status]);

  useEffect(() => {
    if (hasRecoveredWatchdogRef.current) {
      return;
    }
    hasRecoveredWatchdogRef.current = true;

    const pendingTask = findLatestTaskMessageInLatestTurn(initialMessages);
    if (!pendingTask) {
      return;
    }
    stopAllPollingRuns(pendingTask.runId);
    startPollingRun(
      pendingTask.runId,
      pendingTask.messageId,
      pendingTask.cursor,
      pendingTask.cursorSig
    );
  }, [id, initialMessages]);

  const { data: votes } = useSWR<Vote[]>(
    messages.length >= 2 ? `/api/vote?chatId=${id}` : null,
    fetcher
  );

  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const isArtifactVisible = useArtifactSelector((state) => state.isVisible);

  useAutoResume({
    autoResume,
    initialMessages,
    resumeStream,
    setMessages,
  });

  return (
    <>
      <div className="overscroll-behavior-contain flex h-dvh min-w-0 touch-pan-y flex-col bg-background">
        <ChatHeader
          chatId={id}
          isReadonly={isReadonly}
          selectedVisibilityType={initialVisibilityType}
        />

        <Messages
          addToolApprovalResponse={addToolApprovalResponse}
          chatId={id}
          isArtifactVisible={isArtifactVisible}
          isReadonly={isReadonly}
          messages={messages}
          regenerate={regenerate}
          selectedModelId={initialChatModel}
          setMessages={setMessages}
          status={status}
          votes={votes}
        />

        <div className="sticky bottom-0 z-1 mx-auto flex w-full max-w-4xl gap-2 border-t-0 bg-background px-2 pb-3 md:px-4 md:pb-4">
          {!isReadonly && (
            <MultimodalInput
              attachments={attachments}
              chatId={id}
              input={input}
              messages={messages}
              onTurnstileTokenChange={setTurnstileToken}
              selectedVisibilityType={visibilityType}
              sendMessage={sendMessage}
              setAttachments={setAttachments}
              setInput={setInput}
              setMessages={setMessages}
              status={status}
              stop={stop}
              turnstileResetNonce={turnstileResetNonce}
              turnstileSiteKey={turnstileSiteKey}
              turnstileToken={turnstileToken}
            />
          )}
        </div>
      </div>

      <Artifact
        addToolApprovalResponse={addToolApprovalResponse}
        attachments={attachments}
        chatId={id}
        input={input}
        isReadonly={isReadonly}
        messages={messages}
        onTurnstileTokenChange={setTurnstileToken}
        regenerate={regenerate}
        selectedVisibilityType={visibilityType}
        sendMessage={sendMessage}
        setAttachments={setAttachments}
        setInput={setInput}
        setMessages={setMessages}
        status={status}
        stop={stop}
        turnstileResetNonce={turnstileResetNonce}
        turnstileSiteKey={turnstileSiteKey}
        turnstileToken={turnstileToken}
        votes={votes}
      />

      <AlertDialog
        onOpenChange={setShowCreditCardAlert}
        open={showCreditCardAlert}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Activate AI Gateway</AlertDialogTitle>
            <AlertDialogDescription>
              This application requires{" "}
              {process.env.NODE_ENV === "production" ? "the owner" : "you"} to
              activate Vercel AI Gateway.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                window.open(
                  "https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai%3Fmodal%3Dadd-credit-card",
                  "_blank"
                );
                window.location.href = "/";
              }}
            >
              Activate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
