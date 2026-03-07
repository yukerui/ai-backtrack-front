import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const plotlyCardSource = readFileSync(
  "/home/lovexl/ai-backtrack-front/components/plotly-chart-card.tsx",
  "utf8"
);

const messagesSource = readFileSync(
  "/home/lovexl/ai-backtrack-front/components/messages.tsx",
  "utf8"
);

test("plotly chart wrapper supports horizontal scrolling on narrow screens", () => {
  assert.match(
    plotlyCardSource,
    /overflow-x-auto/,
    "plotly chart container should enable horizontal scrolling"
  );
  assert.match(
    plotlyCardSource,
    /min-w-\[560px\]/,
    "plotly chart inner container should keep a readable minimum width"
  );
});

test("message list reserves bottom space for sticky composer on mobile", () => {
  assert.match(
    messagesSource,
    /pb-\[max\(7rem,env\(safe-area-inset-bottom\)\)\]/,
    "messages list should keep enough bottom padding to avoid content clipping"
  );
});
