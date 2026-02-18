"use client";

import { useEffect, useState } from "react";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "./elements/reasoning";

type MessageReasoningProps = {
  isLoading: boolean;
  reasoning: string;
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

export function MessageReasoning({
  isLoading,
  reasoning,
}: MessageReasoningProps) {
  const [hasBeenStreaming, setHasBeenStreaming] = useState(isLoading);
  const normalizedReasoning = normalizeReasoningText(reasoning);

  useEffect(() => {
    if (isLoading) {
      setHasBeenStreaming(true);
    }
  }, [isLoading]);

  return (
    <Reasoning
      data-testid="message-reasoning"
      defaultOpen={hasBeenStreaming}
      isStreaming={isLoading}
    >
      <ReasoningTrigger />
      <ReasoningContent>{normalizedReasoning}</ReasoningContent>
    </Reasoning>
  );
}
