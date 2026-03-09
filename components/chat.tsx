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
import {
  buildRealtimeTokenLogMeta,
  buildRealtimeTokenLogMetaSync,
  normalizeRealtimeApiHost,
  normalizeRealtimeError,
  validateRealtimeTokenRunScope,
} from "@/lib/realtime-log";
import {
  readRealtimeRunStream as readRealtimeRunStreamWithAuth,
  subscribeRealtimeRunStatus as subscribeRealtimeRunStatusWithAuth,
} from "@/lib/realtime-client";
import {
  decideTaskRecovery,
  shouldRetryRealtimeStreamError,
} from "@/lib/task-recovery";
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
const REALTIME_STREAM_RETRY_DELAY_MS = 1200;
const DEFAULT_TRIGGER_REALTIME_API_URL = "https://api.trigger.dev";
const DEFAULT_TRIGGER_STREAM_ID = "fund-chat-realtime";
const DEFAULT_TRIGGER_STREAM_TIMEOUT_SECONDS = 60;
const SUMMARY_MAX_CHARS = 18;
const SUMMARY_COMMAND_OR_TECH_REGEX =
  /\b(?:ls|pwd|cd|rg|grep|find|sed|awk|cat|head|tail|wc|curl|wget|python3?|node|npm|pnpm|pip3?|git|ps|pkill|kill|chmod|chown|mv|cp|mkdir|touch|echo|date|sleep|which|source|export|env|printenv|set|bash|sh|command_execution|tool_call|tool_result|web_search|plan_update|reasoning-delta|item\.completed|item\.delta|item\.started|spawn|stdout|stderr)\b/i;
const SUMMARY_SHELL_TOKEN_REGEX =
  /(?:\|\||&&|;|\||`|\$\(|\$\{|\b--[a-z0-9_-]+\b|<<<?|>>>?)/i;
const SUMMARY_PATH_REGEX = /(?:[A-Za-z0-9_.-]+\/){1,}[A-Za-z0-9_.-]*/;
const CJK_REGEX = /[\u3400-\u9fff]/;

function mapReasoningTitleFromItemType(itemType: string) {
  const normalized = String(itemType || "").toLowerCase().trim();
  if (normalized === "command_execution") {
    return "执行 shell 命令";
  }
  if (normalized === "web_search" || normalized === "web_fetch") {
    return "调用网络搜索中";
  }
  if (normalized === "file_write") {
    return "写文件";
  }
  if (normalized === "file_read") {
    return "读文件";
  }
  return "正在思考";
}

type TaskStatusResponse = {
  status: string;
  isCompleted: boolean;
  isFailed?: boolean;
  nextCursor?: number;
  nextCursorSig?: string;
  events?: TaskPollEvent[];
  reasoningText?: string;
  reasoningTitle?: string;
  artifacts?: BacktestArtifactItem[];
  plotlyCharts?: PlotlyChartPayload[];
};

type TaskPollEvent =
  | { type: "reasoning-delta"; id?: string; delta: string }
  | { type: "reasoning-summary-delta"; id?: string; delta: string }
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

type TaskRealtimeMeta = {
  apiUrl: string;
  publicAccessToken: string;
  streamId: string;
  readTimeoutSeconds: number;
};

type TaskRuntimeMeta = TaskPollingMeta & {
  realtime: TaskRealtimeMeta | null;
};

type RealtimeFailureLogInput = {
  phase: "stream" | "status";
  runId: string;
  taskMeta: TaskRuntimeMeta;
  error: unknown;
  willRetry: boolean;
};

type DataTaskAuthPart = {
  type: "data-task-auth";
  data?: {
    runId?: unknown;
    cursor?: unknown;
    cursorSig?: unknown;
    realtime?: unknown;
  };
};

type RealtimeChunk =
  | { type: "reasoning-delta"; id?: string; delta: string }
  | { type: "reasoning-summary-delta"; id?: string; delta: string }
  | {
      type: "thinking-activity";
      id?: string;
      activity: {
        kind: string;
        label: string;
        active: boolean;
        eventType?: string;
        itemType?: string;
      };
    }
  | { type: "text-delta"; id?: string; delta: string };

type SetChatMessages = (
  messages: ChatMessage[] | ((messages: ChatMessage[]) => ChatMessage[])
) => void;

function clipTextByChars(text: string, maxChars: number) {
  const chars = Array.from(text);
  if (chars.length <= maxChars) {
    return text;
  }
  return `${chars.slice(0, maxChars).join("")}…`;
}

function normalizeSummaryLine(line: string) {
  return line
    .replace(/\[(.*?)\]\((.*?)\)/g, "$1")
    .replace(/[*_`#>~]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeReasoningSummary(raw: string) {
  const normalized = raw.replace(/\r\n/g, "\n");
  const lines = normalized
    .split("\n")
    .map(normalizeSummaryLine)
    .filter(Boolean);

  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (!line) {
      continue;
    }
    if (!CJK_REGEX.test(line)) {
      continue;
    }
    if (SUMMARY_COMMAND_OR_TECH_REGEX.test(line)) {
      continue;
    }
    if (SUMMARY_SHELL_TOKEN_REGEX.test(line)) {
      continue;
    }
    if (SUMMARY_PATH_REGEX.test(line)) {
      continue;
    }
    if (/^[A-Za-z0-9_.\-/:\\]+$/.test(line)) {
      continue;
    }
    return clipTextByChars(line, SUMMARY_MAX_CHARS);
  }

  return "";
}

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

    if (
      type === "reasoning-delta" ||
      type === "reasoning-summary-delta" ||
      type === "text-delta"
    ) {
      if (typeof candidate.delta === "string" && candidate.delta) {
        if (type === "reasoning-delta" || type === "reasoning-summary-delta") {
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

function extractThinkingSummaryText(message: ChatMessage) {
  const parts = Array.isArray(message.parts) ? message.parts : [];
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const part = parts[i];
    if (
      typeof part !== "object" ||
      part === null ||
      (part as { type?: unknown }).type !== "data-thinking-summary"
    ) {
      continue;
    }
    const data = (part as { data?: { text?: unknown } }).data;
    const text =
      typeof data?.text === "string"
        ? sanitizeReasoningSummary(data.text)
        : "";
    if (text) {
      return text;
    }
  }
  return "";
}

function normalizeTaskRealtimeMeta(value: unknown): TaskRealtimeMeta | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as {
    apiUrl?: unknown;
    publicAccessToken?: unknown;
    streamId?: unknown;
    readTimeoutSeconds?: unknown;
  };
  const apiUrl =
    typeof candidate.apiUrl === "string" && candidate.apiUrl.trim()
      ? candidate.apiUrl.trim()
      : DEFAULT_TRIGGER_REALTIME_API_URL;
  const publicAccessToken =
    typeof candidate.publicAccessToken === "string"
      ? candidate.publicAccessToken.trim()
      : "";
  const streamId =
    typeof candidate.streamId === "string" && candidate.streamId.trim()
      ? candidate.streamId.trim()
      : DEFAULT_TRIGGER_STREAM_ID;
  const timeoutCandidate =
    typeof candidate.readTimeoutSeconds === "number"
      ? Math.trunc(candidate.readTimeoutSeconds)
      : Number.parseInt(String(candidate.readTimeoutSeconds ?? ""), 10);
  const readTimeoutSeconds =
    Number.isFinite(timeoutCandidate) && timeoutCandidate > 0
      ? timeoutCandidate
      : DEFAULT_TRIGGER_STREAM_TIMEOUT_SECONDS;

  if (!publicAccessToken) {
    return null;
  }

  return { apiUrl, publicAccessToken, streamId, readTimeoutSeconds };
}

async function logRealtimeSubscriptionFailure({
  phase,
  runId,
  taskMeta,
  error,
  willRetry,
}: RealtimeFailureLogInput) {
  const fallbackTokenMeta = {
    tokenPresent: false,
    tokenPrefix: "",
    tokenHash: "",
    tokenLength: 0,
  };
  let tokenMeta = fallbackTokenMeta;
  try {
    tokenMeta = await buildRealtimeTokenLogMeta(
      taskMeta.realtime?.publicAccessToken || ""
    );
  } catch (_) {
    tokenMeta = fallbackTokenMeta;
  }

  const normalizedError = normalizeRealtimeError(error);
  const eventName =
    phase === "stream"
      ? "realtime_stream_subscribe_failed"
      : "realtime_status_subscribe_failed";
  console.error(`[chat-ui][realtime] ${eventName}`, {
    runId,
    streamId: taskMeta.realtime?.streamId || DEFAULT_TRIGGER_STREAM_ID,
    apiUrlHost: normalizeRealtimeApiHost(
      taskMeta.realtime?.apiUrl || DEFAULT_TRIGGER_REALTIME_API_URL
    ),
    willRetry,
    ...tokenMeta,
    ...normalizedError,
  });
}

function extractTaskRuntimeMetaFromMessage(
  message: ChatMessage
): TaskRuntimeMeta | null {
  const parts = Array.isArray(message.parts) ? message.parts : [];
  let latestFromData: TaskRuntimeMeta | null = null;
  for (const part of parts) {
    const normalized = extractTaskRuntimeMetaFromDataPart(part);
    if (normalized) {
      latestFromData = normalized;
    }
  }
  if (latestFromData) {
    return latestFromData;
  }

  const text = extractMessageText(message);
  let latest: TaskRuntimeMeta | null = null;
  const taskAuthRegex = new RegExp(TASK_AUTH_PATTERN, "g");

  for (const match of text.matchAll(taskAuthRegex)) {
    const runId = match[1] || "";
    const cursor = Number.parseInt(match[2] || "", 10);
    const cursorSig = match[3] || "";
    if (!runId || !Number.isFinite(cursor) || cursor < 0 || !cursorSig) {
      continue;
    }
    latest = { runId, cursor, cursorSig, realtime: null };
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
    const taskMeta = extractTaskRuntimeMetaFromMessage(message);
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

function extractTaskRuntimeMetaFromDataPart(
  dataPart: unknown
): TaskRuntimeMeta | null {
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

  return {
    runId,
    cursor,
    cursorSig,
    realtime: normalizeTaskRealtimeMeta(candidate.data.realtime),
  };
}

function normalizeRealtimeChunk(raw: unknown): RealtimeChunk | null {
  if (typeof raw !== "string" || !raw.trim()) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }

  const candidate = parsed as {
    type?: unknown;
    id?: unknown;
    delta?: unknown;
    activity?: {
      kind?: unknown;
      label?: unknown;
      active?: unknown;
      eventType?: unknown;
      itemType?: unknown;
    };
  };
  const type = typeof candidate.type === "string" ? candidate.type : "";
  const id = typeof candidate.id === "string" ? candidate.id : undefined;

  if (
    (type === "reasoning-delta" ||
      type === "reasoning-summary-delta" ||
      type === "text-delta") &&
    typeof candidate.delta === "string"
  ) {
    return { type, id, delta: candidate.delta };
  }

  if (type === "thinking-activity" && candidate.activity) {
    const kind =
      typeof candidate.activity.kind === "string"
        ? candidate.activity.kind.trim()
        : "";
    const label =
      typeof candidate.activity.label === "string"
        ? candidate.activity.label.trim()
        : "";
    if (!kind || !label) {
      return null;
    }
    return {
      type: "thinking-activity",
      id,
      activity: {
        kind,
        label,
        active:
          typeof candidate.activity.active === "boolean"
            ? candidate.activity.active
            : Boolean(candidate.activity.active),
        ...(typeof candidate.activity.eventType === "string" &&
        candidate.activity.eventType.trim()
          ? { eventType: candidate.activity.eventType.trim() }
          : {}),
        ...(typeof candidate.activity.itemType === "string" &&
        candidate.activity.itemType.trim()
          ? { itemType: candidate.activity.itemType.trim() }
          : {}),
      },
    };
  }

  return null;
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
  const [realtimeIssue, setRealtimeIssue] = useState<{
    runId: string;
    message: string;
  } | null>(null);
  const pollingRunIdsRef = useRef<Set<string>>(new Set());
  const pollingTimersRef = useRef<Map<string, number>>(new Map());
  const pollingMessageIdsRef = useRef<Map<string, string>>(new Map());
  const pollingCursorRef = useRef<Map<string, number>>(new Map());
  const pollingCursorSigRef = useRef<Map<string, string>>(new Map());
  const pollingAbortControllersRef = useRef<Map<string, AbortController>>(
    new Map()
  );
  const realtimeRunIdsRef = useRef<Set<string>>(new Set());
  const realtimeStreamAbortControllersRef = useRef<
    Map<string, AbortController>
  >(new Map());
  const realtimeRunSubscriptionsRef = useRef<
    Map<string, { unsubscribe: () => void }>
  >(new Map());
  const completionSyncedRunsRef = useRef<Set<string>>(new Set());
  const taskMetaByRunIdRef = useRef<Map<string, TaskRuntimeMeta>>(new Map());
  const pendingTaskMetaRef = useRef<TaskRuntimeMeta | null>(null);
  const setMessagesRef = useRef<SetChatMessages | null>(null);
  const hasRecoveredWatchdogRef = useRef(false);
  const unmountedRef = useRef(false);

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
      for (const controller of realtimeStreamAbortControllersRef.current.values()) {
        controller.abort();
      }
      realtimeStreamAbortControllersRef.current.clear();
      for (const subscription of realtimeRunSubscriptionsRef.current.values()) {
        subscription.unsubscribe();
      }
      realtimeRunSubscriptionsRef.current.clear();
      realtimeRunIdsRef.current.clear();
      completionSyncedRunsRef.current.clear();
      taskMetaByRunIdRef.current.clear();
      pendingTaskMetaRef.current = null;
    };
  }, []);

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

  const stopRealtimeRun = (runId: string) => {
    if (!runId) {
      return;
    }
    realtimeRunIdsRef.current.delete(runId);
    const controller = realtimeStreamAbortControllersRef.current.get(runId);
    if (controller) {
      controller.abort();
    }
    realtimeStreamAbortControllersRef.current.delete(runId);
    const subscription = realtimeRunSubscriptionsRef.current.get(runId);
    if (subscription) {
      subscription.unsubscribe();
    }
    realtimeRunSubscriptionsRef.current.delete(runId);
  };

  const stopAllRealtimeRuns = (activeRunId = "") => {
    const runIds = new Set<string>([
      ...realtimeRunIdsRef.current,
      ...realtimeStreamAbortControllersRef.current.keys(),
      ...realtimeRunSubscriptionsRef.current.keys(),
    ]);
    for (const runId of runIds) {
      if (activeRunId && runId === activeRunId) {
        continue;
      }
      stopRealtimeRun(runId);
    }
  };

  const resolveTargetMessageIdForRun = (
    runId: string,
    defaultMessageId: string,
    current: ChatMessage[]
  ) => {
    const activeMessageId =
      pollingMessageIdsRef.current.get(runId) || defaultMessageId;
    if (current.some((msg) => msg.id === activeMessageId)) {
      return activeMessageId;
    }
    const fallbackMessageId = findLatestAssistantMessageIdInLatestTurn(current);
    if (fallbackMessageId) {
      pollingMessageIdsRef.current.set(runId, fallbackMessageId);
      return fallbackMessageId;
    }
    return "";
  };

  const replaceTaskMessageText = (
    runId: string,
    defaultMessageId: string,
    text: string
  ) => {
    const updateMessages = setMessagesRef.current;
    if (!updateMessages) {
      return;
    }
    updateMessages((current) => {
      const targetMessageId = resolveTargetMessageIdForRun(
        runId,
        defaultMessageId,
        current
      );
      if (!targetMessageId) {
        return current;
      }

      return current.map((msg) => {
        if (msg.id !== targetMessageId) {
          return msg;
        }
        return {
          ...msg,
          parts: [{ type: "text" as const, text }],
        };
      });
    });
  };

  const applyTaskEventsToMessage = (
    runId: string,
    defaultMessageId: string,
    events: TaskPollEvent[],
    isCompleted: boolean
  ) => {
    const updateMessages = setMessagesRef.current;
    if (!updateMessages) {
      return;
    }

    updateMessages((current) => {
      const targetMessageId = resolveTargetMessageIdForRun(
        runId,
        defaultMessageId,
        current
      );
      if (!targetMessageId) {
        return current;
      }

      return current.map((msg) => {
        if (msg.id !== targetMessageId) {
          return msg;
        }

        let nextReasoning = extractReasoningText(msg);
        let nextReasoningSummary = extractThinkingSummaryText(msg);
        let nextText = extractMessageText(msg);
        const chartById = new Map<string, PlotlyChartPayload>();
        for (const chart of extractExistingPlotlyCharts(msg)) {
          chartById.set(chart.id, chart);
        }
        let artifactItems = extractExistingArtifactItems(msg);
        let thinkingActivity = extractExistingThinkingActivity(msg);
        let sawThinkingActivityEvent = false;
        let latestNonThinkingReasoningTitle = "";

        for (const event of events) {
          if (event.type === "reasoning-delta") {
            nextReasoning += event.delta;
            continue;
          }
          if (event.type === "reasoning-summary-delta") {
            const sanitizedSummary = sanitizeReasoningSummary(event.delta);
            if (sanitizedSummary) {
              nextReasoningSummary = sanitizedSummary;
            }
            continue;
          }
          if (event.type === "thinking-activity") {
            sawThinkingActivityEvent = true;
            const mappedTitle = mapReasoningTitleFromItemType(
              event.activity.itemType || ""
            );
            if (mappedTitle && mappedTitle !== "正在思考") {
              latestNonThinkingReasoningTitle = mappedTitle;
            }
            if (event.activity.active) {
              thinkingActivity = event.activity;
            } else if (!thinkingActivity || !thinkingActivity.active) {
              thinkingActivity = event.activity;
            }
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
        if (latestNonThinkingReasoningTitle) {
          const mappedSummary = sanitizeReasoningSummary(
            latestNonThinkingReasoningTitle
          );
          if (mappedSummary) {
            nextReasoningSummary = mappedSummary;
          }
        }

        if (isCompleted && !sawThinkingActivityEvent) {
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
          ...(nextReasoning || thinkingActivity || nextReasoningSummary
            ? [
                {
                  type: "reasoning" as const,
                  text: nextReasoning || " ",
                  state: isCompleted
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
          ...(nextReasoningSummary.trim()
            ? [
                {
                  type: "data-thinking-summary" as const,
                  data: {
                    reasoningId:
                      thinkingActivity?.reasoningId || `thinking-${runId}`,
                    text: nextReasoningSummary.trim(),
                  },
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

            replaceTaskMessageText(
              runId,
              messageId,
              forbiddenCause === "missing_task_session" ||
                forbiddenCause === "task_session_mismatch"
                ? "任务会话已失效，请刷新页面后重试。"
                : "任务轮询鉴权已失效，请刷新页面后重试。"
            );
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

        const pollEvents = normalizeTaskPollEvents(payload.events);
        if (pollEvents.length === 0) {
          const reasoningDelta =
            typeof payload.reasoningText === "string" ? payload.reasoningText : "";
          const reasoningSummaryDelta =
            typeof payload.reasoningTitle === "string"
              ? sanitizeReasoningSummary(payload.reasoningTitle)
              : "";
          if (reasoningDelta) {
            pollEvents.push({ type: "reasoning-delta", delta: reasoningDelta });
          }
          if (reasoningSummaryDelta) {
            pollEvents.push({
              type: "reasoning-summary-delta",
              delta: reasoningSummaryDelta,
            });
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
          applyTaskEventsToMessage(runId, messageId, pollEvents, payload.isCompleted);
        }

        if (payload.isCompleted) {
          stopPollingRun(runId);
          mutate(unstable_serialize(getChatHistoryPaginationKey));
          return;
        }

        if (payload.isFailed) {
          replaceTaskMessageText(runId, messageId, `任务执行失败：${payload.status}`);
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

  const syncCompletionFromTasksApi = async (
    runId: string,
    messageId: string
  ) => {
    if (completionSyncedRunsRef.current.has(runId)) {
      return;
    }
    completionSyncedRunsRef.current.add(runId);
    const meta = taskMetaByRunIdRef.current.get(runId);
    if (!meta) {
      applyTaskEventsToMessage(runId, messageId, [], true);
      mutate(unstable_serialize(getChatHistoryPaginationKey));
      return;
    }

    try {
      const response = await fetch(
        `/api/tasks/${runId}?cursor=${meta.cursor}&cursor_sig=${encodeURIComponent(
          meta.cursorSig
        )}`,
        {
          method: "GET",
          cache: "no-store",
        }
      );

      if (!response.ok) {
        throw new Error(`Task completion sync failed (${response.status})`);
      }

      const payload = (await response.json()) as TaskStatusResponse;
      if (
        typeof payload.nextCursor === "number" &&
        Number.isFinite(payload.nextCursor)
      ) {
        pollingCursorRef.current.set(runId, payload.nextCursor);
      }
      if (typeof payload.nextCursorSig === "string" && payload.nextCursorSig) {
        pollingCursorSigRef.current.set(runId, payload.nextCursorSig);
      }

      const completionEvents = normalizeTaskPollEvents(payload.events).filter(
        (event) =>
          event.type === "text-replace" ||
          event.type === "plotly-spec" ||
          event.type === "artifact-items"
      );

      applyTaskEventsToMessage(runId, messageId, completionEvents, true);
      mutate(unstable_serialize(getChatHistoryPaginationKey));
    } catch (error) {
      console.error(`[chat-ui] Task completion sync failed for ${runId}:`, error);
      applyTaskEventsToMessage(runId, messageId, [], true);
      setRealtimeIssue({
        runId,
        message: "实时任务已结束，但完成态同步失败，请点击“手动补拉”。",
      });
    }
  };

  const startRealtimeRun = (taskMeta: TaskRuntimeMeta, messageId: string) => {
    const runId = taskMeta.runId;
    if (!runId || !messageId) {
      return;
    }

    taskMetaByRunIdRef.current.set(runId, taskMeta);
    pollingMessageIdsRef.current.set(runId, messageId);

    if (realtimeRunIdsRef.current.has(runId)) {
      return;
    }

    if (!taskMeta.realtime) {
      const decision = decideTaskRecovery({
        reason: "missing_realtime",
        hasCursorSig: Boolean(taskMeta.cursorSig),
      });
      setRealtimeIssue({ runId, message: decision.issueMessage });
      if (decision.shouldStartPolling) {
        startPollingRun(runId, messageId, taskMeta.cursor, taskMeta.cursorSig);
      }
      return;
    }

    const scopeCheck = validateRealtimeTokenRunScope(
      taskMeta.realtime.publicAccessToken,
      runId
    );
    if (!scopeCheck.allowed) {
      const tokenMeta = buildRealtimeTokenLogMetaSync(
        taskMeta.realtime.publicAccessToken
      );
      console.error("[chat-ui][realtime] realtime_token_scope_mismatch", {
        runId,
        streamId: taskMeta.realtime.streamId || DEFAULT_TRIGGER_STREAM_ID,
        apiUrlHost: normalizeRealtimeApiHost(
          taskMeta.realtime.apiUrl || DEFAULT_TRIGGER_REALTIME_API_URL
        ),
        ...tokenMeta,
        scopesPreview: scopeCheck.scopes.slice(0, 5),
      });
      const decision = decideTaskRecovery({
        reason: "realtime_stream_error",
        hasCursorSig: Boolean(taskMeta.cursorSig),
      });
      setRealtimeIssue({
        runId,
        message: "实时令牌与任务不匹配，已自动切换轮询同步。",
      });
      if (decision.shouldStartPolling) {
        startPollingRun(runId, messageId, taskMeta.cursor, taskMeta.cursorSig);
      }
      return;
    }

    setRealtimeIssue((current) => (current?.runId === runId ? null : current));
    stopPollingRun(runId);
    realtimeRunIdsRef.current.add(runId);
    const streamController = new AbortController();
    realtimeStreamAbortControllersRef.current.set(runId, streamController);
    const realtimeAuth = {
      apiUrl: taskMeta.realtime?.apiUrl || DEFAULT_TRIGGER_REALTIME_API_URL,
      publicAccessToken: taskMeta.realtime?.publicAccessToken || "",
    };

    const consumeRealtimeStream = async () => {
      while (!unmountedRef.current && realtimeRunIdsRef.current.has(runId)) {
        try {
          const stream = await readRealtimeRunStreamWithAuth({
            runId,
            streamId: taskMeta.realtime?.streamId || DEFAULT_TRIGGER_STREAM_ID,
            signal: streamController.signal,
            timeoutInSeconds:
              taskMeta.realtime?.readTimeoutSeconds ||
              DEFAULT_TRIGGER_STREAM_TIMEOUT_SECONDS,
            realtime: realtimeAuth,
          });
          for await (const rawChunk of stream) {
            if (!realtimeRunIdsRef.current.has(runId)) {
              return;
            }
            const normalized = normalizeRealtimeChunk(rawChunk);
            if (!normalized) {
              continue;
            }
            if (normalized.type === "thinking-activity") {
              applyTaskEventsToMessage(
                runId,
                messageId,
                [
                  {
                    type: "thinking-activity",
                    activity: {
                      reasoningId: normalized.id || `thinking-${runId}`,
                      kind: normalized.activity.kind,
                      label: normalized.activity.label,
                      active: normalized.activity.active,
                      ...(normalized.activity.eventType
                        ? { eventType: normalized.activity.eventType }
                        : {}),
                      ...(normalized.activity.itemType
                        ? { itemType: normalized.activity.itemType }
                        : {}),
                    },
                  },
                ],
                false
              );
              continue;
            }
            applyTaskEventsToMessage(
              runId,
              messageId,
              [
                normalized.type === "text-delta"
                  ? { type: "text-delta", delta: normalized.delta }
                  : normalized.type === "reasoning-delta"
                    ? {
                        type: "reasoning-delta",
                        id: normalized.id,
                        delta: normalized.delta,
                      }
                    : {
                        type: "reasoning-summary-delta",
                        id: normalized.id,
                        delta: normalized.delta,
                      },
              ],
              false
            );
          }
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") {
            return;
          }
          const shouldRetry = shouldRetryRealtimeStreamError(error);
          await logRealtimeSubscriptionFailure({
            phase: "stream",
            runId,
            taskMeta,
            error,
            willRetry: shouldRetry,
          });
          if (shouldRetry && realtimeRunIdsRef.current.has(runId)) {
            await new Promise<void>((resolve) => {
              window.setTimeout(resolve, REALTIME_STREAM_RETRY_DELAY_MS);
            });
            continue;
          }
          console.error(`[chat-ui] Realtime stream failed for ${runId}:`, error);
          const decision = decideTaskRecovery({
            reason: "realtime_stream_error",
            hasCursorSig: Boolean(taskMeta.cursorSig),
          });
          setRealtimeIssue({ runId, message: decision.issueMessage });
          stopRealtimeRun(runId);
          if (decision.shouldStartPolling) {
            startPollingRun(runId, messageId, taskMeta.cursor, taskMeta.cursorSig);
          }
          return;
        }
      }
    };

    const watchRunStatus = async () => {
      try {
        const subscription = await subscribeRealtimeRunStatusWithAuth({
          runId,
          realtime: realtimeAuth,
          skipColumns: ["payload", "output"],
        });
        realtimeRunSubscriptionsRef.current.set(runId, subscription);
        for await (const run of subscription) {
          if (!realtimeRunIdsRef.current.has(runId)) {
            subscription.unsubscribe();
            return;
          }
          if (run.isFailed) {
            replaceTaskMessageText(runId, messageId, `任务执行失败：${run.status}`);
            setRealtimeIssue({
              runId,
              message: `实时任务失败：${run.status}。可点击“手动补拉”确认最终状态。`,
            });
            stopRealtimeRun(runId);
            return;
          }
          if (run.isCompleted) {
            await syncCompletionFromTasksApi(runId, messageId);
            stopRealtimeRun(runId);
            return;
          }
        }
      } catch (error) {
        await logRealtimeSubscriptionFailure({
          phase: "status",
          runId,
          taskMeta,
          error,
          willRetry: false,
        });
        console.error(`[chat-ui] Realtime status failed for ${runId}:`, error);
        const decision = decideTaskRecovery({
          reason: "realtime_status_error",
          hasCursorSig: Boolean(taskMeta.cursorSig),
        });
        setRealtimeIssue({ runId, message: decision.issueMessage });
        stopRealtimeRun(runId);
        if (decision.shouldStartPolling) {
          startPollingRun(runId, messageId, taskMeta.cursor, taskMeta.cursorSig);
        }
      }
    };

    consumeRealtimeStream().catch((error) => {
      console.error(`[chat-ui] Realtime stream setup failed for ${runId}:`, error);
    });
    watchRunStatus().catch((error) => {
      console.error(`[chat-ui] Realtime status setup failed for ${runId}:`, error);
    });
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
      prepareSendMessagesRequest(request) {
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
          body: {
            id: request.id,
            ...(isToolApprovalContinuation
              ? { messages: request.messages }
              : { message: lastMessage }),
            selectedVisibilityType: visibilityType,
            ...request.body,
          },
        };
      },
    }),
    onData: (dataPart) => {
      setDataStream((ds) => (ds ? [...ds, dataPart] : []));
      const taskMeta = extractTaskRuntimeMetaFromDataPart(dataPart);
      if (taskMeta) {
        pendingTaskMetaRef.current = taskMeta;
        taskMetaByRunIdRef.current.set(taskMeta.runId, taskMeta);
      }
    },
    onFinish: ({ message, isAbort, isError }) => {
      mutate(unstable_serialize(getChatHistoryPaginationKey));

      if (isAbort || isError || !message || message.role !== "assistant") {
        return;
      }

      const taskMeta =
        extractTaskRuntimeMetaFromMessage(message as ChatMessage) ||
        pendingTaskMetaRef.current;
      if (!taskMeta) {
        return;
      }
      pendingTaskMetaRef.current = null;
      taskMetaByRunIdRef.current.set(taskMeta.runId, taskMeta);

      // Create one watchdog per completed /api/chat response message.
      stopAllPollingRuns(taskMeta.runId);
      stopAllRealtimeRuns(taskMeta.runId);
      startRealtimeRun(taskMeta, message.id);
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

      if (
        pollingRunIdsRef.current.size > 0 ||
        realtimeRunIdsRef.current.size > 0
      ) {
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
    if (query && !hasAppendedQuery) {
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
  ]);

  useEffect(() => {
    hasRecoveredWatchdogRef.current = false;
    stopAllPollingRuns();
    stopAllRealtimeRuns();
    setRealtimeIssue(null);
    completionSyncedRunsRef.current.clear();
    taskMetaByRunIdRef.current.clear();
    pendingTaskMetaRef.current = null;
  }, [id]);

  useEffect(() => {
    // A new chat submit started; stop previous watchdogs immediately.
    if (status === "submitted") {
      stopAllPollingRuns();
      stopAllRealtimeRuns();
      setRealtimeIssue(null);
      completionSyncedRunsRef.current.clear();
      pendingTaskMetaRef.current = null;
    }
  }, [status]);

  useEffect(() => {
    // Fallback guard: if onFinish misses for any reason, recover realtime subscription from latest task metadata.
    if (status === "submitted" || status === "streaming") {
      return;
    }

    const pendingTaskFromMessage = findLatestTaskMessageInLatestTurn(messages);
    if (pendingTaskFromMessage) {
      if (
        realtimeRunIdsRef.current.has(pendingTaskFromMessage.runId) ||
        pollingRunIdsRef.current.has(pendingTaskFromMessage.runId)
      ) {
        return;
      }

      taskMetaByRunIdRef.current.set(
        pendingTaskFromMessage.runId,
        pendingTaskFromMessage
      );
      stopAllPollingRuns(pendingTaskFromMessage.runId);
      stopAllRealtimeRuns(pendingTaskFromMessage.runId);
      startRealtimeRun(pendingTaskFromMessage, pendingTaskFromMessage.messageId);
      return;
    }

    const pendingTaskFromData = pendingTaskMetaRef.current;
    if (!pendingTaskFromData) {
      return;
    }
    if (
      realtimeRunIdsRef.current.has(pendingTaskFromData.runId) ||
      pollingRunIdsRef.current.has(pendingTaskFromData.runId)
    ) {
      return;
    }
    const latestAssistantMessageId =
      findLatestAssistantMessageIdInLatestTurn(messages);
    if (!latestAssistantMessageId) {
      return;
    }

    stopAllPollingRuns(pendingTaskFromData.runId);
    stopAllRealtimeRuns(pendingTaskFromData.runId);
    startRealtimeRun(pendingTaskFromData, latestAssistantMessageId);
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
    taskMetaByRunIdRef.current.set(pendingTask.runId, pendingTask);
    stopAllPollingRuns(pendingTask.runId);
    stopAllRealtimeRuns(pendingTask.runId);
    startRealtimeRun(pendingTask, pendingTask.messageId);
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

  const handleManualTaskSync = useCallback(() => {
    const issue = realtimeIssue;
    if (!issue) {
      return;
    }
    const taskMeta = taskMetaByRunIdRef.current.get(issue.runId);
    if (!taskMeta) {
      toast({
        type: "error",
        description: "当前任务缺少补拉参数，请刷新页面后重试。",
      });
      return;
    }

    const messageId =
      pollingMessageIdsRef.current.get(issue.runId) ||
      findLatestAssistantMessageIdInLatestTurn(messages);
    if (!messageId) {
      toast({
        type: "error",
        description: "未找到可更新的回复消息，请刷新页面后重试。",
      });
      return;
    }

    stopRealtimeRun(issue.runId);
    completionSyncedRunsRef.current.delete(issue.runId);
    replaceTaskMessageText(issue.runId, messageId, "正在手动补拉任务结果...");
    startPollingRun(
      taskMeta.runId,
      messageId,
      taskMeta.cursor,
      taskMeta.cursorSig
    );
    setRealtimeIssue(null);
  }, [messages, realtimeIssue]);

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

        <div className="sticky bottom-0 z-1 mx-auto flex w-full max-w-4xl flex-col gap-2 border-t-0 bg-background px-2 pb-3 md:px-4 md:pb-4">
          {realtimeIssue ? (
            <div className="mb-2 flex w-full items-center justify-between rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <span>{realtimeIssue.message}</span>
              <button
                className="rounded border border-amber-500 px-2 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100"
                onClick={handleManualTaskSync}
                type="button"
              >
                手动补拉
              </button>
            </div>
          ) : null}
          {!isReadonly && (
            <MultimodalInput
              attachments={attachments}
              chatId={id}
              input={input}
              messages={messages}
              selectedVisibilityType={visibilityType}
              sendMessage={sendMessage}
              setAttachments={setAttachments}
              setInput={setInput}
              setMessages={setMessages}
              status={status}
              stop={stop}
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
        regenerate={regenerate}
        selectedVisibilityType={visibilityType}
        sendMessage={sendMessage}
        setAttachments={setAttachments}
        setInput={setInput}
        setMessages={setMessages}
        status={status}
        stop={stop}
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
