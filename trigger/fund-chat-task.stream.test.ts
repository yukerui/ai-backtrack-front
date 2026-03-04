import assert from "node:assert/strict";
import test from "node:test";
import { streamUpstreamResponse } from "./fund-chat-task";
import type { FundChatRealtimeChunk } from "./streams";

function buildSseResponse(events: string[]) {
  const raw = events.map((event) => `data: ${event}\n\n`).join("");
  const encoder = new TextEncoder();
  const chunk = encoder.encode(raw);

  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(chunk);
        controller.close();
      },
    })
  );
}

test("throws when stream ends without [DONE] marker", async () => {
  const response = buildSseResponse([
    JSON.stringify({
      choices: [
        {
          delta: {
            reasoning: "已拿到三组实时数据，准备写入历史缓存",
          },
        },
      ],
    }),
  ]);

  await assert.rejects(
    streamUpstreamResponse(response, {
      appendRealtimeChunk: async () => {},
    }),
    /\[DONE\]/i
  );
});

test("throws when stream has [DONE] but no final assistant text", async () => {
  const response = buildSseResponse([
    JSON.stringify({
      choices: [
        {
          delta: {
            reasoning: "正在计算中",
          },
        },
      ],
    }),
    "[DONE]",
  ]);

  await assert.rejects(
    streamUpstreamResponse(response, {
      appendRealtimeChunk: async () => {},
    }),
    /assistant text/i
  );
});

test("returns text when stream includes text-delta and [DONE]", async () => {
  const emitted: FundChatRealtimeChunk[] = [];
  const response = buildSseResponse([
    JSON.stringify({
      choices: [
        {
          delta: {
            reasoning: "先做复算",
          },
        },
      ],
    }),
    JSON.stringify({
      choices: [
        {
          delta: {
            content: "513100 当前估算溢价约 4.37%。",
          },
        },
      ],
    }),
    "[DONE]",
  ]);

  const text = await streamUpstreamResponse(response, {
    appendRealtimeChunk: async (chunk) => {
      emitted.push(chunk);
    },
  });

  assert.equal(text, "513100 当前估算溢价约 4.37%。");
  assert.ok(emitted.some((chunk) => chunk.type === "text-delta"));
  assert.ok(emitted.some((chunk) => chunk.type === "reasoning-delta"));
  assert.ok(emitted.some((chunk) => chunk.type === "text-end"));
});
