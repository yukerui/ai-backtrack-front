import { randomUUID } from "node:crypto";
import { schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";
import {
  encodeFundChatRealtimeChunk,
  fundChatRealtimeStream,
  type FundChatRealtimeChunk,
} from "./streams";

const payloadSchema = z.object({
  userId: z.string(),
  chatId: z.string(),
  userText: z.string().min(1),
  model: z.string().optional(),
  isNewChat: z.boolean().optional(),
  turnstileToken: z.string().optional(),
  policyPrechecked: z.boolean().optional(),
});

const TASK_MAX_DURATION_SECONDS = Number.parseInt(
  process.env.TRIGGER_FUND_CHAT_MAX_DURATION_SECONDS || "1800",
  10
);
const UPSTREAM_TIMEOUT_MS = Number.parseInt(
  process.env.TRIGGER_UPSTREAM_TIMEOUT_MS || "1800000",
  10
);
const ENFORCE_UPSTREAM_TIMEOUT =
  (process.env.TRIGGER_ENFORCE_UPSTREAM_TIMEOUT || "false").toLowerCase() === "true";
const UPSTREAM_RETRIES = Number.parseInt(
  process.env.TRIGGER_UPSTREAM_RETRIES || "1",
  10
);
const ARTIFACT_PATH_REGEX = /(?:backend\/|front\/)?artifacts\/[A-Za-z0-9._/-]+\.(?:html|csv)/g;
const TRIGGER_TASK_DEBUG_VERBOSE =
  (process.env.TRIGGER_TASK_DEBUG_VERBOSE || "false").toLowerCase() === "true";

function normalizeBase(rawBase: string) {
  const trimmed = rawBase.replace(/\/+$/, "");
  if (trimmed.endsWith("/v1/chat/completions")) {
    return trimmed.replace(/\/v1\/chat\/completions$/, "");
  }
  return trimmed;
}

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function taskDebug(event: string, payload?: Record<string, unknown>) {
  if (!TRIGGER_TASK_DEBUG_VERBOSE) {
    return;
  }
  if (payload) {
    console.log(`[fund-chat-task][debug] ${event}`, payload);
    return;
  }
  console.log(`[fund-chat-task][debug] ${event}`);
}

function mergeSignals(signals: Array<AbortSignal | null | undefined>) {
  const active = signals.filter(Boolean) as AbortSignal[];
  if (active.length === 0) {
    return undefined;
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

function buildFetchErrorMessage(base: string, error: unknown) {
  const err = error as
    | (Error & { code?: string; cause?: { code?: string; message?: string } })
    | undefined;
  const code = err?.cause?.code || err?.code || "";
  const message = err?.cause?.message || err?.message || String(error);
  const prefix = code ? `${code}: ` : "";
  return `Upstream fetch failed (${base}/v1/chat/completions): ${prefix}${message}`;
}

type UpstreamDeltaPayload = {
  choices?: Array<{
    delta?: UpstreamChoiceDelta;
  }>;
};

type UpstreamChoiceDelta = {
  content?: string | Array<{ text?: string }>;
  reasoning?: string;
};

function extractSsePayload(eventBlock: string) {
  const lines = eventBlock.split(/\r?\n/);
  const dataLines = lines
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim());
  if (dataLines.length === 0) {
    return "";
  }
  return dataLines.join("\n").trim();
}

function extractTextDelta(delta: UpstreamChoiceDelta | undefined) {
  const content = delta?.content;
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((part) => (typeof part?.text === "string" ? part.text : ""))
    .join("");
}

function extractReasoningDelta(delta: UpstreamChoiceDelta | undefined) {
  return typeof delta?.reasoning === "string" ? delta.reasoning : "";
}

function extractArtifactsFromText(text: string) {
  return Array.from(new Set((text.match(ARTIFACT_PATH_REGEX) || []) as string[]));
}

async function appendRealtimeChunk(chunk: FundChatRealtimeChunk) {
  await fundChatRealtimeStream.append(encodeFundChatRealtimeChunk(chunk));
}

async function streamUpstreamResponse(response: Response) {
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

  const consumeEvent = async (eventBlock: string) => {
    const payload = extractSsePayload(eventBlock);
    if (!payload) {
      return;
    }
    if (payload === "[DONE]") {
      sawDone = true;
      taskDebug("sse_done_marker_received");
      return;
    }

    let parsed: UpstreamDeltaPayload | null = null;
    try {
      parsed = JSON.parse(payload) as UpstreamDeltaPayload;
    } catch {
      return;
    }

    const delta = parsed?.choices?.[0]?.delta;
    const reasoningDelta = extractReasoningDelta(delta);
    if (reasoningDelta) {
      if (!reasoningStarted) {
        await appendRealtimeChunk({
          type: "reasoning-start",
          id: reasoningPartId,
        });
        reasoningStarted = true;
      }
      await appendRealtimeChunk({
        type: "reasoning-delta",
        id: reasoningPartId,
        delta: reasoningDelta,
      });
      taskDebug("reasoning_delta", { deltaLength: reasoningDelta.length });
    }

    const textDelta = extractTextDelta(delta);
    if (textDelta) {
      if (!textStarted) {
        await appendRealtimeChunk({
          type: "text-start",
          id: textPartId,
        });
        textStarted = true;
      }
      await appendRealtimeChunk({
        type: "text-delta",
        id: textPartId,
        delta: textDelta,
      });
      text += textDelta;
      taskDebug("text_delta", { deltaLength: textDelta.length, accumulatedTextLength: text.length });
    }
  };

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
      id: reasoningPartId,
    });
  }
  if (textStarted) {
    await appendRealtimeChunk({
      type: "text-end",
      id: textPartId,
    });
  }

  return text;
}

export const fundChatTask = schemaTask({
  id: "fund-chat-task",
  schema: payloadSchema,
  maxDuration: TASK_MAX_DURATION_SECONDS,
  run: async (
    { userId, chatId, userText, model, isNewChat, turnstileToken, policyPrechecked },
    { signal }
  ) => {
    taskDebug("task_started", {
      userId,
      chatId,
      model: model || "gpt-5.3-codex",
      isNewChat: Boolean(isNewChat),
      hasTurnstileToken: Boolean(turnstileToken?.trim()),
      policyPrechecked: Boolean(policyPrechecked),
    });
    const base = process.env.CLAUDE_CODE_API_BASE
      ? normalizeBase(process.env.CLAUDE_CODE_API_BASE)
      : "";
    const token = process.env.CLAUDE_CODE_GATEWAY_TOKEN || "";
    if (!base) {
      throw new Error("Missing CLAUDE_CODE_API_BASE");
    }
    if (!token) {
      throw new Error("Missing CLAUDE_CODE_GATEWAY_TOKEN");
    }

    const headers: Record<string, string> = {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      "x-chat-id": chatId,
      "x-chat-new": isNewChat ? "true" : "false",
    };
    if (turnstileToken?.trim()) {
      const token = turnstileToken.trim();
      headers["x-turnstile-token"] = token;
      headers["cf-turnstile-response"] = token;
    }
    if (process.env.INTERNAL_TASK_KEY) {
      headers["x-internal-task-key"] = process.env.INTERNAL_TASK_KEY;
      if (policyPrechecked) {
        headers["x-policy-prechecked"] = "1";
      }
    }

    const requestBody = JSON.stringify({
      model: model || "gpt-5.3-codex",
      stream: true,
      messages: [{ role: "user", content: userText }],
    });
    const timeoutSignal =
      ENFORCE_UPSTREAM_TIMEOUT &&
      Number.isFinite(UPSTREAM_TIMEOUT_MS) &&
      UPSTREAM_TIMEOUT_MS > 0
        ? AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)
        : undefined;
    const requestSignal = mergeSignals([signal, timeoutSignal]);
    const retries = Number.isFinite(UPSTREAM_RETRIES) && UPSTREAM_RETRIES > 0 ? UPSTREAM_RETRIES : 0;
    taskDebug("upstream_timeout_config", {
      enforceUpstreamTimeout: ENFORCE_UPSTREAM_TIMEOUT,
      upstreamTimeoutMs: UPSTREAM_TIMEOUT_MS,
      triggerTaskMaxDurationSeconds: TASK_MAX_DURATION_SECONDS,
    });

    let response: Response | null = null;
    let lastNetworkError: unknown;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        taskDebug("upstream_request_attempt", { attempt: attempt + 1, totalAttempts: retries + 1 });
        response = await fetch(`${base}/v1/chat/completions`, {
          method: "POST",
          headers,
          body: requestBody,
          signal: requestSignal,
        });
        taskDebug("upstream_response_received", { status: response.status, ok: response.ok });
        break;
      } catch (error) {
        lastNetworkError = error;
        taskDebug("upstream_request_error", {
          attempt: attempt + 1,
          message: error instanceof Error ? error.message : String(error),
          aborted: Boolean(requestSignal?.aborted),
        });
        if (attempt >= retries || requestSignal?.aborted) {
          break;
        }
        await wait(Math.min(1000 * 2 ** attempt, 3000));
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
    taskDebug("task_completed", {
      textLength: text.length,
      artifactsCount: artifacts.length,
    });

    return {
      userId,
      chatId,
      text,
      artifacts,
    };
  },
});
