"use client";
import type { UseChatHelpers } from "@ai-sdk/react";
import { useState } from "react";
import type { Vote } from "@/lib/db/schema";
import type {
  BacktestArtifactItem,
  ChatMessage,
  PlotlyChartPayload,
  ThinkingActivityPayload,
} from "@/lib/types";
import { cn, linkifyUrlsAsMarkdown, sanitizeText } from "@/lib/utils";
import { BacktestArtifactCard } from "./backtest-artifact-card";
import { PlotlyChartCard } from "./plotly-chart-card";
import { useDataStream } from "./data-stream-provider";
import { DocumentToolResult } from "./document";
import { DocumentPreview } from "./document-preview";
import { MessageContent } from "./elements/message";
import { Response } from "./elements/response";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "./elements/tool";
import { SparklesIcon } from "./icons";
import { MessageActions } from "./message-actions";
import { MessageEditor } from "./message-editor";
import { MessageReasoning } from "./message-reasoning";
import { PreviewAttachment } from "./preview-attachment";
import { Weather } from "./weather";

function normalizeBacktestArtifactItems(value: unknown): BacktestArtifactItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized: BacktestArtifactItem[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const candidate = entry as Partial<BacktestArtifactItem>;
    const path = typeof candidate.path === "string" ? candidate.path.trim() : "";
    const url = typeof candidate.url === "string" ? candidate.url.trim() : "";
    const title = typeof candidate.title === "string" ? candidate.title.trim() : "";
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

function normalizePlotlyChart(value: unknown): PlotlyChartPayload | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = value as Partial<PlotlyChartPayload>;
  const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
  const data = Array.isArray(candidate.data) ? candidate.data : [];
  if (!id || !data.length) {
    return null;
  }

  const normalizedData = data
    .filter(
      (entry: unknown) => entry !== null && typeof entry === "object" && !Array.isArray(entry)
    )
    .map((entry: unknown) => ({ ...(entry as Record<string, unknown>) }));
  if (!normalizedData.length) {
    return null;
  }

  return {
    id,
    data: normalizedData,
    ...(typeof candidate.title === "string" && candidate.title.trim()
      ? { title: candidate.title.trim() }
      : {}),
    ...(candidate.layout && typeof candidate.layout === "object" && !Array.isArray(candidate.layout)
      ? { layout: { ...(candidate.layout as Record<string, unknown>) } }
      : {}),
    ...(candidate.config && typeof candidate.config === "object" && !Array.isArray(candidate.config)
      ? { config: { ...(candidate.config as Record<string, unknown>) } }
      : {}),
  };
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

const PurePreviewMessage = ({
  addToolApprovalResponse,
  chatId,
  message,
  vote,
  isLoading,
  setMessages,
  regenerate,
  isReadonly,
  requiresScrollPadding: _requiresScrollPadding,
}: {
  addToolApprovalResponse: UseChatHelpers<ChatMessage>["addToolApprovalResponse"];
  chatId: string;
  message: ChatMessage;
  vote: Vote | undefined;
  isLoading: boolean;
  setMessages: UseChatHelpers<ChatMessage>["setMessages"];
  regenerate: UseChatHelpers<ChatMessage>["regenerate"];
  isReadonly: boolean;
  requiresScrollPadding: boolean;
}) => {
  const [mode, setMode] = useState<"view" | "edit">("view");

  const attachmentsFromMessage = message.parts.filter(
    (part) => part.type === "file"
  );
  const thinkingActivities = message.parts
    .filter((part) => part.type === "data-thinking-activity")
    .map((part) =>
      normalizeThinkingActivity(
        (part as { data?: unknown }).data
      )
    )
    .filter((activity): activity is ThinkingActivityPayload => Boolean(activity));
  const latestThinkingActivity =
    thinkingActivities.length > 0
      ? thinkingActivities[thinkingActivities.length - 1]
      : null;

  useDataStream();

  return (
    <div
      className="group/message fade-in w-full animate-in duration-200"
      data-role={message.role}
      data-testid={`message-${message.role}`}
    >
      <div
        className={cn("flex w-full items-start gap-2 md:gap-3", {
          "justify-end": message.role === "user" && mode !== "edit",
          "justify-start": message.role === "assistant",
        })}
      >
        {message.role === "assistant" && (
          <div className="-mt-1 flex size-8 shrink-0 items-center justify-center rounded-full bg-background ring-1 ring-border">
            <SparklesIcon size={14} />
          </div>
        )}

        <div
          className={cn("flex flex-col", {
            "gap-2 md:gap-4": message.parts?.some(
              (p) =>
                (p.type === "text" && p.text?.trim()) ||
                p.type === "data-backtest-artifact" ||
                p.type === "data-plotly-chart"
            ),
            "w-full":
              (message.role === "assistant" &&
                (message.parts?.some(
                  (p) => p.type === "text" && p.text?.trim()
                ) ||
                  message.parts?.some((p) => p.type.startsWith("tool-")) ||
                  message.parts?.some((p) => p.type === "data-backtest-artifact") ||
                  message.parts?.some((p) => p.type === "data-plotly-chart"))) ||
              mode === "edit",
            "max-w-[calc(100%-2.5rem)] sm:max-w-[min(fit-content,80%)]":
              message.role === "user" && mode !== "edit",
          })}
        >
          {attachmentsFromMessage.length > 0 && (
            <div
              className="flex flex-row justify-end gap-2"
              data-testid={"message-attachments"}
            >
              {attachmentsFromMessage.map((attachment) => (
                <PreviewAttachment
                  attachment={{
                    name: attachment.filename ?? "file",
                    contentType: attachment.mediaType,
                    url: attachment.url,
                  }}
                  key={attachment.url}
                />
              ))}
            </div>
          )}

          {message.parts?.map((part, index) => {
            const { type } = part;
            const key = `message-${message.id}-part-${index}`;

            if (type === "reasoning") {
              const hasContent = part.text?.trim().length > 0;
              const isStreaming = "state" in part && part.state === "streaming";
              const reasoningIdCandidate = (part as { id?: unknown }).id;
              const reasoningId =
                typeof reasoningIdCandidate === "string"
                  ? reasoningIdCandidate
                  : "";
              const activityForReasoning =
                reasoningId
                  ? thinkingActivities
                      .slice()
                      .reverse()
                      .find((activity) => activity.reasoningId === reasoningId) ||
                    latestThinkingActivity
                  : latestThinkingActivity;
              if (hasContent || isStreaming) {
                return (
                  <MessageReasoning
                    activity={activityForReasoning}
                    isLoading={isLoading || isStreaming}
                    key={key}
                    reasoning={part.text || ""}
                    reasoningId={reasoningId}
                  />
                );
              }
            }

            if (type === "text") {
              if (mode === "view") {
                return (
                  <div key={key}>
                    <MessageContent
                      className={cn({
                        "wrap-break-word w-fit rounded-2xl px-3 py-2 text-right text-white":
                          message.role === "user",
                        "bg-transparent px-0 py-0 text-left":
                          message.role === "assistant",
                      })}
                      data-testid="message-content"
                      style={
                        message.role === "user"
                          ? { backgroundColor: "#006cff" }
                          : undefined
                      }
                    >
                      <Response>{linkifyUrlsAsMarkdown(sanitizeText(part.text))}</Response>
                    </MessageContent>
                  </div>
                );
              }

              if (mode === "edit") {
                return (
                  <div
                    className="flex w-full flex-row items-start gap-3"
                    key={key}
                  >
                    <div className="size-8" />
                    <div className="min-w-0 flex-1">
                      <MessageEditor
                        key={message.id}
                        message={message}
                        regenerate={regenerate}
                        setMessages={setMessages}
                        setMode={setMode}
                      />
                    </div>
                  </div>
                );
              }
            }

            if (type === "data-backtest-artifact") {
              const items = normalizeBacktestArtifactItems(
                (part as { data?: { items?: unknown } }).data?.items
              );
              if (!items.length) {
                return null;
              }
              return <BacktestArtifactCard items={items} key={key} />;
            }

            if (type === "data-plotly-chart") {
              const chart = normalizePlotlyChart(
                (part as { data?: { chart?: unknown } }).data?.chart
              );
              if (!chart) {
                return null;
              }
              return <PlotlyChartCard chart={chart} key={key} />;
            }

            if (type === "tool-getWeather") {
              const { toolCallId, state } = part;
              const approvalId = (part as { approval?: { id: string } })
                .approval?.id;
              const isDenied =
                state === "output-denied" ||
                (state === "approval-responded" &&
                  (part as { approval?: { approved?: boolean } }).approval
                    ?.approved === false);
              const widthClass = "w-[min(100%,450px)]";

              if (state === "output-available") {
                return (
                  <div className={widthClass} key={toolCallId}>
                    <Weather weatherAtLocation={part.output} />
                  </div>
                );
              }

              if (isDenied) {
                return (
                  <div className={widthClass} key={toolCallId}>
                    <Tool className="w-full" defaultOpen={true}>
                      <ToolHeader
                        state="output-denied"
                        type="tool-getWeather"
                      />
                      <ToolContent>
                        <div className="px-4 py-3 text-muted-foreground text-sm">
                          Weather lookup was denied.
                        </div>
                      </ToolContent>
                    </Tool>
                  </div>
                );
              }

              if (state === "approval-responded") {
                return (
                  <div className={widthClass} key={toolCallId}>
                    <Tool className="w-full" defaultOpen={true}>
                      <ToolHeader state={state} type="tool-getWeather" />
                      <ToolContent>
                        <ToolInput input={part.input} />
                      </ToolContent>
                    </Tool>
                  </div>
                );
              }

              return (
                <div className={widthClass} key={toolCallId}>
                  <Tool className="w-full" defaultOpen={true}>
                    <ToolHeader state={state} type="tool-getWeather" />
                    <ToolContent>
                      {(state === "input-available" ||
                        state === "approval-requested") && (
                        <ToolInput input={part.input} />
                      )}
                      {state === "approval-requested" && approvalId && (
                        <div className="flex items-center justify-end gap-2 border-t px-4 py-3">
                          <button
                            className="rounded-md px-3 py-1.5 text-muted-foreground text-sm transition-colors hover:bg-muted hover:text-foreground"
                            onClick={() => {
                              addToolApprovalResponse({
                                id: approvalId,
                                approved: false,
                                reason: "User denied weather lookup",
                              });
                            }}
                            type="button"
                          >
                            Deny
                          </button>
                          <button
                            className="rounded-md bg-primary px-3 py-1.5 text-primary-foreground text-sm transition-colors hover:bg-primary/90"
                            onClick={() => {
                              addToolApprovalResponse({
                                id: approvalId,
                                approved: true,
                              });
                            }}
                            type="button"
                          >
                            Allow
                          </button>
                        </div>
                      )}
                    </ToolContent>
                  </Tool>
                </div>
              );
            }

            if (type === "tool-createDocument") {
              const { toolCallId } = part;

              if (part.output && "error" in part.output) {
                return (
                  <div
                    className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-500 dark:bg-red-950/50"
                    key={toolCallId}
                  >
                    Error creating document: {String(part.output.error)}
                  </div>
                );
              }

              return (
                <DocumentPreview
                  isReadonly={isReadonly}
                  key={toolCallId}
                  result={part.output}
                />
              );
            }

            if (type === "tool-updateDocument") {
              const { toolCallId } = part;

              if (part.output && "error" in part.output) {
                return (
                  <div
                    className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-500 dark:bg-red-950/50"
                    key={toolCallId}
                  >
                    Error updating document: {String(part.output.error)}
                  </div>
                );
              }

              return (
                <div className="relative" key={toolCallId}>
                  <DocumentPreview
                    args={{ ...part.output, isUpdate: true }}
                    isReadonly={isReadonly}
                    result={part.output}
                  />
                </div>
              );
            }

            if (type === "tool-requestSuggestions") {
              const { toolCallId, state } = part;

              return (
                <Tool defaultOpen={true} key={toolCallId}>
                  <ToolHeader state={state} type="tool-requestSuggestions" />
                  <ToolContent>
                    {state === "input-available" && (
                      <ToolInput input={part.input} />
                    )}
                    {state === "output-available" && (
                      <ToolOutput
                        errorText={undefined}
                        output={
                          "error" in part.output ? (
                            <div className="rounded border p-2 text-red-500">
                              Error: {String(part.output.error)}
                            </div>
                          ) : (
                            <DocumentToolResult
                              isReadonly={isReadonly}
                              result={part.output}
                              type="request-suggestions"
                            />
                          )
                        }
                      />
                    )}
                  </ToolContent>
                </Tool>
              );
            }

            return null;
          })}

          {!isReadonly && (
            <MessageActions
              chatId={chatId}
              isLoading={isLoading}
              key={`action-${message.id}`}
              message={message}
              setMode={setMode}
              vote={vote}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export const PreviewMessage = PurePreviewMessage;

export const ThinkingMessage = () => {
  return (
    <div
      className="group/message fade-in w-full animate-in duration-300"
      data-role="assistant"
      data-testid="message-assistant-loading"
    >
      <div className="flex items-start justify-start gap-3">
        <div className="-mt-1 flex size-8 shrink-0 items-center justify-center rounded-full bg-background ring-1 ring-border">
          <div className="animate-pulse">
            <SparklesIcon size={14} />
          </div>
        </div>

        <div className="flex w-full flex-col gap-2 md:gap-4">
          <div className="flex items-center gap-1 p-0 text-muted-foreground text-sm">
            <span>正在思考</span>
            <span
              aria-hidden
              className="h-3 w-[2px] animate-pulse rounded-full bg-current/70"
            />
          </div>
        </div>
      </div>
    </div>
  );
};
