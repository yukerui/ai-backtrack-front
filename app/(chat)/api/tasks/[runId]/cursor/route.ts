import { NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
import {
  compareAndSwapTaskCursorState,
  getTaskCursorState,
  getTaskOwnerTtlSeconds,
  getTaskRunOwner,
  hashTaskSessionId,
  readTaskSessionIdFromCookieHeader,
  signTaskCursor,
} from "@/lib/task-security";

function forbiddenTaskAccess(cause: string) {
  return NextResponse.json({ error: "Forbidden", cause }, { status: 403 });
}

async function rotateCursorSig({
  runId,
  sidHash,
}: {
  runId: string;
  sidHash: string;
}) {
  const state = await getTaskCursorState({ runId, sidHash });
  if (!state) {
    return null;
  }

  const ttlSeconds = getTaskOwnerTtlSeconds();
  const nextSig = signTaskCursor({ runId, sidHash, cursor: state.cursor });

  const swapped = await compareAndSwapTaskCursorState({
    runId,
    sidHash,
    expectedCursor: state.cursor,
    expectedSig: state.sig,
    nextCursor: state.cursor,
    nextSig,
    ttlSeconds,
  });

  if (swapped) {
    return { cursor: state.cursor, cursorSig: nextSig };
  }

  const latest = await getTaskCursorState({ runId, sidHash });
  if (!latest) {
    return null;
  }

  const latestSig = signTaskCursor({ runId, sidHash, cursor: latest.cursor });
  const swappedLatest = await compareAndSwapTaskCursorState({
    runId,
    sidHash,
    expectedCursor: latest.cursor,
    expectedSig: latest.sig,
    nextCursor: latest.cursor,
    nextSig: latestSig,
    ttlSeconds,
  });

  if (!swappedLatest) {
    return null;
  }

  return { cursor: latest.cursor, cursorSig: latestSig };
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

  const refreshed = await rotateCursorSig({
    runId,
    sidHash: taskSessionHash,
  });
  if (!refreshed) {
    return forbiddenTaskAccess("stale_cursor_state");
  }

  return NextResponse.json({
    runId,
    cursor: refreshed.cursor,
    cursorSig: refreshed.cursorSig,
  });
}
