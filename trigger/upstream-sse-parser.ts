export type UpstreamDeltaPayload = {
  choices?: Array<{
    delta?: UpstreamChoiceDelta;
  }>;
  error?: {
    message?: string;
  };
};

export type UpstreamChoiceDelta = {
  content?: string | Array<{ text?: string }>;
  reasoning?: string;
  reasoning_summary?: string;
  activity?: unknown;
};

function getDataLines(eventBlock: string) {
  const lines = String(eventBlock || "").split(/\r?\n/);
  const dataLines: string[] = [];

  for (const line of lines) {
    if (!line.startsWith("data:")) {
      continue;
    }
    let value = line.slice(5);
    if (value.startsWith(" ")) {
      // SSE allows an optional single leading space after ":".
      value = value.slice(1);
    }
    dataLines.push(value);
  }

  return dataLines;
}

export function extractSsePayload(eventBlock: string) {
  const dataLines = getDataLines(eventBlock);
  if (dataLines.length === 0) {
    return "";
  }
  return dataLines.join("\n").trim();
}

export function parseUpstreamDeltaPayload(eventBlock: string): UpstreamDeltaPayload | null {
  const dataLines = getDataLines(eventBlock);
  if (dataLines.length === 0) {
    return null;
  }

  const joinedWithNewline = dataLines.join("\n").trim();
  if (!joinedWithNewline || joinedWithNewline === "[DONE]") {
    return null;
  }

  const candidates = [joinedWithNewline];
  if (dataLines.length > 1) {
    const joinedWithoutNewline = dataLines.join("").trim();
    if (joinedWithoutNewline && joinedWithoutNewline !== joinedWithNewline) {
      candidates.push(joinedWithoutNewline);
    }
  }

  for (const payload of candidates) {
    try {
      return JSON.parse(payload) as UpstreamDeltaPayload;
    } catch {
      // try next candidate
    }
  }

  return null;
}

export function extractTextDelta(delta: UpstreamChoiceDelta | undefined) {
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

export function extractReasoningDelta(delta: UpstreamChoiceDelta | undefined) {
  return typeof delta?.reasoning === "string" ? delta.reasoning : "";
}

export function extractReasoningSummaryDelta(delta: UpstreamChoiceDelta | undefined) {
  return typeof delta?.reasoning_summary === "string"
    ? delta.reasoning_summary
    : "";
}
