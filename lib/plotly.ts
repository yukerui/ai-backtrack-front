type JsonObject = Record<string, unknown>;

export type PlotlyChartPayload = {
  id: string;
  title?: string;
  data: JsonObject[];
  layout?: JsonObject;
  config?: JsonObject;
  meta?: {
    source?: string;
    generatedAt?: string;
    note?: string;
  };
};

const PLOTLY_BLOCK_REGEX = /```(?:plotly-json|plotly|json)\s*([\s\S]*?)```/gi;
const MAX_TRACES = 24;
const MAX_TRACE_POINTS = 12000;
const MAX_TOTAL_POINTS = 120000;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeJsonClone<T>(value: T): T {
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    return value;
  }
}

function normalizeTitle(value: unknown, layout?: JsonObject): string {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (!layout) {
    return "";
  }
  const title = layout.title;
  if (typeof title === "string" && title.trim()) {
    return title.trim();
  }
  if (isObject(title) && typeof title.text === "string" && title.text.trim()) {
    return title.text.trim();
  }
  return "";
}

function getTracePointCount(trace: JsonObject): number {
  for (const key of ["x", "y", "z", "open", "high", "low", "close"]) {
    const value = trace[key];
    if (Array.isArray(value)) {
      return value.length;
    }
  }
  return 0;
}

function sanitizeLayout(layout: JsonObject | undefined): JsonObject | undefined {
  if (!layout) {
    return undefined;
  }
  const cloned = safeJsonClone(layout);
  if (!isObject(cloned)) {
    return undefined;
  }

  // Drop potentially unsafe image sources from layout.
  if (Array.isArray(cloned.images)) {
    const filtered = cloned.images
      .filter((entry) => isObject(entry))
      .map((entry) => {
        const next = { ...entry };
        if (typeof next.source === "string") {
          const source = next.source.trim().toLowerCase();
          if (
            source.startsWith("javascript:") ||
            source.startsWith("data:") ||
            source.startsWith("vbscript:")
          ) {
            delete next.source;
          }
        }
        return next;
      });
    cloned.images = filtered;
  }

  return cloned;
}

function sanitizeConfig(config: JsonObject | undefined): JsonObject {
  const base = isObject(config) ? safeJsonClone(config) : {};
  return {
    responsive: true,
    displaylogo: false,
    ...base,
  };
}

function normalizeChart(
  candidate: unknown,
  index: number,
  idPrefix: string
): PlotlyChartPayload | null {
  if (!isObject(candidate)) {
    return null;
  }

  const data = Array.isArray(candidate.data)
    ? candidate.data.filter((trace) => isObject(trace)).map((trace) => safeJsonClone(trace))
    : [];
  if (!data.length || data.length > MAX_TRACES) {
    return null;
  }

  let totalPoints = 0;
  for (const trace of data) {
    const points = getTracePointCount(trace);
    if (points > MAX_TRACE_POINTS) {
      return null;
    }
    totalPoints += points;
    if (totalPoints > MAX_TOTAL_POINTS) {
      return null;
    }
  }

  const layout = sanitizeLayout(isObject(candidate.layout) ? candidate.layout : undefined);
  const config = sanitizeConfig(isObject(candidate.config) ? candidate.config : undefined);
  const title = normalizeTitle(candidate.title, layout);
  const chartId =
    typeof candidate.id === "string" && candidate.id.trim()
      ? candidate.id.trim()
      : `${idPrefix}-${index + 1}`;

  return {
    id: chartId,
    ...(title ? { title } : {}),
    data,
    ...(layout ? { layout } : {}),
    config,
  };
}

function normalizeChartCandidates(input: unknown, idPrefix: string): PlotlyChartPayload[] {
  if (!input) {
    return [];
  }

  const candidates: unknown[] = [];
  if (Array.isArray(input)) {
    candidates.push(...input);
  } else if (isObject(input)) {
    if (Array.isArray(input.plotlyCharts)) {
      candidates.push(...input.plotlyCharts);
    } else if (isObject(input.chart)) {
      candidates.push(input.chart);
    } else {
      candidates.push(input);
    }
  }

  const charts: PlotlyChartPayload[] = [];
  for (let i = 0; i < candidates.length; i += 1) {
    const normalized = normalizeChart(candidates[i], i, idPrefix);
    if (normalized) {
      charts.push(normalized);
    }
  }

  return charts;
}

export function normalizePlotlyCharts(input: unknown, idPrefix = "plotly"): PlotlyChartPayload[] {
  return normalizeChartCandidates(input, idPrefix);
}

export function extractPlotlyChartsFromText(
  rawText: string,
  idPrefix = "plotly"
): { text: string; charts: PlotlyChartPayload[] } {
  const input = String(rawText || "");
  if (!input.trim()) {
    return { text: input, charts: [] };
  }

  const charts: PlotlyChartPayload[] = [];
  let cleaned = input;
  let blockIndex = 0;

  cleaned = cleaned.replace(PLOTLY_BLOCK_REGEX, (fullMatch, blockBody: string) => {
    const body = String(blockBody || "").trim();
    if (!body) {
      return fullMatch;
    }
    try {
      const parsed = JSON.parse(body) as unknown;
      const extracted = normalizeChartCandidates(parsed, `${idPrefix}-block${blockIndex + 1}`);
      blockIndex += 1;
      if (!extracted.length) {
        return fullMatch;
      }
      charts.push(...extracted);
      return "";
    } catch {
      return fullMatch;
    }
  });

  if (charts.length === 0) {
    const trimmed = input.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        const extracted = normalizeChartCandidates(parsed, idPrefix);
        if (extracted.length > 0) {
          return { text: "", charts: extracted };
        }
      } catch {
        // ignore non-JSON text
      }
    }
  }

  return { text: cleaned.trim(), charts };
}
