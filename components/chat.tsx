"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
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

const TASK_MARKER_REGEX = /\[\[task:([A-Za-z0-9_-]+)\]\]/;
const TASK_POLL_INTERVAL_MS = 2000;

type TaskStatusResponse = {
  status: string;
  isCompleted: boolean;
  isFailed?: boolean;
  text?: string;
};

function extractMessageText(message: ChatMessage) {
  const parts = Array.isArray(message.parts) ? message.parts : [];
  return parts
    .filter((part) => part.type === "text")
    .map((part) => String((part as { text?: unknown }).text || ""))
    .join("\n");
}

function extractTaskRunIdFromMessage(message: ChatMessage) {
  const text = extractMessageText(message);
  const match = text.match(TASK_MARKER_REGEX);
  return match?.[1] || "";
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
  const turnstileTokenRef = useRef("");
  const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || "";

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
    },
    onFinish: () => {
      mutate(unstable_serialize(getChatHistoryPaginationKey));
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
    let disposed = false;

    const startPollingRun = (runId: string, messageId: string) => {
      if (!runId || pollingRunIdsRef.current.has(runId)) {
        return;
      }
      pollingRunIdsRef.current.add(runId);

      const poll = async () => {
        if (disposed) {
          pollingRunIdsRef.current.delete(runId);
          return;
        }

        try {
          const response = await fetch(`/api/tasks/${runId}`, {
            method: "GET",
            cache: "no-store",
          });
          if (!response.ok) {
            throw new Error(`Task status fetch failed (${response.status})`);
          }

          const payload = (await response.json()) as TaskStatusResponse;
          if (payload.isCompleted && typeof payload.text === "string") {
            setMessages((current) =>
              current.map((msg) => {
                if (msg.id !== messageId) {
                  return msg;
                }
                return {
                  ...msg,
                  parts: [{ type: "text", text: payload.text }],
                };
              })
            );
            pollingRunIdsRef.current.delete(runId);
            mutate(unstable_serialize(getChatHistoryPaginationKey));
            return;
          }

          if (payload.isFailed) {
            setMessages((current) =>
              current.map((msg) => {
                if (msg.id !== messageId) {
                  return msg;
                }
                return {
                  ...msg,
                  parts: [{ type: "text", text: `任务执行失败：${payload.status}` }],
                };
              })
            );
            pollingRunIdsRef.current.delete(runId);
            return;
          }
        } catch (error) {
          console.error(`[chat-ui] Task poll failed for ${runId}:`, error);
        }

        window.setTimeout(poll, TASK_POLL_INTERVAL_MS);
      };

      window.setTimeout(poll, TASK_POLL_INTERVAL_MS);
    };

    for (const message of messages) {
      if (message.role !== "assistant") {
        continue;
      }
      const runId = extractTaskRunIdFromMessage(message);
      if (!runId) {
        continue;
      }
      startPollingRun(runId, message.id);
    }

    return () => {
      disposed = true;
    };
  }, [messages, setMessages, mutate]);

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
