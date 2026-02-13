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
import { auth, type UserType } from "@/app/(auth)/auth";
import { entitlementsByUserType } from "@/lib/ai/entitlements";
import { DEFAULT_CHAT_MODEL } from "@/lib/ai/models";
import { type RequestHints, systemPrompt } from "@/lib/ai/prompts";
import { getLanguageModel } from "@/lib/ai/providers";
import { createDocument } from "@/lib/ai/tools/create-document";
import { getWeather } from "@/lib/ai/tools/get-weather";
import { requestSuggestions } from "@/lib/ai/tools/request-suggestions";
import { updateDocument } from "@/lib/ai/tools/update-document";
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
import { generateTitleFromUserMessage } from "../../actions";
import { type PostRequestBody, postRequestBodySchema } from "./schema";

export const maxDuration = 60;

const DEFAULT_BACKEND = "claude_proxy";
const FIXED_CHAT_MODEL =
  process.env.CODEX_MODEL || process.env.CLAUDE_CODE_MODEL || "gpt-5-codex";

function getStreamContext() {
  try {
    return createResumableStreamContext({ waitUntil: after });
  } catch (_) {
    return null;
  }
}

export { getStreamContext };

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

function toArtifactUrl(path: string) {
  return `/api/artifacts?path=${encodeURIComponent(path)}`;
}

function enrichAssistantText(raw: string) {
  if (!raw) {
    return raw;
  }

  const pathRegex = /artifacts\/[A-Za-z0-9._/-]+\.(html|csv)/g;
  const seen = new Set<string>();

  let text = raw
    .replace(
      /在项目根目录运行\s*`open\s+[^`]+`\s*即可在浏览器中查看，?/g,
      "可直接点击下方链接查看，"
    )
    .replace(
      /run\s+`open\s+[^`]+`\s+to\s+view\s+it\s+in\s+your\s+browser\.?/gi,
      "open it directly from the link below."
    );

  text = text.replace(/`(artifacts\/[A-Za-z0-9._/-]+\.(?:html|csv))`/g, (_, path) => {
    const normalized = String(path);
    seen.add(normalized);
    return `[\`${normalized}\`](${toArtifactUrl(normalized)})`;
  });

  let match: RegExpExecArray | null = null;
  while ((match = pathRegex.exec(text)) !== null) {
    seen.add(match[0]);
  }

  if (seen.size === 0) {
    return text;
  }

  const htmlTargets = Array.from(seen).filter((path) => path.endsWith(".html"));
  const csvTargets = Array.from(seen).filter((path) => path.endsWith(".csv"));

  const appended: string[] = [];
  if (htmlTargets.length > 0) {
    appended.push(
      ...htmlTargets.map((path, index) => `[打开交互网页${index + 1}](${toArtifactUrl(path)})`)
    );
  }
  if (csvTargets.length > 0) {
    appended.push(
      ...csvTargets.map((path, index) => `[下载数据文件${index + 1}](${toArtifactUrl(path)})`)
    );
  }

  return `${text}\n\n${appended.join(" | ")}`;
}

async function streamFromClaudeProxy({
  dataStream,
  chatId,
  isNewChat,
  userText,
}: {
  dataStream: any;
  chatId: string;
  isNewChat: boolean;
  userText: string;
}) {
  const base = process.env.CLAUDE_CODE_API_BASE || "http://127.0.0.1:15722";
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
    throw new Error(
      `Claude proxy upstream failed (${upstream.status}): ${details || upstream.statusText}`
    );
  }

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  const textId = generateUUID();
  const reasoningId = generateUUID();
  let buffer = "";
  let textBuffer = "";
  let reasoningBuffer = "";

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
        reasoningBuffer += normalizedReasoning;
      }

      if (textDelta) {
        textBuffer += textDelta;
      }
    }
  }

  if (reasoningBuffer) {
    dataStream.write({ type: "reasoning-start", id: reasoningId });
    dataStream.write({
      type: "reasoning-delta",
      id: reasoningId,
      delta: reasoningBuffer,
    });
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

  try {
    const json = await request.json();
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
        if (isToolApprovalFlow && backend === "gateway") {
          for (const finishedMsg of finishedMessages) {
            const existingMsg = uiMessages.find((m) => m.id === finishedMsg.id);
            if (existingMsg) {
              await updateMessage({
                id: finishedMsg.id,
                parts: finishedMsg.parts,
              });
            } else {
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
            }
          }
          return;
        }

        if (finishedMessages.length > 0) {
          await saveMessages({
            messages: finishedMessages.map((currentMessage) => ({
              id: currentMessage.id,
              role: currentMessage.role,
              parts: currentMessage.parts,
              createdAt: new Date(),
              attachments: [],
              chatId: id,
            })),
          });
        }
      },
      onError: () => "Oops, an error occurred!",
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
