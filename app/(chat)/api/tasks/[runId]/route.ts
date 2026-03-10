import { NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { auth as triggerAuth, runs } from "@trigger.dev/sdk";
import type { fundChatTask } from "@/trigger/fund-chat-task";
import {
  decodeFundChatRealtimeChunk,
  fundChatRealtimeStream,
  type FundChatRealtimeChunk,
} from "@/trigger/streams";
import { buildArtifactItems } from "@/lib/artifacts";
import { getMessagesByChatId, updateMessage } from "@/lib/db/queries";
import { extractPlotlyChartsFromText, normalizePlotlyCharts } from "@/lib/plotly";
import type {
  BacktestArtifactItem,
  PlotlyChartPayload,
  ThinkingActivityPayload,
} from "@/lib/types";
import {
  compareAndSwapTaskCursorState,
  getTaskCursorState,
  getTaskOwnerTtlSeconds,
  getTaskRunMessageId,
  getTaskRunOwner,
  hashTaskSessionId,
  readTaskSessionIdFromCookieHeader,
  signTaskCursor,
  verifyTaskCursorSignature,
} from "@/lib/task-security";
import {
  resolveTriggerAccountById,
  toTriggerClientConfig,
} from "@/lib/trigger-accounts";

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

const FAILURE_STATUSES = new Set([
  "FAILED",
  "CRASHED",
  "SYSTEM_FAILURE",
  "TIMED_OUT",
  "CANCELED",
  "EXPIRED",
]);

const RUN_RETRIEVE_RETRIES = 2;
const RUN_RETRIEVE_RETRY_DELAY_MS = 250;

type TaskPollEvent =
  | { type: "reasoning-delta"; id?: string; delta: string }
  | { type: "reasoning-summary-delta"; id?: string; delta: string }
  | { type: "thinking-activity"; activity: ThinkingActivityPayload }
  | { type: "text-delta"; delta: string }
  | { type: "text-replace"; text: string }
  | { type: "plotly-spec"; chart: PlotlyChartPayload }
  | { type: "artifact-items"; items: BacktestArtifactItem[] };

function mapReasoningTitleFromItemType(itemType: string) {
  const normalized = String(itemType || "").toLowerCase().trim();
  if (normalized === "reasoning") {
    return "正在思考";
  }
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toArtifactList(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as string[];
  }
  return value
    .filter((item) => typeof item === "string")
    .map((item) => String(item))
    .filter((item) => item.length > 0);
}

function normalizeOutput(raw: RawTaskOutput) {
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return normalizeOutput(parsed as RawTaskOutput);
    } catch {
      return { text: raw, artifacts: [] as string[], plotlyCharts: [] as unknown[] };
    }
  }

  if (!isRecord(raw)) {
    return { text: "", artifacts: [] as string[], plotlyCharts: [] as unknown[] };
  }

  const text = typeof raw.text === "string" ? raw.text : "";
  const artifacts = toArtifactList(raw.artifacts);
  const plotlyCharts = Array.isArray(raw.plotlyCharts) ? raw.plotlyCharts : [];

  if (text) {
    return { text, artifacts, plotlyCharts };
  }

  // Fallback: render object as JSON so frontend still has something visible.
  return {
    text: `\`\`\`json\n${JSON.stringify(raw, null, 2)}\n\`\`\``,
    artifacts,
    plotlyCharts,
  };
}

function normalizeCursor(value: string | null) {
  if (!value) {
    return 0;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return parsed;
}

function forbiddenTaskAccess(cause: string) {
  return NextResponse.json({ error: "Forbidden", cause }, { status: 403 });
}

function isTimeoutLikeError(error: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : String(error || "");
  const name = error instanceof Error ? error.name : "";
  return (
    name === "TimeoutError" ||
    /aborted due to timeout/i.test(message) ||
    /operation was aborted/i.test(message)
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function retrieveRunWithRetry(
  runId: string,
  clientConfig: { baseURL: string; accessToken: string }
) {
  let lastError: unknown;
  for (let attempt = 0; attempt <= RUN_RETRIEVE_RETRIES; attempt += 1) {
    try {
      return await runs.retrieve<typeof fundChatTask>(runId, { clientConfig });
    } catch (error) {
      lastError = error;
      if (!isTimeoutLikeError(error) || attempt >= RUN_RETRIEVE_RETRIES) {
        break;
      }
      await sleep(RUN_RETRIEVE_RETRY_DELAY_MS * (attempt + 1));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError || "runs_retrieve_failed"));
}

async function readRealtimeSnapshot(
  runId: string,
  cursor: number,
  clientConfig: { baseURL: string; accessToken: string }
) {
  const chunks: FundChatRealtimeChunk[] = [];
  let nextCursor = cursor;
  try {
    const startIndex = cursor > 0 ? cursor + 1 : undefined;
    const streamChunks = await triggerAuth.withAuth(clientConfig, async () =>
      fundChatRealtimeStream.read(runId, {
        timeoutInSeconds: 1,
        ...(typeof startIndex === "number" ? { startIndex } : {}),
      })
    );

    for await (const rawChunk of streamChunks) {
      nextCursor += 1;
      const parsed = decodeFundChatRealtimeChunk(rawChunk);
      if (parsed) {
        chunks.push(parsed);
      }
    }
  } catch {
    // Ignore transient stream read errors and keep polling snapshots resilient.
  }

  const events: TaskPollEvent[] = [];
  let latestReasoningTitle = "";
  let latestNonThinkingReasoningTitle = "";

  for (const chunk of chunks) {
    if (chunk.type === "reasoning-delta") {
      events.push({ type: "reasoning-delta", id: chunk.id, delta: chunk.delta });
      continue;
    }
    if (chunk.type === "thinking-activity") {
      events.push({
        type: "thinking-activity",
        activity: {
          reasoningId: chunk.id,
          kind: chunk.activity.kind,
          label: chunk.activity.label,
          active: chunk.activity.active,
          ...(chunk.activity.eventType ? { eventType: chunk.activity.eventType } : {}),
          ...(chunk.activity.itemType ? { itemType: chunk.activity.itemType } : {}),
        },
      });
      const title = mapReasoningTitleFromItemType(chunk.activity.itemType || "");
      if (title) {
        latestReasoningTitle = title;
        if (title !== "正在思考") {
          latestNonThinkingReasoningTitle = title;
        }
      }
      continue;
    }
    if (chunk.type === "text-delta") {
      events.push({ type: "text-delta", delta: chunk.delta });
    }
  }

  if (latestNonThinkingReasoningTitle || latestReasoningTitle) {
    events.push({
      type: "reasoning-summary-delta",
      delta: latestNonThinkingReasoningTitle || latestReasoningTitle,
    });
  }

  return { events, nextCursor };
}

function toLegacyDeltaText(events: TaskPollEvent[]) {
  let reasoningText = "";
  let reasoningTitle = "";
  let latestNonThinkingReasoningTitle = "";
  for (const event of events) {
    if (event.type === "reasoning-delta") {
      reasoningText += event.delta;
      continue;
    }
    if (event.type === "reasoning-summary-delta") {
      if (typeof event.delta === "string" && event.delta.trim()) {
        reasoningTitle = event.delta.trim();
      }
      continue;
    }
    if (event.type === "thinking-activity") {
      const title = mapReasoningTitleFromItemType(event.activity.itemType || "");
      if (title) {
        reasoningTitle = title;
        if (title !== "正在思考") {
          latestNonThinkingReasoningTitle = title;
        }
      }
    }
  }
  return {
    reasoningText,
    reasoningTitle: latestNonThinkingReasoningTitle || reasoningTitle,
  };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ runId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { runId } = await params;
  const { searchParams } = new URL(request.url);
  const cursor = normalizeCursor(searchParams.get("cursor"));
  const cursorSig = (searchParams.get("cursor_sig") || "").trim();
  if (!cursorSig) {
    return forbiddenTaskAccess("missing_cursor_sig");
  }

  const taskSessionId = readTaskSessionIdFromCookieHeader(
    request.headers.get("cookie")
  );
  if (!taskSessionId) {
    return forbiddenTaskAccess("missing_task_session");
  }
  const taskSessionHash = hashTaskSessionId(taskSessionId);

  const owner = await getTaskRunOwner(runId);
  if (!owner) {
    return forbiddenTaskAccess("task_owner_not_found");
  }
  if (owner.userId !== session.user.id) {
    return forbiddenTaskAccess("task_owner_mismatch");
  }
  if (owner.sidHash !== taskSessionHash) {
    return forbiddenTaskAccess("task_session_mismatch");
  }
  const triggerAccount = resolveTriggerAccountById(owner.triggerAccountId);
  if (!triggerAccount) {
    return NextResponse.json(
      {
        error: "Trigger account not configured",
        cause: "trigger_account_not_configured",
      },
      { status: 500 }
    );
  }
  const triggerClientConfig = toTriggerClientConfig(triggerAccount);

  const isCursorSigValid = verifyTaskCursorSignature({
    token: cursorSig,
    runId,
    sidHash: taskSessionHash,
    cursor,
  });
  if (!isCursorSigValid) {
    return forbiddenTaskAccess("invalid_cursor_sig");
  }

  const cursorState = await getTaskCursorState({
    runId,
    sidHash: taskSessionHash,
  });
  if (!cursorState || cursorState.cursor !== cursor || cursorState.sig !== cursorSig) {
    return forbiddenTaskAccess("stale_cursor_state");
  }

  const realtimeSnapshot = await readRealtimeSnapshot(
    runId,
    cursor,
    triggerClientConfig
  );
  const nextCursor = realtimeSnapshot.nextCursor;
  const nextCursorSig = signTaskCursor({
    runId,
    sidHash: taskSessionHash,
    cursor: nextCursor,
  });
  const cursorAdvanced = await compareAndSwapTaskCursorState({
    runId,
    sidHash: taskSessionHash,
    expectedCursor: cursor,
    expectedSig: cursorSig,
    nextCursor,
    nextSig: nextCursorSig,
    ttlSeconds: getTaskOwnerTtlSeconds(),
  });
  if (!cursorAdvanced) {
    return forbiddenTaskAccess("cursor_advance_conflict");
  }

  let run: Awaited<ReturnType<typeof runs.retrieve<typeof fundChatTask>>>;
  try {
    run = await retrieveRunWithRetry(runId, triggerClientConfig);
  } catch (error) {
    const legacy = toLegacyDeltaText(realtimeSnapshot.events);
    const message = error instanceof Error ? error.message : String(error || "runs_retrieve_failed");
    if (isTimeoutLikeError(error)) {
      return NextResponse.json({
        status: "RUNNING",
        isCompleted: false,
        isFailed: false,
        nextCursor,
        nextCursorSig,
        events: realtimeSnapshot.events,
        reasoningText: legacy.reasoningText,
        reasoningTitle: legacy.reasoningTitle,
        error: {
          message,
          transient: true,
          cause: "runs_retrieve_timeout",
        },
      });
    }
    return NextResponse.json(
      {
        status: "UNKNOWN",
        isCompleted: false,
        isFailed: false,
        nextCursor,
        nextCursorSig,
        events: realtimeSnapshot.events,
        reasoningText: legacy.reasoningText,
        reasoningTitle: legacy.reasoningTitle,
        error: {
          message,
          transient: true,
          cause: "runs_retrieve_failed",
        },
      },
      { status: 502 }
    );
  }

  const payloadUserId = (run.payload as { userId?: string } | null)?.userId;
  if (payloadUserId && payloadUserId !== session.user.id) {
    return forbiddenTaskAccess("run_payload_user_mismatch");
  }

  if (run.status !== "COMPLETED") {
    const legacy = toLegacyDeltaText(realtimeSnapshot.events);
    return NextResponse.json({
      status: run.status,
      isCompleted: false,
      isFailed: FAILURE_STATUSES.has(run.status),
      nextCursor,
      nextCursorSig,
      events: realtimeSnapshot.events,
      reasoningText: legacy.reasoningText,
      reasoningTitle: legacy.reasoningTitle,
      error: run.error || null,
    });
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
  const artifactItems = buildArtifactItems(normalized.artifacts);
  const chartsFromOutput = normalizePlotlyCharts(
    normalized.plotlyCharts,
    `task-${runId}-explicit`
  );
  const {
    text: strippedText,
    charts: chartsFromText,
  } = extractPlotlyChartsFromText(normalized.text, `task-${runId}-text`);
  const plotlyCharts = [...chartsFromOutput, ...chartsFromText];
  const finalText =
    strippedText.trim() ||
    (plotlyCharts.length > 0
      ? "已生成交互图表，请在下方图表卡片查看。"
      : artifactItems.length > 0
        ? "已生成回测结果，请点击下方卡片查看。"
        : strippedText);
  const completionEvents: TaskPollEvent[] = [
    { type: "text-replace", text: finalText },
    ...plotlyCharts.map((chart) => ({ type: "plotly-spec", chart }) as const),
    ...(artifactItems.length > 0
      ? [{ type: "artifact-items", items: artifactItems } as const]
      : []),
  ];
  const allEvents: TaskPollEvent[] = [...realtimeSnapshot.events, ...completionEvents];
  const legacy = toLegacyDeltaText(realtimeSnapshot.events);
  const chatId = (run.payload as { chatId?: string } | null)?.chatId;

  if (chatId) {
    try {
      let pendingMessageId = await getTaskRunMessageId(runId);
      if (!pendingMessageId) {
        const marker = `[[task:${runId}]]`;
        const messages = await getMessagesByChatId({ id: chatId });
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
        pendingMessageId = pendingMessage?.id || null;
      }

      if (pendingMessageId) {
        const parts = [
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
          parts,
        });
      }
    } catch (persistError) {
      console.error(`[tasks-api] Failed to persist run output for ${runId}:`, persistError);
    }
  }

  return NextResponse.json({
    status: run.status,
    isCompleted: true,
    nextCursor,
    nextCursorSig,
    events: allEvents,
    reasoningText: legacy.reasoningText,
    reasoningTitle: legacy.reasoningTitle,
    artifacts: artifactItems,
    plotlyCharts,
  });
}
