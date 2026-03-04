import assert from "node:assert/strict";
import test from "node:test";
import { extractPlotlyChartsFromText } from "../lib/plotly";

function encodeFloat64(values: number[]) {
  return Buffer.from(new Float64Array(values).buffer).toString("base64");
}

test("decodes Plotly typed-array payload so descending-time chart is drawable", () => {
  const expectedY = [0.276, 0.198, 0.111];
  const raw = [
    "```plotly-json",
    JSON.stringify({
      id: "buy-return-159509",
      data: [
        {
          type: "scatter",
          mode: "lines",
          x: ["2026-03-03", "2026-03-02", "2026-03-01"],
          y: {
            dtype: "f8",
            bdata: encodeFloat64(expectedY),
          },
        },
      ],
      layout: { xaxis: { title: "买入日期（左新右旧）" } },
      config: { responsive: true },
    }),
    "```",
  ].join("\n");

  const { charts, text } = extractPlotlyChartsFromText(raw, "plotly");
  assert.equal(text, "");
  assert.equal(charts.length, 1);

  const trace = charts[0].data[0] as { x?: unknown; y?: unknown };
  assert.deepEqual(trace.x, ["2026-03-03", "2026-03-02", "2026-03-01"]);
  assert.deepEqual(trace.y, expectedY);
});
