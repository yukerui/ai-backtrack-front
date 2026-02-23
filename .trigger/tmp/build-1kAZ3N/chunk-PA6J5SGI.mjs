import {
  streams
} from "./chunk-C2RX367I.mjs";
import {
  __name,
  init_esm
} from "./chunk-HCMACSWI.mjs";

// trigger/streams.ts
init_esm();
var fundChatRealtimeStream = streams.define({
  id: "fund-chat-realtime"
});
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
__name(isRecord, "isRecord");
function encodeFundChatRealtimeChunk(chunk) {
  return JSON.stringify(chunk);
}
__name(encodeFundChatRealtimeChunk, "encodeFundChatRealtimeChunk");
function decodeFundChatRealtimeChunk(raw) {
  if (typeof raw !== "string" || !raw) {
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) {
    return null;
  }
  if (typeof parsed.type !== "string" || typeof parsed.id !== "string") {
    return null;
  }
  if (parsed.type === "reasoning-start" || parsed.type === "reasoning-end" || parsed.type === "text-start" || parsed.type === "text-end") {
    return { type: parsed.type, id: parsed.id };
  }
  if ((parsed.type === "reasoning-delta" || parsed.type === "text-delta") && typeof parsed.delta === "string") {
    return { type: parsed.type, id: parsed.id, delta: parsed.delta };
  }
  return null;
}
__name(decodeFundChatRealtimeChunk, "decodeFundChatRealtimeChunk");

export {
  fundChatRealtimeStream,
  encodeFundChatRealtimeChunk,
  decodeFundChatRealtimeChunk
};
//# sourceMappingURL=chunk-PA6J5SGI.mjs.map
