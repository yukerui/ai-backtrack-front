"use client";

import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "./elements/reasoning";
import type { ThinkingActivityPayload } from "@/lib/types";

type MessageReasoningProps = {
  activity?: ThinkingActivityPayload | null;
  isLoading: boolean;
  reasoning: string;
  reasoningId?: string;
};

function normalizeReasoningText(raw: string) {
  if (!raw) {
    return raw;
  }

  // Some upstream payloads may contain escaped newlines as literal "\n".
  if (!raw.includes("\n") && /\\r\\n|\\n/.test(raw)) {
    return raw.replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n");
  }

  return raw;
}

function extractSearchQuery(text: string) {
  const jsonQuery = text.match(/"q"\s*:\s*"([^"]+)"/i)?.[1]?.trim();
  if (jsonQuery) {
    return jsonQuery;
  }

  const queryField = text.match(/\bquery\b\s*[:=]\s*["']?([^"'\n]+)["']?/i)?.[1]?.trim();
  if (queryField) {
    return queryField;
  }

  return "";
}

function extractSkillName(text: string) {
  const dashName = text.match(/\b(skill-[a-z0-9_-]+)\b/i)?.[1]?.trim();
  if (dashName) {
    return dashName;
  }

  const skillField = text.match(/\bskill(?:s)?\b\s*[:=]\s*["']?([^"'\n]+)["']?/i)?.[1]?.trim();
  if (skillField) {
    return skillField;
  }

  return "";
}

function extractToolName(text: string) {
  const recipient = text.match(/\brecipient_name\b\s*[:=]\s*["']?([a-z0-9_.-]+)["']?/i)?.[1]?.trim();
  if (recipient) {
    return recipient;
  }

  const functionName = text.match(/\bfunctions\.([a-z0-9_.-]+)/i)?.[1]?.trim();
  if (functionName) {
    return `functions.${functionName}`;
  }

  const toolName = text.match(/\b(?:tool_name|name)\b\s*[:=]\s*["']?([a-z0-9_.-]+)["']?/i)?.[1]?.trim();
  if (toolName) {
    return toolName;
  }

  return "";
}

function detectStreamingStatus(
  reasoning: string,
  activity?: ThinkingActivityPayload | null,
  reasoningId?: string
) {
  const matchesReasoning =
    activity &&
    (!reasoningId || !activity.reasoningId || activity.reasoningId === reasoningId);
  if (matchesReasoning && activity.active) {
    return activity.label || "正在思考";
  }

  const recent = reasoning.slice(-800);

  if (/\bweb[_\s-]?search\b|search_query|image_query/i.test(recent)) {
    const query = extractSearchQuery(recent);
    return query ? `搜索 ${query} 中` : "搜索中";
  }

  if (/\bskill(?:s)?\b|SKILL\.md|skill-[a-z0-9_-]+/i.test(recent)) {
    const skillName = extractSkillName(recent);
    return skillName ? `调用技能 ${skillName} 中` : "调用技能中";
  }

  if (/\bmcp_tool_call\b|\btool_call\b|\brecipient_name\b|\bfunctions\.[a-z0-9_.-]+/i.test(recent)) {
    const toolName = extractToolName(recent);
    return toolName ? `调用工具 ${toolName} 中` : "调用工具中";
  }

  if (/\bcommand_execution\b/i.test(recent)) {
    return "执行命令中";
  }

  if (/\bfile_change\b|\b(?:Add|Update|Delete) File:\b/i.test(recent)) {
    return "修改文件中";
  }

  if (/\bplan_update\b/i.test(recent)) {
    return "更新计划中";
  }

  return "正在思考";
}

export function MessageReasoning({
  activity,
  isLoading,
  reasoning,
  reasoningId,
}: MessageReasoningProps) {
  const normalizedReasoning = normalizeReasoningText(reasoning);
  const statusLabel = isLoading
    ? detectStreamingStatus(normalizedReasoning, activity, reasoningId)
    : undefined;

  return (
    <Reasoning
      data-testid="message-reasoning"
      defaultOpen={false}
      isStreaming={isLoading}
    >
      <ReasoningTrigger showStreamingCursor={true} statusLabel={statusLabel} />
      <ReasoningContent>{normalizedReasoning}</ReasoningContent>
    </Reasoning>
  );
}
