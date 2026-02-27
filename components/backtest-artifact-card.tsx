"use client";

import type { BacktestArtifactItem } from "@/lib/types";

function getButtonLabel(kind: BacktestArtifactItem["kind"]) {
  if (kind === "backtest-html") {
    return "新窗口打开";
  }
  if (kind === "csv") {
    return "下载CSV";
  }
  return "打开文件";
}

export function BacktestArtifactCard({
  items,
}: {
  items: BacktestArtifactItem[];
}) {
  if (!items.length) {
    return null;
  }

  return (
    <div className="w-full rounded-xl border bg-card p-3 sm:p-4">
      <div className="mb-3 font-medium text-sm">回测结果</div>
      <div className="flex flex-col gap-2">
        {items.map((item) => (
          <div
            className="rounded-lg border bg-background/60"
            key={`${item.path}-${item.url}`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm">{item.title}</div>
                <div className="truncate text-muted-foreground text-xs">
                  {item.path}
                </div>
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

            {item.kind === "backtest-html" ? (
              <div className="px-3 pb-3">
                <iframe
                  className="h-[380px] w-full rounded-md border bg-white md:h-[520px]"
                  loading="lazy"
                  sandbox="allow-downloads allow-forms allow-modals allow-popups allow-same-origin allow-scripts"
                  src={item.url}
                  title={item.title}
                />
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
