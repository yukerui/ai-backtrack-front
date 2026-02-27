"use client";

import type { BacktestArtifactItem } from "@/lib/types";

function getButtonLabel(kind: BacktestArtifactItem["kind"]) {
  if (kind === "backtest-html") {
    return "查看图表";
  }
  if (kind === "csv") {
    return "下载CSV";
  }
  return "打开文件";
}

export function BacktestArtifactCard({ items }: { items: BacktestArtifactItem[] }) {
  if (!items.length) {
    return null;
  }

  return (
    <div className="w-full rounded-xl border bg-card p-3 sm:p-4">
      <div className="mb-3 font-medium text-sm">回测结果</div>
      <div className="flex flex-col gap-2">
        {items.map((item) => (
          <div
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-background/60 px-3 py-2"
            key={`${item.path}-${item.url}`}
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm">{item.title}</div>
              <div className="truncate text-muted-foreground text-xs">{item.path}</div>
            </div>
            <a
              className="shrink-0 rounded-md bg-primary px-3 py-1.5 text-primary-foreground text-xs hover:bg-primary/90"
              href={item.url}
              rel="noreferrer"
              target="_blank"
            >
              {getButtonLabel(item.kind)}
            </a>
          </div>
        ))}
      </div>
    </div>
  );
}
