import { auth } from "@/app/(auth)/auth";
import { getChatById, getMessagesByChatId } from "@/lib/db/queries";
import { ChatSDKError } from "@/lib/errors";
import { convertToUIMessages } from "@/lib/utils";

export async function GET(
  _request: Request,
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

  const messages = await getMessagesByChatId({ id });

  return Response.json(
    { messages: convertToUIMessages(messages) },
    { status: 200 }
  );
}
