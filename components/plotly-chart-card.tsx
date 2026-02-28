"use client";

import dynamic from "next/dynamic";
import type { CSSProperties, ComponentType } from "react";
import type { PlotlyChartPayload } from "@/lib/types";

type PlotComponentProps = {
  data: unknown[];
  layout?: Record<string, unknown>;
  config?: Record<string, unknown>;
  style?: CSSProperties;
  useResizeHandler?: boolean;
};

const Plot = dynamic(async () => {
  const createPlotlyComponent = (await import("react-plotly.js/factory")).default;
  const plotlyModule = await import("plotly.js-basic-dist-min");
  const plotly = (plotlyModule as { default?: unknown }).default || plotlyModule;
  return createPlotlyComponent(plotly as any) as ComponentType<PlotComponentProps>;
}, { ssr: false }) as ComponentType<PlotComponentProps>;

function normalizeLayout(chart: PlotlyChartPayload) {
  const layout = chart.layout && typeof chart.layout === "object" ? chart.layout : {};
  const normalizedLayout = {
    autosize: true,
    hovermode: "x unified",
    margin: { l: 48, r: 20, t: 48, b: 48 },
    ...layout,
  } as Record<string, unknown>;
  // Keep title only in card header; hide Plotly's in-canvas title.
  delete normalizedLayout.title;
  return normalizedLayout;
}

function normalizeConfig(chart: PlotlyChartPayload) {
  const config = chart.config && typeof chart.config === "object" ? chart.config : {};
  return {
    responsive: true,
    displaylogo: false,
    scrollZoom: true,
    ...config,
  } as Record<string, unknown>;
}

export function PlotlyChartCard({ chart }: { chart: PlotlyChartPayload }) {
  if (!chart?.data?.length) {
    return null;
  }

  return (
    <div className="w-full rounded-xl border bg-card p-3 sm:p-4">
      <div className="mb-2 font-medium text-sm">{chart.title || "交互图表"}</div>
      <div className="h-[340px] w-full md:h-[460px]">
        <Plot
          config={normalizeConfig(chart)}
          data={chart.data}
          layout={normalizeLayout(chart)}
          style={{ width: "100%", height: "100%" }}
          useResizeHandler={true}
        />
      </div>
    </div>
  );
}
