import { NextResponse } from "next/server";
import { auth as triggerAuth } from "@trigger.dev/sdk";
import { auth } from "@/app/(auth)/auth";
import {
  DEFAULT_TRIGGER_REALTIME_TIMEOUT_SECONDS,
  normalizeRealtimeTimeoutSeconds,
} from "@/lib/realtime-timeout";
import {
  getTaskRunOwner,
  hashTaskSessionId,
  readTaskSessionIdFromCookieHeader,
} from "@/lib/task-security";

const TRIGGER_REALTIME_STREAM_ID = "fund-chat-realtime";
const TRIGGER_REALTIME_API_URL =
  process.env.TRIGGER_API_URL || "https://api.trigger.dev";
const TRIGGER_REALTIME_PUBLIC_TOKEN_TTL =
  process.env.TRIGGER_REALTIME_PUBLIC_TOKEN_TTL || "30m";
const TRIGGER_REALTIME_READ_TIMEOUT_SECONDS = normalizeRealtimeTimeoutSeconds(
  process.env.TRIGGER_STREAM_READ_TIMEOUT_SECONDS,
  DEFAULT_TRIGGER_REALTIME_TIMEOUT_SECONDS
);

function forbiddenTaskAccess(cause: string) {
  return NextResponse.json({ error: "Forbidden", cause }, { status: 403 });
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

  try {
    const publicAccessToken = await triggerAuth.createPublicToken({
      scopes: {
        read: {
          runs: [runId],
        },
      },
      expirationTime: TRIGGER_REALTIME_PUBLIC_TOKEN_TTL,
      realtime: {
        skipColumns: ["payload", "output"],
      },
    });

    return NextResponse.json({
      runId,
      realtime: {
        apiUrl: TRIGGER_REALTIME_API_URL,
        publicAccessToken,
        streamId: TRIGGER_REALTIME_STREAM_ID,
        readTimeoutSeconds: TRIGGER_REALTIME_READ_TIMEOUT_SECONDS,
      },
    });
  } catch (error) {
    console.error("[tasks-realtime-token] create_public_token_failed", {
      runId,
      userId: session.user.id,
      error: error instanceof Error ? error.message : String(error || ""),
    });
    return NextResponse.json(
      {
        error: "Failed to refresh realtime token",
        cause: "create_public_token_failed",
      },
      { status: 502 }
    );
  }
}
