import { geolocation } from "@vercel/functions";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateId,
  stepCountIs,
  streamText,
} from "ai";
import { after } from "next/server";
import { createResumableStreamContext } from "resumable-stream";
import { auth as triggerAuth, runs, tasks } from "@trigger.dev/sdk";
import { auth, type UserType } from "@/app/(auth)/auth";
import { entitlementsByUserType } from "@/lib/ai/entitlements";
import { DEFAULT_CHAT_MODEL } from "@/lib/ai/models";
import { type RequestHints, systemPrompt } from "@/lib/ai/prompts";
import { getLanguageModel } from "@/lib/ai/providers";
import { createDocument } from "@/lib/ai/tools/create-document";
import { getWeather } from "@/lib/ai/tools/get-weather";
import { requestSuggestions } from "@/lib/ai/tools/request-suggestions";
import { updateDocument } from "@/lib/ai/tools/update-document";
import { buildArtifactItems } from "@/lib/artifacts";
import {
  isProductionEnvironment,
  TASK_SESSION_COOKIE_NAME,
} from "@/lib/constants";
import {
  createStreamId,
  deleteChatById,
  getChatById,
  getMessageCountByUserId,
  getMessagesByChatId,
  saveChat,
  saveMessages,
  updateChatTitleById,
  updateMessage,
} from "@/lib/db/queries";
import type { DBMessage } from "@/lib/db/schema";
import { ChatSDKError } from "@/lib/errors";
import {
  extractPlotlyChartsFromText,
  normalizePlotlyCharts,
} from "@/lib/plotly";
import { isRedisConfigured } from "@/lib/redis";
import {
  buildRealtimeTokenLogMeta,
  normalizeRealtimeApiHost,
  normalizeRealtimeError,
} from "@/lib/realtime-log";
import {
  DEFAULT_TRIGGER_REALTIME_TIMEOUT_SECONDS,
  normalizeRealtimeTimeoutSeconds,
} from "@/lib/realtime-timeout";
import {
  pickNextTriggerAccount,
  toTriggerClientConfig,
} from "@/lib/trigger-accounts";
import {
  getTaskRunMessageId,
  getTaskOwnerTtlSeconds,
  hashTaskSessionId,
  initializeTaskCursorState,
  readTaskSessionIdFromCookieHeader,
  saveTaskRunMessageId,
  saveTaskRunOwner,
  signTaskCursor,
} from "@/lib/task-security";
import type { ChatMessage, ThinkingActivityPayload } from "@/lib/types";
import { convertToUIMessages, generateUUID } from "@/lib/utils";
import type { fundChatTask } from "@/trigger/fund-chat-task";
import { generateTitleFromUserMessage } from "../../actions";
import { buildTriggerIdempotencyKey } from "./idempotency";
import { type PostRequestBody, postRequestBodySchema } from "./schema";
import { shouldRejectByDailyQuota } from "./quota-guard";

// Vercel Hobby plan limit: Serverless Function maxDuration must be <= 300s.
export const maxDuration = 300;

const DEFAULT_BACKEND = "claude_proxy";
const FIXED_CHAT_MODEL =
  process.env.CODEX_MODEL || process.env.CLAUDE_CODE_MODEL || "gpt-5.3-codex";
const CLAUDE_PROXY_SUPPORTED_MODELS = new Set([
  "gpt-5.2-codex",
  "gpt-5.3-codex",
  "gpt-5.4",
]);
const USE_TRIGGER_DEV =
  (process.env.USE_TRIGGER_DEV || "false").toLowerCase() === "true";
const CHAT_API_DEBUG_VERBOSE =
  (process.env.CHAT_API_DEBUG_VERBOSE || "false").toLowerCase() === "true";
const TRIGGER_REALTIME_STREAM_ID = "fund-chat-realtime";
const TRIGGER_REALTIME_PUBLIC_TOKEN_TTL =
  process.env.TRIGGER_REALTIME_PUBLIC_TOKEN_TTL || "30m";
const TRIGGER_REALTIME_READ_TIMEOUT_SECONDS = normalizeRealtimeTimeoutSeconds(
  process.env.TRIGGER_STREAM_READ_TIMEOUT_SECONDS,
  DEFAULT_TRIGGER_REALTIME_TIMEOUT_SECONDS
);

function getStreamContext() {
  try {
    return createResumableStreamContext({ waitUntil: after });
  } catch (_) {
    return null;
  }
}

function isQuotaDisabled() {
  return (
    (process.env.DISABLE_CHAT_DAILY_QUOTA || "false").toLowerCase() === "true"
  );
}

function resolveClaudeProxyModel(selectedChatModel?: string) {
  const requestedModel = selectedChatModel?.trim() || "";
  if (CLAUDE_PROXY_SUPPORTED_MODELS.has(requestedModel)) {
    return requestedModel;
  }
  return FIXED_CHAT_MODEL;
}

function extractTextFromParts(
  parts: Array<{ type: string; text?: string }> | undefined
) {
  if (!parts?.length) {
    return "";
  }

  return parts
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text as string)
    .join("\n")
    .trim();
}

function extractLatestUserText(body: PostRequestBody) {
  if (body.message?.role === "user") {
    return extractTextFromParts(
      body.message.parts as Array<{ type: string; text?: string }>
    );
  }

  if (Array.isArray(body.messages)) {
    for (let i = body.messages.length - 1; i >= 0; i -= 1) {
      const current = body.messages[i] as {
        role?: string;
        parts?: Array<{ type?: string; text?: string }>;
      };
      if (current?.role !== "user") {
        continue;
      }

      const parts = Array.isArray(current.parts)
        ? current.parts.map((part) => ({
            type: String(part?.type || ""),
            text: typeof part?.text === "string" ? part.text : undefined,
          }))
        : undefined;

      const text = extractTextFromParts(parts);
      if (text) {
        return text;
      }
    }
  }

  return "";
}

type LatestUserAttachment = {
  name: string;
  url: string;
  mediaType: string;
};

function normalizeFilePart(part: unknown): LatestUserAttachment | null {
  if (!part || typeof part !== "object") {
    return null;
  }
  const candidate = part as {
    type?: unknown;
    url?: unknown;
    name?: unknown;
    filename?: unknown;
    mediaType?: unknown;
    contentType?: unknown;
  };

  if (candidate.type !== "file") {
    return null;
  }

  const url = typeof candidate.url === "string" ? candidate.url.trim() : "";
  if (!url) {
    return null;
  }

  const nameCandidate =
    typeof candidate.name === "string"
      ? candidate.name
      : typeof candidate.filename === "string"
        ? candidate.filename
        : "uploaded_file";
  const mediaTypeCandidate =
    typeof candidate.mediaType === "string"
      ? candidate.mediaType
      : typeof candidate.contentType === "string"
        ? candidate.contentType
        : "application/octet-stream";

  return {
    name: nameCandidate.trim() || "uploaded_file",
    url,
    mediaType: mediaTypeCandidate.trim() || "application/octet-stream",
  };
}

function extractLatestUserAttachments(body: PostRequestBody): LatestUserAttachment[] {
  const collectFromParts = (parts: unknown): LatestUserAttachment[] => {
    if (!Array.isArray(parts)) {
      return [];
    }
    return parts
      .map((part) => normalizeFilePart(part))
      .filter((item): item is LatestUserAttachment => Boolean(item));
  };

  if (body.message?.role === "user") {
    return collectFromParts(body.message.parts);
  }

  if (Array.isArray(body.messages)) {
    for (let i = body.messages.length - 1; i >= 0; i -= 1) {
      const current = body.messages[i] as { role?: unknown; parts?: unknown };
      if (current?.role !== "user") {
        continue;
      }
      return collectFromParts(current.parts);
    }
  }

  return [];
}

function extractLatestUserMessageId(body: PostRequestBody) {
  if (body.message?.role === "user" && typeof body.message.id === "string") {
    return body.message.id;
  }

  if (Array.isArray(body.messages)) {
    for (let i = body.messages.length - 1; i >= 0; i -= 1) {
      const current = body.messages[i] as {
        id?: unknown;
        role?: string;
      };
      if (current?.role !== "user") {
        continue;
      }
      if (typeof current.id === "string" && current.id.trim()) {
        return current.id;
      }
    }
  }

  return "";
}

function chatDebug(event: string, payload?: Record<string, unknown>) {
  if (!CHAT_API_DEBUG_VERBOSE) {
    return;
  }
  if (payload) {
    console.log(`[chat-api][debug] ${event}`, payload);
    return;
  }
  console.log(`[chat-api][debug] ${event}`);
}

function buildTaskSessionCookieHeader(taskSessionId: string) {
  const maxAgeSeconds = 30 * 24 * 60 * 60;
  const attributes = [
    `${TASK_SESSION_COOKIE_NAME}=${encodeURIComponent(taskSessionId)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (isProductionEnvironment) {
    attributes.push("Secure");
  }
  return attributes.join("; ");
}

type ClaudeProxyPrecheckResult = {
  allowed: boolean;
  reason: string;
  reply: string;
};

function normalizeThinkingActivityDelta(
  value: unknown,
  reasoningId: string
): ThinkingActivityPayload | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as {
    kind?: unknown;
    label?: unknown;
    active?: unknown;
    eventType?: unknown;
    itemType?: unknown;
  };
  const kind =
    typeof candidate.kind === "string" && candidate.kind.trim()
      ? candidate.kind.trim()
      : "thinking";
  const label =
    typeof candidate.label === "string" && candidate.label.trim()
      ? candidate.label.trim()
      : "正在思考";
  const active =
    typeof candidate.active === "boolean" ? candidate.active : Boolean(candidate.active);
  const eventType =
    typeof candidate.eventType === "string" && candidate.eventType.trim()
      ? candidate.eventType.trim()
      : undefined;
  const itemType =
    typeof candidate.itemType === "string" && candidate.itemType.trim()
      ? candidate.itemType.trim()
      : undefined;

  return {
    reasoningId,
    kind,
    label,
    active,
    ...(eventType ? { eventType } : {}),
    ...(itemType ? { itemType } : {}),
  };
}

async function precheckClaudeProxyInput({
  chatId,
  isNewChat,
  userText,
  userType,
  model,
}: {
  chatId: string;
  isNewChat: boolean;
  userText: string;
  userType: UserType;
  model: string;
}): Promise<ClaudeProxyPrecheckResult> {
  const rawBase = process.env.CLAUDE_CODE_API_BASE || "http://127.0.0.1:15722";
  const base = rawBase.replace(/\/+$/, "");
  const token = process.env.CLAUDE_CODE_GATEWAY_TOKEN;
  if (!token) {
    throw new Error("Missing CLAUDE_CODE_GATEWAY_TOKEN");
  }

  const response = await fetch(`${base}/v1/policy/check`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      "x-chat-id": chatId,
      "x-chat-new": isNewChat ? "true" : "false",
      "x-user-type": userType,
    },
    body: JSON.stringify({
      model,
      text: userText,
      messages: [{ role: "user", content: userText }],
    }),
  });

  const raw = await response.text().catch(() => "");
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    parsed = null;
  }

  const reason =
    parsed && typeof parsed.reason === "string"
      ? parsed.reason
      : response.ok
        ? "unknown"
        : `http_${response.status}`;
  const reply =
    parsed && typeof parsed.reply === "string" && parsed.reply.trim()
      ? parsed.reply
      : parsed &&
          typeof (parsed.error as { message?: unknown } | undefined)
            ?.message === "string" &&
          String((parsed.error as { message?: unknown }).message || "").trim()
        ? String((parsed.error as { message?: unknown }).message)
        : raw ||
          response.statusText ||
          "该请求当前未通过策略校验，请调整后重试。";

  if (!response.ok) {
    throw new Error(
      `Claude proxy precheck failed (${response.status}): ${reply || response.statusText}`
    );
  }

  const allowed = parsed?.allowed === true;
  return {
    allowed,
    reason,
    reply: allowed ? "" : reply,
  };
}

async function streamFromClaudeProxy({
  dataStream,
  chatId,
  isNewChat,
  userText,
  attachments,
  userType,
  model,
}: {
  dataStream: any;
  chatId: string;
  isNewChat: boolean;
  userText: string;
  attachments: LatestUserAttachment[];
  userType: UserType;
  model: string;
}) {
  const rawBase = process.env.CLAUDE_CODE_API_BASE || "http://127.0.0.1:15722";
  const base = rawBase.replace(/\/+$/, "");
  const token = process.env.CLAUDE_CODE_GATEWAY_TOKEN;

  if (!token) {
    throw new Error("Missing CLAUDE_CODE_GATEWAY_TOKEN");
  }

  const upstream = await fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      "x-chat-id": chatId,
      "x-chat-new": isNewChat ? "true" : "false",
      "x-user-type": userType,
    },
    body: JSON.stringify({
      model,
      stream: true,
      userText,
      attachments,
      messages: [
        {
          role: "user",
          content: userText,
        },
      ],
    }),
  });

  if (!upstream.ok || !upstream.body) {
    const details = await upstream.text().catch(() => "");
    let upstreamMessage = details || upstream.statusText;
    try {
      const parsed = JSON.parse(details);
      if (typeof parsed?.error?.message === "string" && parsed.error.message) {
        upstreamMessage = parsed.error.message;
      }
    } catch {
      // ignore parse errors and fallback to raw text
    }

    throw new Error(
      `Claude proxy upstream failed (${upstream.status}): ${upstreamMessage || upstream.statusText}`
    );
  }

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  const textId = generateUUID();
  const reasoningId = generateUUID();
  let buffer = "";
  let textBuffer = "";
  let reasoningStarted = false;
  let textStarted = false;
  let lastReasoningSummarySent = "";

  const SUMMARY_MAX_CHARS = 80;
  const SUMMARY_COMMAND_OR_TECH_REGEX =
    /\b(?:ls|pwd|cd|rg|grep|find|sed|awk|cat|head|tail|wc|curl|wget|python3?|node|npm|pnpm|pip3?|git|ps|pkill|kill|chmod|chown|mv|cp|mkdir|touch|echo|date|sleep|which|source|export|env|printenv|set|bash|sh|command_execution|tool_call|tool_result|web_search|plan_update|reasoning-delta|item\.completed|item\.delta|item\.started|spawn|stdout|stderr)\b/i;
  const SUMMARY_SHELL_TOKEN_REGEX =
    /(?:\|\||&&|;|\||`|\$\(|\$\{|\b--[a-z0-9_-]+\b|<<<?|>>>?)/i;
  const SUMMARY_PATH_REGEX = /(?:[A-Za-z0-9_.-]+\/){1,}[A-Za-z0-9_.-]*/;
  const CJK_REGEX = /[\u3400-\u9fff]/;

  const clipTextByChars = (text: string, maxChars: number) => {
    const chars = Array.from(text);
    if (chars.length <= maxChars) {
      return text;
    }
    return `${chars.slice(0, maxChars).join("")}…`;
  };

  const normalizeSummaryLine = (line: string) => {
    return line
      .replace(/\[(.*?)\]\((.*?)\)/g, "$1")
      .replace(/[*_`#>~]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  };

  const collapseRepeatedChinesePhrase = (raw: string) => {
    const value = raw.trim();
    if (!value) {
      return value;
    }
    const chars = Array.from(value);
    const total = chars.length;
    for (let unitLen = 1; unitLen <= Math.floor(total / 2); unitLen += 1) {
      if (total % unitLen !== 0) {
        continue;
      }
      const unit = chars.slice(0, unitLen).join("");
      if (!CJK_REGEX.test(unit)) {
        continue;
      }
      let repeated = true;
      for (let i = unitLen; i < total; i += unitLen) {
        if (chars.slice(i, i + unitLen).join("") !== unit) {
          repeated = false;
          break;
        }
      }
      if (repeated) {
        return unit;
      }
    }
    return value
      .replace(/(正在思考){2,}/g, "正在思考")
      .replace(/(搜索中){2,}/g, "搜索中")
      .replace(/(调用工具中){2,}/g, "调用工具中")
      .replace(/(调用技能中){2,}/g, "调用技能中")
      .replace(/(执行命令中){2,}/g, "执行命令中")
      .replace(/(更新计划中){2,}/g, "更新计划中");
  };

  const sanitizeReasoningSummary = (raw: string) => {
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
      return clipTextByChars(collapseRepeatedChinesePhrase(line), SUMMARY_MAX_CHARS);
    }

    return "";
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() || "";

    for (const event of events) {
      const lines = event
        .split("\n")
        .filter((line) => line.startsWith("data:"));
      if (lines.length === 0) {
        continue;
      }

      const payload = lines.map((line) => line.slice(5).trim()).join("\n");
      if (!payload || payload === "[DONE]") {
        continue;
      }

      let parsed: {
        choices?: Array<{
          delta?: {
            content?: string | Array<{ text?: string }>;
            reasoning?: string;
            reasoning_summary?: string;
            activity?: unknown;
          };
        }>;
      } | null = null;

      try {
        parsed = JSON.parse(payload);
      } catch {
        continue;
      }

      const delta = parsed?.choices?.[0]?.delta?.content;
      const reasoningDelta = parsed?.choices?.[0]?.delta?.reasoning;
      const activityDeltaRaw = parsed?.choices?.[0]?.delta?.activity;
      const textDelta =
        typeof delta === "string"
          ? delta
          : Array.isArray(delta)
            ? delta
                .map((part) =>
                  typeof part?.text === "string" ? part.text : ""
                )
                .join("")
            : "";
      const normalizedReasoning =
        typeof reasoningDelta === "string" ? reasoningDelta : "";
      const reasoningSummaryDelta = parsed?.choices?.[0]?.delta?.reasoning_summary;
      const normalizedReasoningSummary =
        typeof reasoningSummaryDelta === "string" ? reasoningSummaryDelta : "";
      const normalizedActivity = normalizeThinkingActivityDelta(
        activityDeltaRaw,
        reasoningId
      );

      if (normalizedActivity) {
        if (!reasoningStarted) {
          dataStream.write({ type: "reasoning-start", id: reasoningId });
          reasoningStarted = true;
        }
        dataStream.write({
          type: "data-thinking-activity",
          data: normalizedActivity,
        });
      }

      if (normalizedReasoning) {
        if (!reasoningStarted) {
          dataStream.write({ type: "reasoning-start", id: reasoningId });
          reasoningStarted = true;
        }
        dataStream.write({
          type: "reasoning-delta",
          id: reasoningId,
          delta: normalizedReasoning,
        });
      }
      if (normalizedReasoningSummary) {
        if (!reasoningStarted) {
          dataStream.write({ type: "reasoning-start", id: reasoningId });
          reasoningStarted = true;
        }
        const sanitizedSummary = sanitizeReasoningSummary(
          normalizedReasoningSummary
        );
        if (sanitizedSummary && sanitizedSummary !== lastReasoningSummarySent) {
          dataStream.write({
            type: "data-thinking-summary",
            data: {
              reasoningId,
              text: sanitizedSummary,
            },
          });
          lastReasoningSummarySent = sanitizedSummary;
        }
      }

      if (textDelta) {
        textBuffer += textDelta;
        if (!textStarted) {
          dataStream.write({ type: "text-start", id: textId });
          textStarted = true;
        }
        dataStream.write({
          type: "text-delta",
          id: textId,
          delta: textDelta,
        });
      }
    }
  }

  if (reasoningStarted) {
    dataStream.write({
      type: "data-thinking-activity",
      data: {
        reasoningId,
        kind: "thinking",
        label: "正在思考",
        active: false,
      },
    });
    dataStream.write({ type: "reasoning-end", id: reasoningId });
  }

  const { text: normalizedText, charts } = extractPlotlyChartsFromText(
    textBuffer,
    `stream-${chatId}`
  );

  if (!textStarted && textBuffer) {
    const textForReply =
      normalizedText.trim() ||
      (charts.length > 0
        ? "已生成交互图表，请在下方图表卡片查看。"
        : normalizedText);
    dataStream.write({ type: "text-start", id: textId });
    dataStream.write({
      type: "text-delta",
      id: textId,
      delta: textForReply,
    });
    textStarted = true;
  }

  if (textStarted) {
    dataStream.write({ type: "text-end", id: textId });
  }

  for (const chart of charts) {
    dataStream.write({
      type: "data-plotly-chart",
      data: { chart },
    });
  }
}

export async function POST(request: Request) {
  let requestBody: PostRequestBody;

  try {
    const json = await request.json();
    requestBody = postRequestBodySchema.parse(json);
  } catch (_) {
    return new ChatSDKError("bad_request:api").toResponse();
  }

  try {
    const { id, message, messages, selectedChatModel, selectedVisibilityType } =
      requestBody;
    const existingTaskSessionId = readTaskSessionIdFromCookieHeader(
      request.headers.get("cookie")
    );
    const taskSessionId = existingTaskSessionId || generateId();
    const shouldSetTaskSessionCookie = !existingTaskSessionId;
    chatDebug("post_received", {
      chatId: id,
      hasSingleMessage: Boolean(message),
      messageCount: Array.isArray(messages) ? messages.length : 0,
      selectedChatModel: selectedChatModel || "",
    });

    const session = await auth();

    if (!session?.user) {
      return new ChatSDKError("unauthorized:chat").toResponse();
    }

    const userType: UserType = session.user.type;

    const shouldRejectByQuota = await shouldRejectByDailyQuota({
      disabled: isQuotaDisabled(),
      userId: session.user.id,
      maxMessagesPerDay: entitlementsByUserType[userType].maxMessagesPerDay,
      getMessageCountByUserId,
    });

    if (shouldRejectByQuota) {
      return new ChatSDKError("rate_limit:chat").toResponse();
    }

    const isToolApprovalFlow = Boolean(messages);

    const chat = await getChatById({ id });
    let messagesFromDb: DBMessage[] = [];
    let titlePromise: Promise<string> | null = null;

    if (chat) {
      if (chat.userId !== session.user.id) {
        return new ChatSDKError("forbidden:chat").toResponse();
      }
      if (!isToolApprovalFlow) {
        messagesFromDb = await getMessagesByChatId({ id });
      }
    } else if (message?.role === "user") {
      await saveChat({
        id,
        userId: session.user.id,
        title: "New chat",
        visibility: selectedVisibilityType,
      });
      titlePromise = generateTitleFromUserMessage({ message }).catch(
        (titleError) => {
          console.error("Failed to generate title:", titleError);
          return "";
        }
      );
    } else {
      return new ChatSDKError("bad_request:api").toResponse();
    }

    const uiMessages = isToolApprovalFlow
      ? (messages as ChatMessage[])
      : [...convertToUIMessages(messagesFromDb), message as ChatMessage];

    if (message?.role === "user") {
      await saveMessages({
        messages: [
          {
            chatId: id,
            id: message.id,
            role: "user",
            parts: message.parts,
            attachments: [],
            createdAt: new Date(),
          },
        ],
      });
    }

    const backend = process.env.CHAT_BACKEND || DEFAULT_BACKEND;
    const latestUserText = extractLatestUserText(requestBody);
    const latestUserAttachments = extractLatestUserAttachments(requestBody);

    const { longitude, latitude, city, country } = geolocation(request);

    const requestHints: RequestHints = {
      longitude,
      latitude,
      city,
      country,
    };
    const claudeProxyModel = resolveClaudeProxyModel(selectedChatModel);

    const modelId =
      backend === "gateway"
        ? selectedChatModel || DEFAULT_CHAT_MODEL
        : claudeProxyModel;
    chatDebug("backend_selected", {
      backend,
      useTriggerDev: USE_TRIGGER_DEV,
      isToolApprovalFlow,
      selectedChatModel: selectedChatModel || "",
      effectiveModel: modelId,
    });
    let triggerAssistantTextForPersistence = "";
    let persistedTriggerAssistantMessageId: string | null = null;
    let triggerAssistantPersistedInExecute = false;

    const persistTriggerAssistantSnapshot = async (
      text: string,
      preferredMessageId?: string
    ) => {
      const trimmed = text.trim();
      if (!trimmed) {
        return;
      }

      const parts = [
        {
          type: "text" as const,
          text,
          state: "done" as const,
        },
      ];

      if (!persistedTriggerAssistantMessageId) {
        const preferredId = String(preferredMessageId || "").trim();
        persistedTriggerAssistantMessageId = preferredId || generateUUID();
        await saveMessages({
          messages: [
            {
              id: persistedTriggerAssistantMessageId,
              role: "assistant",
              parts,
              createdAt: new Date(),
              attachments: [],
              chatId: id,
            },
          ],
        });
      } else {
        await updateMessage({
          id: persistedTriggerAssistantMessageId,
          parts,
        });
      }

      triggerAssistantPersistedInExecute = true;
    };

    const stream = createUIMessageStream({
      originalMessages: isToolApprovalFlow ? uiMessages : undefined,
      execute: async ({ writer: dataStream }) => {
        if (backend === "gateway") {
          const isReasoningModel =
            modelId.includes("reasoning") || modelId.includes("thinking");
          const modelMessages = await convertToModelMessages(uiMessages);

          const result = streamText({
            model: getLanguageModel(modelId),
            system: systemPrompt({ selectedChatModel: modelId, requestHints }),
            messages: modelMessages,
            stopWhen: stepCountIs(5),
            experimental_activeTools: isReasoningModel
              ? []
              : [
                  "getWeather",
                  "createDocument",
                  "updateDocument",
                  "requestSuggestions",
                ],
            providerOptions: isReasoningModel
              ? {
                  anthropic: {
                    thinking: { type: "enabled", budgetTokens: 10_000 },
                  },
                }
              : undefined,
            tools: {
              getWeather,
              createDocument: createDocument({ session, dataStream }),
              updateDocument: updateDocument({ session, dataStream }),
              requestSuggestions: requestSuggestions({ session, dataStream }),
            },
            experimental_telemetry: {
              isEnabled: isProductionEnvironment,
              functionId: "stream-text",
            },
          });

          dataStream.merge(result.toUIMessageStream({ sendReasoning: true }));
        } else if (USE_TRIGGER_DEV) {
          if (!latestUserText) {
            throw new Error("No user text found in request");
          }

          const precheck = await precheckClaudeProxyInput({
            chatId: id,
            isNewChat: !chat,
            userText: latestUserText,
            userType,
            model: claudeProxyModel,
          });
          chatDebug("trigger_precheck_done", {
            chatId: id,
            allowed: precheck.allowed,
            reason: precheck.reason,
          });
          if (!precheck.allowed) {
            const blockedReply =
              precheck.reply || "该请求当前未通过策略校验，请调整后重试。";
            const blockedId = generateUUID();
            dataStream.write({ type: "text-start", id: blockedId });
            dataStream.write({
              type: "text-delta",
              id: blockedId,
              delta: blockedReply,
            });
            dataStream.write({ type: "text-end", id: blockedId });
            triggerAssistantTextForPersistence = blockedReply;
            await persistTriggerAssistantSnapshot(
              triggerAssistantTextForPersistence,
              blockedId
            );
            return;
          }

          const triggerIdempotencyKey = buildTriggerIdempotencyKey({
            chatId: id,
            userId: session.user.id,
            requestId: requestBody.id,
            messageId: extractLatestUserMessageId(requestBody),
            userText: latestUserText,
            attachments: latestUserAttachments,
          });
          const triggerAccount = await pickNextTriggerAccount("fund-chat-task");
          const triggerClientConfig = toTriggerClientConfig(triggerAccount);
          const handle = await tasks.trigger<typeof fundChatTask>(
            "fund-chat-task",
            {
              userId: session.user.id,
              userType,
              chatId: id,
              userText: latestUserText,
              attachments: latestUserAttachments,
              model: claudeProxyModel,
              isNewChat: !chat,
              policyPrechecked: true,
            },
            {
              idempotencyKey: triggerIdempotencyKey,
              idempotencyKeyTTL: "10m",
            },
            {
              clientConfig: triggerClientConfig,
            }
          );
          const runId = handle.id;
          const taskSessionHash = hashTaskSessionId(taskSessionId);
          const taskOwnerTtlSeconds = getTaskOwnerTtlSeconds();
          const initialCursor = 0;
          const initialCursorSig = signTaskCursor({
            runId,
            sidHash: taskSessionHash,
            cursor: initialCursor,
          });
          await saveTaskRunOwner({
            runId,
            userId: session.user.id,
            sidHash: taskSessionHash,
            triggerAccountId: triggerAccount.id,
            ttlSeconds: taskOwnerTtlSeconds,
          });
          await initializeTaskCursorState({
            runId,
            sidHash: taskSessionHash,
            cursor: initialCursor,
            cursorSig: initialCursorSig,
            ttlSeconds: taskOwnerTtlSeconds,
          });
          let realtimePublicAccessToken = "";
          try {
            realtimePublicAccessToken = await triggerAuth.withAuth(
              triggerClientConfig,
              async () =>
                triggerAuth.createPublicToken({
                  scopes: {
                    read: {
                      runs: [runId],
                    },
                  },
                  expirationTime: TRIGGER_REALTIME_PUBLIC_TOKEN_TTL,
                  realtime: {
                    skipColumns: ["payload", "output"],
                  },
                })
            );
          } catch (tokenError) {
            const normalizedError = normalizeRealtimeError(tokenError);
            chatDebug("trigger_realtime_token_failed", {
              chatId: id,
              runId,
              triggerAccountId: triggerAccount.id,
              error: normalizedError.errorMessage,
            });
            console.error("[chat-api][realtime] public_token_create_failed", {
              chatId: id,
              runId,
              triggerAccountId: triggerAccount.id,
              streamId: TRIGGER_REALTIME_STREAM_ID,
              apiUrlHost: normalizeRealtimeApiHost(triggerAccount.apiUrl),
              tokenTtl: TRIGGER_REALTIME_PUBLIC_TOKEN_TTL,
              ...normalizedError,
            });
          }
          if (!realtimePublicAccessToken) {
            console.error("[chat-api][realtime] public_token_missing", {
              chatId: id,
              runId,
              triggerAccountId: triggerAccount.id,
              streamId: TRIGGER_REALTIME_STREAM_ID,
              apiUrlHost: normalizeRealtimeApiHost(triggerAccount.apiUrl),
              tokenTtl: TRIGGER_REALTIME_PUBLIC_TOKEN_TTL,
            });
          }
          chatDebug("trigger_task_submitted", {
            chatId: id,
            runId,
            triggerAccountId: triggerAccount.id,
            idempotencyKeyPrefix: triggerIdempotencyKey.slice(0, 12),
            taskSessionHashPrefix: taskSessionHash.slice(0, 12),
          });
          const taskInfo = "任务已提交，后台处理中。稍后会自动更新";
          const taskInfoTextId = generateUUID();
          const taskInfoReasoningId = generateUUID();
          let taskInfoClosed = false;
          triggerAssistantTextForPersistence = taskInfo;
          await persistTriggerAssistantSnapshot(
            triggerAssistantTextForPersistence,
            taskInfoTextId
          );
          if (persistedTriggerAssistantMessageId) {
            await saveTaskRunMessageId({
              runId,
              messageId: persistedTriggerAssistantMessageId,
              ttlSeconds: taskOwnerTtlSeconds,
            });
          }

          dataStream.write({
            type: "data-task-auth",
            data: {
              runId,
              cursor: initialCursor,
              cursorSig: initialCursorSig,
              ...(realtimePublicAccessToken
                ? {
                    realtime: {
                      apiUrl: triggerAccount.apiUrl,
                      publicAccessToken: realtimePublicAccessToken,
                      streamId: TRIGGER_REALTIME_STREAM_ID,
                      readTimeoutSeconds: TRIGGER_REALTIME_READ_TIMEOUT_SECONDS,
                    },
                  }
                : {}),
            },
          });
          if (realtimePublicAccessToken) {
            const tokenMeta = await buildRealtimeTokenLogMeta(
              realtimePublicAccessToken
            );
            chatDebug("trigger_realtime_auth_emitted", {
              chatId: id,
              runId,
              triggerAccountId: triggerAccount.id,
              streamId: TRIGGER_REALTIME_STREAM_ID,
              apiUrlHost: normalizeRealtimeApiHost(triggerAccount.apiUrl),
              tokenTtl: TRIGGER_REALTIME_PUBLIC_TOKEN_TTL,
              ...tokenMeta,
            });
          }
          dataStream.write({
            type: "reasoning-start",
            id: taskInfoReasoningId,
          });
          dataStream.write({
            type: "data-thinking-activity",
            data: {
              reasoningId: taskInfoReasoningId,
              kind: "thinking",
              label: "正在思考",
              active: true,
            },
          });
          dataStream.write({ type: "text-start", id: taskInfoTextId });
          dataStream.write({
            type: "text-delta",
            id: taskInfoTextId,
            delta: taskInfo,
          });

          const closeTaskInfoText = () => {
            if (taskInfoClosed) {
              return;
            }
            dataStream.write({ type: "text-end", id: taskInfoTextId });
            taskInfoClosed = true;
          };

          // Important: return immediately after enqueueing Trigger task.
          // Waiting for stream/poll here can hit Vercel maxDuration and timeout.
          closeTaskInfoText();
          await persistTriggerAssistantSnapshot(
            triggerAssistantTextForPersistence,
            taskInfoTextId
          );
          chatDebug("trigger_snapshot_persisted", {
            chatId: id,
            runPersistedTextLength: triggerAssistantTextForPersistence.length,
          });

          // Finalize in background so UI refresh/disconnect does not leave the DB stuck on marker text.
          after(async () => {
            type RawTaskOutput =
              | string
              | {
                  text?: unknown;
                  artifacts?: unknown;
                  plotlyCharts?: unknown;
                  [key: string]: unknown;
                }
              | null
              | undefined;

            const failureStatuses = new Set([
              "FAILED",
              "CRASHED",
              "SYSTEM_FAILURE",
              "TIMED_OUT",
              "CANCELED",
              "EXPIRED",
            ]);

            const isRecord = (
              value: unknown
            ): value is Record<string, unknown> => {
              return (
                typeof value === "object" &&
                value !== null &&
                !Array.isArray(value)
              );
            };

            const toArtifactList = (value: unknown) => {
              if (!Array.isArray(value)) {
                return [] as string[];
              }
              return value
                .filter((item) => typeof item === "string")
                .map((item) => String(item))
                .filter((item) => item.length > 0);
            };

            const normalizeOutput = (raw: RawTaskOutput) => {
              if (typeof raw === "string") {
                try {
                  const parsed = JSON.parse(raw) as unknown;
                  return normalizeOutput(parsed as RawTaskOutput);
                } catch {
                  return {
                    text: raw,
                    artifacts: [] as string[],
                    plotlyCharts: [] as unknown[],
                  };
                }
              }

              if (!isRecord(raw)) {
                return {
                  text: "",
                  artifacts: [] as string[],
                  plotlyCharts: [] as unknown[],
                };
              }

              const text = typeof raw.text === "string" ? raw.text : "";
              const artifacts = toArtifactList(raw.artifacts);
              const plotlyCharts = Array.isArray(raw.plotlyCharts)
                ? raw.plotlyCharts
                : [];

              if (text) {
                return { text, artifacts, plotlyCharts };
              }

              return {
                text: `\`\`\`json\n${JSON.stringify(raw, null, 2)}\n\`\`\``,
                artifacts,
                plotlyCharts,
              };
            };

            try {
              const run = await triggerAuth.withAuth(
                triggerClientConfig,
                () =>
                  runs.poll<typeof fundChatTask>(runId, {
                    pollIntervalMs: 1500,
                  })
              );

              let pendingMessageId = await getTaskRunMessageId(runId);
              if (!pendingMessageId) {
                const marker = `[[task:${runId}]]`;
                const messages = await getMessagesByChatId({ id });
                const pendingMessage = [...messages].reverse().find((item) => {
                  if (item.role !== "assistant") {
                    return false;
                  }
                  const parts = Array.isArray(item.parts) ? item.parts : [];
                  const text = parts
                    .filter(
                      (part) =>
                        typeof part === "object" &&
                        part !== null &&
                        (part as { type?: unknown }).type === "text"
                    )
                    .map((part) =>
                      String((part as { text?: unknown }).text || "")
                    )
                    .join("\n");
                  return text.includes(marker);
                });
                pendingMessageId = pendingMessage?.id || null;
              }

              if (!pendingMessageId) {
                return;
              }

              if (run.status !== "COMPLETED") {
                if (failureStatuses.has(run.status)) {
                  await updateMessage({
                    id: pendingMessageId,
                    parts: [
                      {
                        type: "text",
                        text: `任务执行失败：${run.status}`,
                        state: "done",
                      },
                    ],
                  });
                }
                return;
              }

              let output = run.output as RawTaskOutput;
              if (
                !output &&
                (run as { outputPresignedUrl?: string }).outputPresignedUrl
              ) {
                const presigned = (run as { outputPresignedUrl?: string })
                  .outputPresignedUrl;
                if (presigned) {
                  try {
                    const fetched = await fetch(presigned);
                    if (fetched.ok) {
                      output = (await fetched.json()) as RawTaskOutput;
                    }
                  } catch {
                    // ignore fetch errors
                  }
                }
              }

              const normalized = normalizeOutput(output);
              const artifactItems = buildArtifactItems(normalized.artifacts);
              const chartsFromOutput = normalizePlotlyCharts(
                normalized.plotlyCharts,
                `task-${runId}-explicit`
              );
              const { text: strippedText, charts: chartsFromText } =
                extractPlotlyChartsFromText(
                  normalized.text,
                  `task-${runId}-text`
                );
              const plotlyCharts = [...chartsFromOutput, ...chartsFromText];
              const finalText =
                strippedText.trim() ||
                (plotlyCharts.length > 0
                  ? "已生成交互图表，请在下方图表卡片查看。"
                  : artifactItems.length > 0
                    ? "已生成回测结果，请点击下方卡片查看。"
                    : strippedText);
              const completedParts = [
                {
                  type: "text",
                  text: finalText,
                  state: "done",
                },
                ...plotlyCharts.map((chart) => ({
                  type: "data-plotly-chart",
                  data: { chart },
                })),
                ...(artifactItems.length > 0
                  ? [
                      {
                        type: "data-backtest-artifact",
                        data: {
                          items: artifactItems,
                        },
                      },
                    ]
                  : []),
              ];

              await updateMessage({
                id: pendingMessageId,
                parts: completedParts,
              });
            } catch (persistError) {
              console.error(
                `[chat-api] Failed to finalize Trigger run ${runId}:`,
                persistError
              );
            }
          });

          chatDebug("trigger_return_immediately", { runId });
          return;
        } else {
          if (!latestUserText) {
            throw new Error("No user text found in request");
          }

          await streamFromClaudeProxy({
            dataStream,
            chatId: id,
            isNewChat: !chat,
            userText: latestUserText,
            attachments: latestUserAttachments,
            userType,
            model: claudeProxyModel,
          });
        }

        if (titlePromise) {
          const title = await titlePromise;
          if (title) {
            dataStream.write({ type: "data-chat-title", data: title });
            updateChatTitleById({ chatId: id, title });
          }
        }
      },
      generateId: generateUUID,
      onFinish: async ({ messages: finishedMessages }) => {
        const existingMessageIds = new Set(
          uiMessages.map((message) => message.id)
        );
        let hasPersistedAssistantMessage = false;
        const skipFinishedAssistantPersistence =
          backend !== "gateway" &&
          USE_TRIGGER_DEV &&
          triggerAssistantPersistedInExecute;

        for (const finishedMsg of finishedMessages) {
          if (
            skipFinishedAssistantPersistence &&
            finishedMsg.role === "assistant"
          ) {
            hasPersistedAssistantMessage = true;
            continue;
          }

          if (finishedMsg.role === "assistant") {
            hasPersistedAssistantMessage = true;
          }

          if (existingMessageIds.has(finishedMsg.id)) {
            await updateMessage({
              id: finishedMsg.id,
              parts: finishedMsg.parts,
            });
            continue;
          }

          await saveMessages({
            messages: [
              {
                id: finishedMsg.id,
                role: finishedMsg.role,
                parts: finishedMsg.parts,
                createdAt: new Date(),
                attachments: [],
                chatId: id,
              },
            ],
          });
          existingMessageIds.add(finishedMsg.id);
        }

        if (
          backend !== "gateway" &&
          USE_TRIGGER_DEV &&
          !hasPersistedAssistantMessage &&
          triggerAssistantTextForPersistence.trim()
        ) {
          await saveMessages({
            messages: [
              {
                id: generateUUID(),
                role: "assistant",
                parts: [
                  {
                    type: "text",
                    text: triggerAssistantTextForPersistence,
                    state: "done",
                  },
                ],
                createdAt: new Date(),
                attachments: [],
                chatId: id,
              },
            ],
          });
        }
      },
      onError: (error) => {
        chatDebug("stream_on_error", {
          message: error instanceof Error ? error.message : String(error),
        });
        if (error instanceof Error) {
          if (error.message.includes("Claude proxy precheck failed (429)")) {
            return "请求过于频繁，请稍后重试。";
          }
          if (error.message.includes("Claude proxy precheck failed (403)")) {
            return "请求被上游拦截，请确认页面验证已完成后重试。";
          }
          if (error.message.includes("Claude proxy precheck failed")) {
            return "请求预校验失败，请稍后重试。";
          }
          if (error.message.includes("Claude proxy upstream failed (429)")) {
            return "请求过于频繁，请稍后重试。";
          }
          if (error.message.includes("Claude proxy upstream failed (403)")) {
            return "请求被上游拦截，请确认页面验证已完成后重试。";
          }
        }
        return "Oops, an error occurred!";
      },
    });

    const response = createUIMessageStreamResponse({
      stream,
      async consumeSseStream({ stream: sseStream }) {
        if (!isRedisConfigured()) {
          return;
        }
        try {
          const streamContext = getStreamContext();
          if (streamContext) {
            const streamId = generateId();
            await createStreamId({ streamId, chatId: id });
            await streamContext.createNewResumableStream(
              streamId,
              () => sseStream
            );
          }
        } catch (_) {
          // ignore redis errors
        }
      },
    });
    if (shouldSetTaskSessionCookie) {
      response.headers.append(
        "set-cookie",
        buildTaskSessionCookieHeader(taskSessionId)
      );
    }
    return response;
  } catch (error) {
    const vercelId = request.headers.get("x-vercel-id");

    if (error instanceof ChatSDKError) {
      return error.toResponse();
    }

    if (
      error instanceof Error &&
      (error.message?.includes("Claude proxy precheck failed (403)") ||
        error.message?.includes("Claude proxy upstream failed (403)"))
    ) {
      return Response.json(
        {
          code: "forbidden:chat",
          message: "请求被上游拦截，请确认页面验证已完成后重试。",
          cause: "cloudflare_preclearance_required",
        },
        { status: 403 }
      );
    }

    if (
      error instanceof Error &&
      error.message?.includes(
        "AI Gateway requires a valid credit card on file to service requests"
      )
    ) {
      return new ChatSDKError("bad_request:activate_gateway").toResponse();
    }

    console.error("Unhandled error in chat API:", error, { vercelId });
    return new ChatSDKError("offline:chat").toResponse();
  }
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return new ChatSDKError("bad_request:api").toResponse();
  }

  const session = await auth();

  if (!session?.user) {
    return new ChatSDKError("unauthorized:chat").toResponse();
  }

  const chat = await getChatById({ id });

  if (chat?.userId !== session.user.id) {
    return new ChatSDKError("forbidden:chat").toResponse();
  }

  const deletedChat = await deleteChatById({ id });

  return Response.json(deletedChat, { status: 200 });
}
