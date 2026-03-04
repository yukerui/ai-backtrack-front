import assert from "node:assert/strict";
import test from "node:test";
import {
  extractReasoningDelta,
  extractReasoningSummaryDelta,
  extractTextDelta,
  parseUpstreamDeltaPayload,
} from "./upstream-sse-parser";

test("parses standard single-line SSE JSON payload", () => {
  const block =
    'data: {"choices":[{"delta":{"reasoning":"step-1","reasoning_summary":"thinking","content":"answer"}}]}\n\n';
  const parsed = parseUpstreamDeltaPayload(block);
  assert.ok(parsed);
  const delta = parsed.choices?.[0]?.delta;
  assert.equal(extractReasoningDelta(delta), "step-1");
  assert.equal(extractReasoningSummaryDelta(delta), "thinking");
  assert.equal(extractTextDelta(delta), "answer");
});

test("parses JSON even when upstream splits one payload across multiple data lines", () => {
  const block = [
    'event: message',
    'data: {"choices":[{"delta":{"reasoning":"第一段',
    'data: 第二段","reasoning_summary":"正在处理"}}]}',
    "",
  ].join("\n");

  const parsed = parseUpstreamDeltaPayload(block);
  assert.ok(parsed, "payload should be parsed instead of silently dropped");

  const delta = parsed.choices?.[0]?.delta;
  assert.equal(extractReasoningDelta(delta), "第一段第二段");
  assert.equal(extractReasoningSummaryDelta(delta), "正在处理");
});

test("returns null for [DONE] marker payload", () => {
  const block = ["event: message", "data: [DONE]", ""].join("\n");
  const parsed = parseUpstreamDeltaPayload(block);
  assert.equal(parsed, null);
});
