"use client";

import type { ComponentProps } from "react";
import { Streamdown, defaultRemarkPlugins } from "streamdown";
import { cn } from "@/lib/utils";

type ResponseProps = ComponentProps<typeof Streamdown>;

const LATEX_SIGNAL_REGEX = /\\[a-zA-Z]+|[_^]/;
const FENCED_CODE_BLOCK_REGEX = /```[\s\S]*?```/g;
const ESCAPED_BLOCK_MATH_REGEX = /\\\[\s*([\s\S]*?)\s*\\\]/g;

const STREAMDOWN_REMARK_PLUGINS = [
  defaultRemarkPlugins.gfm,
  defaultRemarkPlugins.cjkAutolinkBoundary,
  [
    Array.isArray(defaultRemarkPlugins.math)
      ? defaultRemarkPlugins.math[0]
      : defaultRemarkPlugins.math,
    {
      ...(Array.isArray(defaultRemarkPlugins.math) &&
      typeof defaultRemarkPlugins.math[1] === "object" &&
      defaultRemarkPlugins.math[1] !== null
        ? (defaultRemarkPlugins.math[1] as Record<string, unknown>)
        : {}),
      singleDollarTextMath: true,
    },
  ],
  defaultRemarkPlugins.cjkFriendly,
  defaultRemarkPlugins.cjkFriendlyGfmStrikethrough,
].filter(Boolean) as NonNullable<ResponseProps["remarkPlugins"]>;

function normalizeBracketMathLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) {
    return line;
  }

  const inner = trimmed.slice(1, -1).trim();
  if (!inner || !LATEX_SIGNAL_REGEX.test(inner)) {
    return line;
  }

  const leading = line.match(/^\s*/)?.[0] || "";
  return `${leading}$$\n${leading}${inner}\n${leading}$$`;
}

function normalizeMathInSegment(segment: string) {
  const withEscapedBlocks = segment.replace(
    ESCAPED_BLOCK_MATH_REGEX,
    (_matched, inner: string) => `$$\n${inner.trim()}\n$$`
  );

  return withEscapedBlocks
    .split("\n")
    .map((line) => normalizeBracketMathLine(line))
    .join("\n");
}

function normalizeMathDelimiters(markdownText: string) {
  if (
    !markdownText ||
    (!markdownText.includes("\\[") && !markdownText.includes("["))
  ) {
    return markdownText;
  }

  let result = "";
  let lastIndex = 0;
  let match: RegExpExecArray | null =
    FENCED_CODE_BLOCK_REGEX.exec(markdownText);

  while (match) {
    const blockStart = match.index;
    const blockText = match[0];

    result += normalizeMathInSegment(markdownText.slice(lastIndex, blockStart));
    result += blockText;
    lastIndex = blockStart + blockText.length;
    match = FENCED_CODE_BLOCK_REGEX.exec(markdownText);
  }

  result += normalizeMathInSegment(markdownText.slice(lastIndex));
  return result;
}

export function Response({ className, children, ...props }: ResponseProps) {
  const normalizedChildren =
    typeof children === "string" ? normalizeMathDelimiters(children) : children;

  return (
    <Streamdown
      className={cn(
        "size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_code]:whitespace-pre-wrap [&_code]:break-words [&_pre]:max-w-full [&_pre]:overflow-x-auto",
        className
      )}
      remarkPlugins={STREAMDOWN_REMARK_PLUGINS}
      {...props}
    >
      {normalizedChildren}
    </Streamdown>
  );
}
