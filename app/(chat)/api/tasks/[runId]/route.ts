import { NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { runs } from "@trigger.dev/sdk";
import type { fundChatTask } from "@/trigger/fund-chat-task";
import {
  decodeFundChatRealtimeChunk,
  fundChatRealtimeStream,
  type FundChatRealtimeChunk,
} from "@/trigger/streams";
import { enrichAssistantText } from "@/lib/artifacts";
import { getMessagesByChatId, updateMessage } from "@/lib/db/queries";
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

type RawTaskOutput =
  | string
  | {
      text?: unknown;
      artifacts?: unknown;
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

  // Fallback: render object as JSON so frontend still has something visible.
  return {
    text: `\`\`\`json\n${JSON.stringify(raw, null, 2)}\n\`\`\``,
    artifacts,
  };
}

function appendArtifactsToText(text: string, artifacts: string[]) {
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

async function readRealtimeSnapshot(runId: string, cursor: number) {
  const chunks: FundChatRealtimeChunk[] = [];
  let nextCursor = cursor;
  try {
    const startIndex = cursor > 0 ? cursor + 1 : undefined;
    const streamChunks = await fundChatRealtimeStream.read(runId, {
      timeoutInSeconds: 1,
      ...(typeof startIndex === "number" ? { startIndex } : {}),
    });

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

  let reasoningText = "";
  let text = "";

  for (const chunk of chunks) {
    if (chunk.type === "reasoning-delta") {
      reasoningText += chunk.delta;
      continue;
    }
    if (chunk.type === "text-delta") {
      text += chunk.delta;
    }
  }

  return { reasoningText, text, nextCursor };
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

  const run = await runs.retrieve<typeof fundChatTask>(runId);
  const payloadUserId = (run.payload as { userId?: string } | null)?.userId;
  if (payloadUserId && payloadUserId !== session.user.id) {
    return forbiddenTaskAccess("run_payload_user_mismatch");
  }
  const realtimeSnapshot = await readRealtimeSnapshot(runId, cursor);
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

  if (run.status !== "COMPLETED") {
    return NextResponse.json({
      status: run.status,
      isCompleted: false,
      isFailed: FAILURE_STATUSES.has(run.status),
      nextCursor,
      nextCursorSig,
      reasoningText: realtimeSnapshot.reasoningText,
      text: realtimeSnapshot.text,
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
  const withArtifacts = appendArtifactsToText(normalized.text, normalized.artifacts);
  const enriched = enrichAssistantText(withArtifacts);
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
        await updateMessage({
          id: pendingMessageId,
          parts: [
            {
              type: "text",
              text: enriched,
              state: "done",
            },
          ],
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
    reasoningText: realtimeSnapshot.reasoningText,
    text: enriched,
    artifacts: normalized.artifacts,
  });
}
