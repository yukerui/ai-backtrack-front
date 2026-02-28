import { streams } from "@trigger.dev/sdk";

export type FundChatRealtimeChunk =
  | { type: "reasoning-start"; id: string }
  | { type: "reasoning-delta"; id: string; delta: string }
  | { type: "reasoning-end"; id: string }
  | {
      type: "thinking-activity";
      id: string;
      activity: {
        kind: string;
        label: string;
        active: boolean;
        eventType?: string;
        itemType?: string;
      };
    }
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

  if (parsed.type === "thinking-activity" && isRecord(parsed.activity)) {
    const kind =
      typeof parsed.activity.kind === "string" ? parsed.activity.kind.trim() : "";
    const label =
      typeof parsed.activity.label === "string"
        ? parsed.activity.label.trim()
        : "";
    const active =
      typeof parsed.activity.active === "boolean"
        ? parsed.activity.active
        : Boolean(parsed.activity.active);
    const eventType =
      typeof parsed.activity.eventType === "string" &&
      parsed.activity.eventType.trim()
        ? parsed.activity.eventType.trim()
        : undefined;
    const itemType =
      typeof parsed.activity.itemType === "string" &&
      parsed.activity.itemType.trim()
        ? parsed.activity.itemType.trim()
        : undefined;
    if (!kind || !label) {
      return null;
    }
    return {
      type: "thinking-activity",
      id: parsed.id,
      activity: {
        kind,
        label,
        active,
        ...(eventType ? { eventType } : {}),
        ...(itemType ? { itemType } : {}),
      },
    };
  }

  return null;
}
