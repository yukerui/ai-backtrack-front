import { titlePrompt } from "./prompts";

const DEFAULT_FUND_SUMMARY_TIMEOUT_MS = 5000;

export function resolveFundSummaryEndpoint(baseUrl: string) {
  const trimmed = String(baseUrl || "")
    .trim()
    .replace(/\/+$/, "");
  if (!trimmed) {
    return "";
  }
  if (trimmed.endsWith("/chat/completions")) {
    return trimmed;
  }
  if (trimmed.endsWith("/v1")) {
    return `${trimmed}/chat/completions`;
  }
  return `${trimmed}/v1/chat/completions`;
}

export function createFundSummaryHeaders(token: string) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };

  const normalizedToken = String(token || "").trim();
  if (normalizedToken) {
    headers.authorization = `Bearer ${normalizedToken}`;
  }

  return headers;
}

export function extractTextFromMessageContent(content: unknown) {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }
        if (part && typeof part === "object") {
          const candidate = part as {
            text?: unknown;
            input_text?: unknown;
            content?: unknown;
          };
          if (typeof candidate.text === "string") {
            return candidate.text;
          }
          if (typeof candidate.input_text === "string") {
            return candidate.input_text;
          }
          if (typeof candidate.content === "string") {
            return candidate.content;
          }
        }
        return "";
      })
      .join("\n");
  }

  if (content && typeof content === "object") {
    const candidate = content as { text?: unknown };
    if (typeof candidate.text === "string") {
      return candidate.text;
    }
  }

  return "";
}

export function normalizeGeneratedTitle(text: string) {
  return String(text || "")
    .replace(/^```(?:\w+)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .replace(/^Title:\s*/i, "")
    .replace(/^[#*"\s]+/, "")
    .split("\n")[0]
    .replace(/["]+$/, "")
    .trim();
}

export function readFundSummaryConfig(
  env: Record<string, string | undefined> = process.env
) {
  return {
    base: env.FUND_SUMMARY_BASE?.trim() || "",
    model: env.FUND_SUMMARY_MODEL?.trim() || "",
    token: env.FUND_SUMMARY_TOKEN?.trim() || "",
  };
}

export async function generateTitleWithFundSummaryModel(userText: string) {
  const { base, model, token } = readFundSummaryConfig();
  const endpoint = resolveFundSummaryEndpoint(base);

  if (!endpoint || !model || !token) {
    throw new Error("Missing FUND_SUMMARY_* config");
  }

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    DEFAULT_FUND_SUMMARY_TIMEOUT_MS
  );

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: createFundSummaryHeaders(token),
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 120,
        stream: false,
        messages: [
          {
            role: "system",
            content: titlePrompt,
          },
          {
            role: "user",
            content: userText,
          },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const raw = await response.text().catch(() => "");
      throw new Error(
        `FUND_SUMMARY request failed (${response.status}): ${raw || response.statusText}`
      );
    }

    const data = await response.json();
    const content = extractTextFromMessageContent(
      data?.choices?.[0]?.message?.content
    );
    return normalizeGeneratedTitle(content);
  } finally {
    clearTimeout(timer);
  }
}
