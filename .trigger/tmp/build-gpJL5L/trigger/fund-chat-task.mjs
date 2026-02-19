import {
  encodeFundChatRealtimeChunk,
  fundChatRealtimeStream
} from "../chunk-PA6J5SGI.mjs";
import {
  schemaTask
} from "../chunk-C2RX367I.mjs";
import "../chunk-BI6W6ZVX.mjs";
import {
  external_exports
} from "../chunk-QRJH3P2Q.mjs";
import "../chunk-BOWOYANA.mjs";
import "../chunk-MW2P5RHG.mjs";
import {
  __name,
  init_esm
} from "../chunk-HCMACSWI.mjs";

// trigger/fund-chat-task.ts
init_esm();
import { randomUUID } from "node:crypto";
var payloadSchema = external_exports.object({
  userId: external_exports.string(),
  chatId: external_exports.string(),
  userText: external_exports.string().min(1),
  model: external_exports.string().optional(),
  isNewChat: external_exports.boolean().optional(),
  turnstileToken: external_exports.string().optional()
});
var TASK_MAX_DURATION_SECONDS = Number.parseInt(
  process.env.TRIGGER_FUND_CHAT_MAX_DURATION_SECONDS || "1800",
  10
);
var UPSTREAM_TIMEOUT_MS = Number.parseInt(
  process.env.TRIGGER_UPSTREAM_TIMEOUT_MS || "1800000",
  10
);
var UPSTREAM_RETRIES = Number.parseInt(
  process.env.TRIGGER_UPSTREAM_RETRIES || "1",
  10
);
var ARTIFACT_PATH_REGEX = /(?:backend\/|front\/)?artifacts\/[A-Za-z0-9._/-]+\.(?:html|csv)/g;
function normalizeBase(rawBase) {
  const trimmed = rawBase.replace(/\/+$/, "");
  if (trimmed.endsWith("/v1/chat/completions")) {
    return trimmed.replace(/\/v1\/chat\/completions$/, "");
  }
  return trimmed;
}
__name(normalizeBase, "normalizeBase");
function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
__name(wait, "wait");
function mergeSignals(signals) {
  const active = signals.filter(Boolean);
  if (active.length === 0) {
    return void 0;
  }
  if (active.length === 1) {
    return active[0];
  }
  const controller = new AbortController();
  for (const signal of active) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      return controller.signal;
    }
    signal.addEventListener(
      "abort",
      () => {
        if (!controller.signal.aborted) {
          controller.abort(signal.reason);
        }
      },
      { once: true }
    );
  }
  return controller.signal;
}
__name(mergeSignals, "mergeSignals");
function buildFetchErrorMessage(base, error) {
  const err = error;
  const code = err?.cause?.code || err?.code || "";
  const message = err?.cause?.message || err?.message || String(error);
  const prefix = code ? `${code}: ` : "";
  return `Upstream fetch failed (${base}/v1/chat/completions): ${prefix}${message}`;
}
__name(buildFetchErrorMessage, "buildFetchErrorMessage");
function extractSsePayload(eventBlock) {
  const lines = eventBlock.split(/\r?\n/);
  const dataLines = lines.filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim());
  if (dataLines.length === 0) {
    return "";
  }
  return dataLines.join("\n").trim();
}
__name(extractSsePayload, "extractSsePayload");
function extractTextDelta(delta) {
  const content = delta?.content;
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content.map((part) => typeof part?.text === "string" ? part.text : "").join("");
}
__name(extractTextDelta, "extractTextDelta");
function extractReasoningDelta(delta) {
  return typeof delta?.reasoning === "string" ? delta.reasoning : "";
}
__name(extractReasoningDelta, "extractReasoningDelta");
function extractArtifactsFromText(text) {
  return Array.from(new Set(text.match(ARTIFACT_PATH_REGEX) || []));
}
__name(extractArtifactsFromText, "extractArtifactsFromText");
async function appendRealtimeChunk(chunk) {
  await fundChatRealtimeStream.append(encodeFundChatRealtimeChunk(chunk));
}
__name(appendRealtimeChunk, "appendRealtimeChunk");
async function streamUpstreamResponse(response) {
  if (!response.body) {
    throw new Error("Upstream returned empty stream body");
  }
  const textPartId = `text_${randomUUID()}`;
  const reasoningPartId = `reasoning_${randomUUID()}`;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let sawDone = false;
  let text = "";
  let textStarted = false;
  let reasoningStarted = false;
  const consumeEvent = /* @__PURE__ */ __name(async (eventBlock) => {
    const payload = extractSsePayload(eventBlock);
    if (!payload) {
      return;
    }
    if (payload === "[DONE]") {
      sawDone = true;
      return;
    }
    let parsed = null;
    try {
      parsed = JSON.parse(payload);
    } catch {
      return;
    }
    const delta = parsed?.choices?.[0]?.delta;
    const reasoningDelta = extractReasoningDelta(delta);
    if (reasoningDelta) {
      if (!reasoningStarted) {
        await appendRealtimeChunk({
          type: "reasoning-start",
          id: reasoningPartId
        });
        reasoningStarted = true;
      }
      await appendRealtimeChunk({
        type: "reasoning-delta",
        id: reasoningPartId,
        delta: reasoningDelta
      });
    }
    const textDelta = extractTextDelta(delta);
    if (textDelta) {
      if (!textStarted) {
        await appendRealtimeChunk({
          type: "text-start",
          id: textPartId
        });
        textStarted = true;
      }
      await appendRealtimeChunk({
        type: "text-delta",
        id: textPartId,
        delta: textDelta
      });
      text += textDelta;
    }
  }, "consumeEvent");
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    pending += decoder.decode(value, { stream: true });
    const events = pending.split(/\r?\n\r?\n/);
    pending = events.pop() || "";
    for (const event of events) {
      await consumeEvent(event);
      if (sawDone) {
        break;
      }
    }
    if (sawDone) {
      break;
    }
  }
  pending += decoder.decode();
  if (!sawDone && pending.trim()) {
    await consumeEvent(pending);
  }
  if (reasoningStarted) {
    await appendRealtimeChunk({
      type: "reasoning-end",
      id: reasoningPartId
    });
  }
  if (textStarted) {
    await appendRealtimeChunk({
      type: "text-end",
      id: textPartId
    });
  }
  return text;
}
__name(streamUpstreamResponse, "streamUpstreamResponse");
var fundChatTask = schemaTask({
  id: "fund-chat-task",
  schema: payloadSchema,
  maxDuration: TASK_MAX_DURATION_SECONDS,
  run: /* @__PURE__ */ __name(async ({ userId, chatId, userText, model, isNewChat, turnstileToken }, { signal }) => {
    const base = process.env.CLAUDE_CODE_API_BASE ? normalizeBase(process.env.CLAUDE_CODE_API_BASE) : "";
    const token = process.env.CLAUDE_CODE_GATEWAY_TOKEN || "";
    if (!base) {
      throw new Error("Missing CLAUDE_CODE_API_BASE");
    }
    if (!token) {
      throw new Error("Missing CLAUDE_CODE_GATEWAY_TOKEN");
    }
    const headers = {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      "x-chat-id": chatId,
      "x-chat-new": isNewChat ? "true" : "false"
    };
    if (turnstileToken?.trim()) {
      const token2 = turnstileToken.trim();
      headers["x-turnstile-token"] = token2;
      headers["cf-turnstile-response"] = token2;
    }
    if (process.env.INTERNAL_TASK_KEY) {
      headers["x-internal-task-key"] = process.env.INTERNAL_TASK_KEY;
    }
    const requestBody = JSON.stringify({
      model: model || "gpt-5-codex",
      stream: true,
      messages: [{ role: "user", content: userText }]
    });
    const timeoutSignal = Number.isFinite(UPSTREAM_TIMEOUT_MS) && UPSTREAM_TIMEOUT_MS > 0 ? AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) : void 0;
    const requestSignal = mergeSignals([signal, timeoutSignal]);
    const retries = Number.isFinite(UPSTREAM_RETRIES) && UPSTREAM_RETRIES > 0 ? UPSTREAM_RETRIES : 0;
    let response = null;
    let lastNetworkError;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        response = await fetch(`${base}/v1/chat/completions`, {
          method: "POST",
          headers,
          body: requestBody,
          signal: requestSignal
        });
        break;
      } catch (error) {
        lastNetworkError = error;
        if (attempt >= retries || requestSignal?.aborted) {
          break;
        }
        await wait(Math.min(1e3 * 2 ** attempt, 3e3));
      }
    }
    if (!response) {
      throw new Error(buildFetchErrorMessage(base, lastNetworkError));
    }
    if (!response.ok) {
      const details = await response.text().catch(() => "");
      throw new Error(`Upstream failed (${response.status}): ${details || response.statusText}`);
    }
    const text = await streamUpstreamResponse(response);
    const artifacts = extractArtifactsFromText(text);
    return {
      userId,
      chatId,
      text,
      artifacts
    };
  }, "run")
});
export {
  fundChatTask
};
//# sourceMappingURL=fund-chat-task.mjs.map
