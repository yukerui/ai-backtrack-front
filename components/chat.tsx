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
import type { Attachment, ChatMessage } from "@/lib/types";
import { fetcher, fetchWithErrorHandlers, generateUUID } from "@/lib/utils";
import { Artifact } from "./artifact";
import { useDataStream } from "./data-stream-provider";
import { Messages } from "./messages";
import { MultimodalInput } from "./multimodal-input";
import { getChatHistoryPaginationKey } from "./sidebar-history";
import { toast } from "./toast";
import type { VisibilityType } from "./visibility-selector";

const TASK_AUTH_REGEX =
  /\[\[task-auth:([A-Za-z0-9_-]+):([0-9]+):([A-Za-z0-9._-]+)\]\]/g;
const TASK_POLL_INTERVAL_MS = 2000;

type TaskStatusResponse = {
  status: string;
  isCompleted: boolean;
  isFailed?: boolean;
  nextCursor?: number;
  nextCursorSig?: string;
  reasoningText?: string;
  text?: string;
};

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

function extractMessageText(message: ChatMessage) {
  const parts = Array.isArray(message.parts) ? message.parts : [];
  return parts
    .filter((part) => typeof part === "object" && part !== null && (part as { type?: unknown }).type === "text")
    .map((part) => String((part as { text?: unknown }).text || ""))
    .join("\n");
}

function extractReasoningText(message: ChatMessage) {
  const parts = Array.isArray(message.parts) ? message.parts : [];
  return parts
    .filter(
      (part) =>
        typeof part === "object" && part !== null && (part as { type?: unknown }).type === "reasoning"
    )
    .map((part) => String((part as { text?: unknown }).text || ""))
    .join("\n");
}

function extractTaskPollingMetaFromMessage(message: ChatMessage): TaskPollingMeta | null {
  const text = extractMessageText(message);
  let latest: TaskPollingMeta | null = null;

  for (const match of text.matchAll(TASK_AUTH_REGEX)) {
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

function extractTaskPollingMetaFromDataPart(dataPart: unknown): TaskPollingMeta | null {
  if (!dataPart || typeof dataPart !== "object") {
    return null;
  }

  const candidate = dataPart as DataTaskAuthPart;
  if (candidate.type !== "data-task-auth" || !candidate.data) {
    return null;
  }

  const runId = typeof candidate.data.runId === "string" ? candidate.data.runId : "";
  const rawCursor = candidate.data.cursor;
  const cursor =
    typeof rawCursor === "number" ? Math.trunc(rawCursor) : Number.parseInt(String(rawCursor ?? ""), 10);
  const cursorSig = typeof candidate.data.cursorSig === "string" ? candidate.data.cursorSig : "";

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
  const pollingAbortControllersRef = useRef<Map<string, AbortController>>(new Map());
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
        document.cookie =
          "turnstile_token=; Path=/; Max-Age=0; SameSite=Lax";
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

        const activeMessageId = pollingMessageIdsRef.current.get(runId) || messageId;
        const updateMessages = setMessagesRef.current;
        if (!updateMessages) {
          stopPollingRun(runId);
          return;
        }

        const reasoningDelta =
          typeof payload.reasoningText === "string" ? payload.reasoningText : "";
        const textDelta = typeof payload.text === "string" ? payload.text : "";

        if (!payload.isCompleted && !payload.isFailed && (reasoningDelta || textDelta)) {
          updateMessages((current) =>
            current.map((msg) => {
              if (msg.id !== activeMessageId) {
                return msg;
              }
              const existingReasoning = extractReasoningText(msg);
              const existingText = extractMessageText(msg);
              const nextReasoning = reasoningDelta
                ? `${existingReasoning}${reasoningDelta}`
                : existingReasoning;
              const nextText = textDelta ? `${existingText}${textDelta}` : existingText;
              const streamingParts = [
                ...(nextReasoning
                  ? [
                      {
                        type: "reasoning" as const,
                        text: nextReasoning,
                        state: "streaming" as const,
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
              ] as ChatMessage["parts"];
              return {
                ...msg,
                parts: streamingParts,
              };
            })
          );
        }

        const completedTextValue = typeof payload.text === "string" ? payload.text : "";
        if (payload.isCompleted) {
          updateMessages((current) =>
            current.map((msg) => {
              if (msg.id !== activeMessageId) {
                return msg;
              }
              const existingReasoning = extractReasoningText(msg);
              const finalReasoning = reasoningDelta
                ? `${existingReasoning}${reasoningDelta}`
                : existingReasoning;
              const completedParts = [
                ...(finalReasoning
                  ? [
                      {
                        type: "reasoning" as const,
                        text: finalReasoning,
                        state: "done" as const,
                      },
                    ]
                  : []),
                {
                  type: "text" as const,
                  text: completedTextValue,
                },
              ] as ChatMessage["parts"];
              return {
                ...msg,
                parts: completedParts,
              };
            })
          );
          stopPollingRun(runId);
          mutate(unstable_serialize(getChatHistoryPaginationKey));
          return;
        }

        if (payload.isFailed) {
          updateMessages((current) =>
            current.map((msg) => {
              if (msg.id !== activeMessageId) {
                return msg;
              }
              return {
                ...msg,
                parts: [{ type: "text", text: `任务执行失败：${payload.status}` }],
              };
            })
          );
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
        extractTaskPollingMetaFromMessage(message as ChatMessage) || pendingTaskMetaRef.current;
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
  }, [query, sendMessage, hasAppendedQuery, id, turnstileSiteKey, turnstileToken]);

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
    const latestAssistantMessageId = findLatestAssistantMessageIdInLatestTurn(messages);
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
