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
import { runs, tasks } from "@trigger.dev/sdk";
import { auth, type UserType } from "@/app/(auth)/auth";
import { entitlementsByUserType } from "@/lib/ai/entitlements";
import { DEFAULT_CHAT_MODEL } from "@/lib/ai/models";
import { type RequestHints, systemPrompt } from "@/lib/ai/prompts";
import { getLanguageModel } from "@/lib/ai/providers";
import { createDocument } from "@/lib/ai/tools/create-document";
import { getWeather } from "@/lib/ai/tools/get-weather";
import { requestSuggestions } from "@/lib/ai/tools/request-suggestions";
import { updateDocument } from "@/lib/ai/tools/update-document";
import { enrichAssistantText } from "@/lib/artifacts";
import { isProductionEnvironment } from "@/lib/constants";
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
import type { ChatMessage } from "@/lib/types";
import { convertToUIMessages, generateUUID } from "@/lib/utils";
import type { fundChatTask } from "@/trigger/fund-chat-task";
import { generateTitleFromUserMessage } from "../../actions";
import { type PostRequestBody, postRequestBodySchema } from "./schema";

// Vercel Hobby plan limit: Serverless Function maxDuration must be <= 300s.
export const maxDuration = 300;

const DEFAULT_BACKEND = "claude_proxy";
const FIXED_CHAT_MODEL =
  process.env.CODEX_MODEL || process.env.CLAUDE_CODE_MODEL || "gpt-5.3-codex";
const USE_TRIGGER_DEV = (process.env.USE_TRIGGER_DEV || "false").toLowerCase() === "true";
const CHAT_API_DEBUG_VERBOSE = (process.env.CHAT_API_DEBUG_VERBOSE || "false").toLowerCase() === "true";

function getStreamContext() {
  try {
    return createResumableStreamContext({ waitUntil: after });
  } catch (_) {
    return null;
  }
}


function isQuotaDisabled() {
  return (process.env.DISABLE_CHAT_DAILY_QUOTA || "false").toLowerCase() === "true";
}

function extractTextFromParts(parts: Array<{ type: string; text?: string }> | undefined) {
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
    return extractTextFromParts(body.message.parts as Array<{ type: string; text?: string }>);
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


function getCookieValue(cookieHeader: string | null, key: string): string {
  if (!cookieHeader) {
    return "";
  }
  const parts = cookieHeader.split(";").map((x) => x.trim());
  for (const part of parts) {
    if (!part.startsWith(`${key}=`)) {
      continue;
    }
    return decodeURIComponent(part.slice(key.length + 1));
  }
  return "";
}

type ClaudeProxyPrecheckResult = {
  allowed: boolean;
  reason: string;
  reply: string;
};

function parseTurnstileReason(message: string) {
  const match = String(message || "").match(/Turnstile verification failed:\s*([a-zA-Z0-9_-]+)/i);
  if (!match?.[1]) {
    return "";
  }
  return match[1].toLowerCase();
}

async function precheckClaudeProxyInput({
  chatId,
  isNewChat,
  userText,
  turnstileToken,
}: {
  chatId: string;
  isNewChat: boolean;
  userText: string;
  turnstileToken?: string;
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
      ...(turnstileToken ? { "x-turnstile-token": turnstileToken } : {}),
    },
    body: JSON.stringify({
      text: userText,
      turnstileToken: turnstileToken || undefined,
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
          typeof (parsed.error as { message?: unknown } | undefined)?.message === "string" &&
          String((parsed.error as { message?: unknown }).message || "").trim()
        ? String((parsed.error as { message?: unknown }).message)
        : raw || response.statusText || "该请求当前未通过策略校验，请调整后重试。";

  const turnstileReasonFromReason = reason.startsWith("turnstile_")
    ? reason.slice("turnstile_".length)
    : "";
  const turnstileReasonFromMessage = parseTurnstileReason(reply);
  const turnstileReason = turnstileReasonFromReason || turnstileReasonFromMessage;
  if (turnstileReason) {
    throw new Error(`turnstile_upstream:${turnstileReason}`);
  }

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
  turnstileToken,
}: {
  dataStream: any;
  chatId: string;
  isNewChat: boolean;
  userText: string;
  turnstileToken?: string;
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
      ...(turnstileToken ? { "x-turnstile-token": turnstileToken } : {}),
    },
    body: JSON.stringify({
      model: FIXED_CHAT_MODEL,
      stream: true,
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

    const turnstileMatch = upstreamMessage.match(
      /Turnstile verification failed:\s*([a-zA-Z0-9_-]+)/i
    );
    if (upstream.status === 403 && turnstileMatch?.[1]) {
      throw new Error(`turnstile_upstream:${turnstileMatch[1].toLowerCase()}`);
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

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() || "";

    for (const event of events) {
      const lines = event.split("\n").filter((line) => line.startsWith("data:"));
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
      const textDelta =
        typeof delta === "string"
          ? delta
          : Array.isArray(delta)
            ? delta
                .map((part) => (typeof part?.text === "string" ? part.text : ""))
                .join("")
            : "";
    const normalizedReasoning =
      typeof reasoningDelta === "string" ? reasoningDelta : "";

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

      if (textDelta) {
        textBuffer += textDelta;
      }
    }
  }

  if (reasoningStarted) {
    dataStream.write({ type: "reasoning-end", id: reasoningId });
  }

  if (textBuffer) {
    const enriched = enrichAssistantText(textBuffer);
    dataStream.write({ type: "text-start", id: textId });
    dataStream.write({
      type: "text-delta",
      id: textId,
      delta: enriched,
    });
    dataStream.write({ type: "text-end", id: textId });
  }
}

export async function POST(request: Request) {
  let requestBody: PostRequestBody;
  let rawRequestBody: Record<string, unknown> | null = null;

  try {
    const json = await request.json();
    rawRequestBody =
      json && typeof json === "object" ? (json as Record<string, unknown>) : null;
    requestBody = postRequestBodySchema.parse(json);
  } catch (_) {
    return new ChatSDKError("bad_request:api").toResponse();
  }

  try {
    const {
      id,
      message,
      messages,
      selectedChatModel,
      selectedVisibilityType,
    } = requestBody;
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

    if (!isQuotaDisabled()) {
      const messageCount = await getMessageCountByUserId({
        id: session.user.id,
        differenceInHours: 24,
      });

      if (messageCount > entitlementsByUserType[userType].maxMessagesPerDay) {
        return new ChatSDKError("rate_limit:chat").toResponse();
      }
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
    const turnstileTokenFromBody =
      typeof rawRequestBody?.turnstileToken === "string"
        ? rawRequestBody.turnstileToken
        : "";
    const turnstileTokenFromCookie = getCookieValue(
      request.headers.get("cookie"),
      "turnstile_token"
    );
    const turnstileToken =
      request.headers.get("x-turnstile-token") ||
      request.headers.get("cf-turnstile-response") ||
      turnstileTokenFromBody ||
      turnstileTokenFromCookie ||
      "";
    console.log(
      `[chat-api] turnstile header=${Boolean(
        request.headers.get("x-turnstile-token") || request.headers.get("cf-turnstile-response")
      )} body=${Boolean(turnstileTokenFromBody)} cookie=${Boolean(turnstileTokenFromCookie)}`
    );
    chatDebug("backend_selected", {
      backend,
      useTriggerDev: USE_TRIGGER_DEV,
      isToolApprovalFlow,
      hasTurnstileToken: Boolean(turnstileToken),
    });
    if (backend === "claude_proxy" && !turnstileToken) {
      return Response.json(
        {
          code: "forbidden:chat",
          message: "请先通过 Turnstile 验证后再发送。",
          cause: "turnstile_missing_token",
        },
        { status: 403 }
      );
    }

    const { longitude, latitude, city, country } = geolocation(request);

    const requestHints: RequestHints = {
      longitude,
      latitude,
      city,
      country,
    };

    const modelId =
      backend === "gateway"
        ? selectedChatModel || DEFAULT_CHAT_MODEL
        : FIXED_CHAT_MODEL;
    let triggerAssistantTextForPersistence = "";
    let persistedTriggerAssistantMessageId: string | null = null;
    let triggerAssistantPersistedInExecute = false;

    const persistTriggerAssistantSnapshot = async (text: string) => {
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
        persistedTriggerAssistantMessageId = generateUUID();
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
          const userText = extractLatestUserText(requestBody);
          if (!userText) {
            throw new Error("No user text found in request");
          }

          const precheck = await precheckClaudeProxyInput({
            chatId: id,
            isNewChat: !chat,
            userText,
            turnstileToken,
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
            await persistTriggerAssistantSnapshot(triggerAssistantTextForPersistence);
            return;
          }

          const handle = await tasks.trigger<typeof fundChatTask>("fund-chat-task", {
            userId: session.user.id,
            chatId: id,
            userText,
            model: FIXED_CHAT_MODEL,
            isNewChat: !chat,
            turnstileToken: turnstileToken || undefined,
            policyPrechecked: true,
          });
          const runId = handle.id;
          chatDebug("trigger_task_submitted", {
            chatId: id,
            runId,
          });
          const taskInfo = [
            "任务已提交，后台处理中。",
            `任务ID: ${runId}`,
            `查询进度: /api/tasks/${runId}`,
            `[[task:${runId}]]`,
          ].join("\n");
          const taskInfoTextId = generateUUID();
          let taskInfoClosed = false;
          triggerAssistantTextForPersistence = taskInfo;
          await persistTriggerAssistantSnapshot(triggerAssistantTextForPersistence);

          dataStream.write({ type: "text-start", id: taskInfoTextId });
          dataStream.write({ type: "text-delta", id: taskInfoTextId, delta: taskInfo });

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
          await persistTriggerAssistantSnapshot(triggerAssistantTextForPersistence);
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

            const isRecord = (value: unknown): value is Record<string, unknown> => {
              return typeof value === "object" && value !== null && !Array.isArray(value);
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
                  return { text: raw, artifacts: [] as string[] };
                }
              }

              if (!isRecord(raw)) {
                return { text: "", artifacts: [] as string[] };
              }

              const text = typeof raw.text === "string" ? raw.text : "";
              const artifacts = toArtifactList(raw.artifacts);

              if (text) {
                return { text, artifacts };
              }

              return {
                text: `\`\`\`json\n${JSON.stringify(raw, null, 2)}\n\`\`\``,
                artifacts,
              };
            };

            const appendArtifactsToText = (text: string, artifacts: string[]) => {
              if (artifacts.length === 0) {
                return text;
              }
              const missing = artifacts.filter((artifactPath) => !text.includes(artifactPath));
              if (missing.length === 0) {
                return text;
              }
              const lines = missing.map((artifactPath) => `- \`${artifactPath}\``).join("\n");
              const prefix = text.trim() ? `${text.trim()}\n\n` : "";
              return `${prefix}资源\n${lines}`;
            };

            try {
              const run = await runs.poll<typeof fundChatTask>(runId, {
                pollIntervalMs: 1500,
              });

              const marker = `[[task:${runId}]]`;
              const messages = await getMessagesByChatId({ id });
              const pendingMessage = [...messages]
                .reverse()
                .find((item) => {
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
                    .map((part) => String((part as { text?: unknown }).text || ""))
                    .join("\n");
                  return text.includes(marker);
                });

              if (!pendingMessage) {
                return;
              }

              if (run.status !== "COMPLETED") {
                if (failureStatuses.has(run.status)) {
                  await updateMessage({
                    id: pendingMessage.id,
                    parts: [{ type: "text", text: `任务执行失败：${run.status}`, state: "done" }],
                  });
                }
                return;
              }

              let output = run.output as RawTaskOutput;
              if (!output && (run as { outputPresignedUrl?: string }).outputPresignedUrl) {
                const presigned = (run as { outputPresignedUrl?: string }).outputPresignedUrl;
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
              const withArtifacts = appendArtifactsToText(normalized.text, normalized.artifacts);
              const enriched = enrichAssistantText(withArtifacts);

              await updateMessage({
                id: pendingMessage.id,
                parts: [{ type: "text", text: enriched, state: "done" }],
              });
            } catch (persistError) {
              console.error(`[chat-api] Failed to finalize Trigger run ${runId}:`, persistError);
            }
          });

          chatDebug("trigger_return_immediately", { runId });
          return;
        } else {
          const userText = extractLatestUserText(requestBody);
          if (!userText) {
            throw new Error("No user text found in request");
          }

          await streamFromClaudeProxy({
            dataStream,
            chatId: id,
            isNewChat: !chat,
            userText,
            turnstileToken,
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
        const existingMessageIds = new Set(uiMessages.map((message) => message.id));
        let hasPersistedAssistantMessage = false;
        const skipFinishedAssistantPersistence =
          backend !== "gateway" && USE_TRIGGER_DEV && triggerAssistantPersistedInExecute;

        for (const finishedMsg of finishedMessages) {
          if (skipFinishedAssistantPersistence && finishedMsg.role === "assistant") {
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
          if (error.message.startsWith("turnstile_upstream:")) {
            return "Turnstile 验证失败，请重新勾选后再发送。";
          }
          if (error.message.includes("Claude proxy precheck failed (429)")) {
            return "请求过于频繁，请稍后重试。";
          }
          if (error.message.includes("Claude proxy precheck failed")) {
            return "请求预校验失败，请稍后重试。";
          }
          if (error.message.includes("Claude proxy upstream failed (429)")) {
            return "请求过于频繁，请稍后重试。";
          }
        }
        return "Oops, an error occurred!";
      },
    });

    return createUIMessageStreamResponse({
      stream,
      async consumeSseStream({ stream: sseStream }) {
        if (!process.env.REDIS_URL) {
          return;
        }
        try {
          const streamContext = getStreamContext();
          if (streamContext) {
            const streamId = generateId();
            await createStreamId({ streamId, chatId: id });
            await streamContext.createNewResumableStream(streamId, () => sseStream);
          }
        } catch (_) {
          // ignore redis errors
        }
      },
    });
  } catch (error) {
    const vercelId = request.headers.get("x-vercel-id");

    if (error instanceof ChatSDKError) {
      return error.toResponse();
    }

    if (
      error instanceof Error &&
      error.message?.startsWith("turnstile_upstream:")
    ) {
      const reason = error.message.split(":", 2)[1] || "verification_failed";
      return Response.json(
        {
          code: "forbidden:chat",
          message: "Turnstile 验证失败，请重新勾选后再发送。",
          cause: `turnstile_${reason}`,
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
