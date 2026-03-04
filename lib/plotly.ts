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
const TRACE_SERIES_KEYS = ["x", "y", "z", "open", "high", "low", "close"] as const;

type TypedArrayCtor =
  | Float64ArrayConstructor
  | Float32ArrayConstructor
  | Int32ArrayConstructor
  | Uint32ArrayConstructor
  | Int16ArrayConstructor
  | Uint16ArrayConstructor
  | Int8ArrayConstructor
  | Uint8ArrayConstructor;

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

function normalizeDtype(dtype: string): string {
  return dtype.trim().toLowerCase().replace(/^</, "");
}

function getTypedArrayCtor(dtype: string): TypedArrayCtor | null {
  switch (normalizeDtype(dtype)) {
    case "f8":
    case "float64":
      return Float64Array;
    case "f4":
    case "float32":
      return Float32Array;
    case "i4":
    case "int32":
      return Int32Array;
    case "u4":
    case "uint32":
      return Uint32Array;
    case "i2":
    case "int16":
      return Int16Array;
    case "u2":
    case "uint16":
      return Uint16Array;
    case "i1":
    case "int8":
      return Int8Array;
    case "u1":
    case "uint8":
      return Uint8Array;
    default:
      return null;
  }
}

function decodeTypedArrayPayload(value: unknown): unknown {
  if (!isObject(value)) {
    return value;
  }
  const dtype = typeof value.dtype === "string" ? value.dtype : "";
  const bdata = typeof value.bdata === "string" ? value.bdata : "";
  if (!dtype || !bdata) {
    return value;
  }
  const ctor = getTypedArrayCtor(dtype);
  if (!ctor) {
    return value;
  }

  try {
    const bytes = Buffer.from(bdata, "base64");
    if (bytes.byteLength === 0 || bytes.byteLength % ctor.BYTES_PER_ELEMENT !== 0) {
      return value;
    }
    const raw = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    return Array.from(new ctor(raw));
  } catch {
    return value;
  }
}

function normalizeTraceSeries(trace: JsonObject): JsonObject {
  const normalized = safeJsonClone(trace);
  for (const key of TRACE_SERIES_KEYS) {
    if (key in normalized) {
      normalized[key] = decodeTypedArrayPayload(normalized[key]);
    }
  }
  return normalized;
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
  for (const key of TRACE_SERIES_KEYS) {
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
    ? candidate.data
        .filter((trace) => isObject(trace))
        .map((trace) => normalizeTraceSeries(trace))
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
    let hasExplicitChartField = false;
    if (Array.isArray(input.plotlyCharts)) {
      candidates.push(...input.plotlyCharts);
      hasExplicitChartField = true;
    }
    if (isObject(input.chart)) {
      candidates.push(input.chart);
      hasExplicitChartField = true;
    }
    if (isObject(input.plotly)) {
      candidates.push(input.plotly);
      hasExplicitChartField = true;
    }
    if (!hasExplicitChartField) {
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
