import { createHash } from "node:crypto";

export type IdempotencyAttachment = {
  name: string;
  url: string;
  mediaType: string;
};

type BuildTriggerIdempotencyKeyInput = {
  chatId: string;
  userId: string;
  requestId: string;
  userText: string;
  messageId?: string;
  attachments?: IdempotencyAttachment[];
};

function buildAttachmentSignature(attachments: IdempotencyAttachment[] | undefined) {
  if (!Array.isArray(attachments) || attachments.length === 0) {
    return "no_attachments";
  }

  return attachments
    .map((item) =>
      `${String(item.name || "").trim()}|${String(item.mediaType || "").trim()}|${String(
        item.url || ""
      ).trim()}`
    )
    .filter(Boolean)
    .sort()
    .join("||");
}

export function buildTriggerIdempotencyKey({
  chatId,
  userId,
  requestId,
  userText,
  messageId,
  attachments,
}: BuildTriggerIdempotencyKeyInput) {
  const attachmentSignature = buildAttachmentSignature(attachments);
  const trimmedMessageId = String(messageId || "").trim();
  const rawKey = trimmedMessageId
    ? `fund-chat:${chatId}:${userId}:${trimmedMessageId}:${attachmentSignature}`
    : `fund-chat:${chatId}:${userId}:${requestId}:${userText}:${attachmentSignature}`;

  return createHash("sha256").update(rawKey).digest("hex");
}
