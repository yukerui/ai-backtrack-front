import { UI_MESSAGE_STREAM_HEADERS } from "ai";
import { after } from "next/server";
import { createResumableStreamContext } from "resumable-stream";
import { auth } from "@/app/(auth)/auth";
import { getChatById, getStreamIdsByChatId } from "@/lib/db/queries";
import { ChatSDKError } from "@/lib/errors";
import { isRedisConfigured } from "@/lib/redis";

function parseResumeAt(searchParam: string | null) {
  if (!searchParam) {
    return undefined;
  }

  const parsed = Number.parseInt(searchParam, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return undefined;
  }

  return parsed;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return new ChatSDKError("unauthorized:chat").toResponse();
  }

  const { id } = await params;
  const chat = await getChatById({ id });

  if (!chat) {
    return new ChatSDKError("not_found:chat").toResponse();
  }

  if (chat.userId !== session.user.id) {
    return new ChatSDKError("forbidden:chat").toResponse();
  }

  if (!isRedisConfigured()) {
    return new Response(null, { status: 204 });
  }

  const streamIds = await getStreamIdsByChatId({ chatId: id });
  const latestStreamId = streamIds.at(-1);

  if (!latestStreamId) {
    return new Response(null, { status: 204 });
  }

  const resumeAt = parseResumeAt(
    new URL(request.url).searchParams.get("resumeAt")
  );
  const streamContext = createResumableStreamContext({ waitUntil: after });
  const stream = await streamContext.resumeExistingStream(
    latestStreamId,
    resumeAt
  );

  if (!stream) {
    return new Response(null, { status: 204 });
  }

  return new Response(stream, { headers: UI_MESSAGE_STREAM_HEADERS });
}
