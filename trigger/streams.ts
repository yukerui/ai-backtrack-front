import { streams } from "@trigger.dev/sdk";

export type FundChatRealtimeChunk =
  | { type: "reasoning-start"; id: string }
  | { type: "reasoning-delta"; id: string; delta: string }
  | { type: "reasoning-end"; id: string }
  | { type: "text-start"; id: string }
  | { type: "text-delta"; id: string; delta: string }
  | { type: "text-end"; id: string };

export const fundChatRealtimeStream = streams.define<string>({
  id: "fund-chat-realtime",
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function encodeFundChatRealtimeChunk(chunk: FundChatRealtimeChunk) {
  return JSON.stringify(chunk);
}

export function decodeFundChatRealtimeChunk(raw: unknown): FundChatRealtimeChunk | null {
  if (typeof raw !== "string" || !raw) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }

  if (!isRecord(parsed)) {
    return null;
  }
  if (typeof parsed.type !== "string" || typeof parsed.id !== "string") {
    return null;
  }

  if (
    parsed.type === "reasoning-start" ||
    parsed.type === "reasoning-end" ||
    parsed.type === "text-start" ||
    parsed.type === "text-end"
  ) {
    return { type: parsed.type, id: parsed.id };
  }

  if (
    (parsed.type === "reasoning-delta" || parsed.type === "text-delta") &&
    typeof parsed.delta === "string"
  ) {
    return { type: parsed.type, id: parsed.id, delta: parsed.delta };
  }

  return null;
}
