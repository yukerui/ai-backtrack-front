"use client";

import type { UseChatHelpers } from "@ai-sdk/react";
import { motion } from "framer-motion";
import { memo } from "react";
import type { ChatMessage } from "@/lib/types";
import { Suggestion } from "./elements/suggestion";
import type { VisibilityType } from "./visibility-selector";

type SuggestedActionsProps = {
  chatId: string;
  sendMessage: UseChatHelpers<ChatMessage>["sendMessage"];
  selectedVisibilityType: VisibilityType;
  canSend?: boolean;
  onRequireVerification?: () => void;
};

function PureSuggestedActions({
  chatId,
  sendMessage,
  canSend = true,
  onRequireVerification,
}: SuggestedActionsProps) {
  const suggestedActions = [
    "对比下513100和159501过去两年它的收益",
    "513100当前的溢价是多少",
    "我要在513100和513870之间切换，当513100与513870溢价差小于1时切换至513100，在溢价差大于3时切换至513870，回测下这个策略过去两年的收益",
    "我现在持有513100，我想在它与其他纳指ETF的溢价超过3%时切换，现在的情况下可以切换到哪个上面去"
  ];

  return (
    <div
      className="grid w-full gap-2 sm:grid-cols-2"
      data-testid="suggested-actions"
    >
      {suggestedActions.map((suggestedAction, index) => (
        <motion.div
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          initial={{ opacity: 0, y: 20 }}
          key={suggestedAction}
          transition={{ delay: 0.05 * index }}
        >
          <Suggestion
            className="h-auto w-full whitespace-normal p-3 text-left"
            onClick={(suggestion) => {
              if (!canSend) {
                onRequireVerification?.();
                return;
              }
              window.history.pushState({}, "", `/chat/${chatId}`);
              sendMessage({
                role: "user",
                parts: [{ type: "text", text: suggestion }],
              });
            }}
            suggestion={suggestedAction}
          >
            {suggestedAction}
          </Suggestion>
        </motion.div>
      ))}
    </div>
  );
}

export const SuggestedActions = memo(
  PureSuggestedActions,
  (prevProps, nextProps) => {
    if (prevProps.chatId !== nextProps.chatId) {
      return false;
    }
    if (prevProps.selectedVisibilityType !== nextProps.selectedVisibilityType) {
      return false;
    }
    if (prevProps.canSend !== nextProps.canSend) {
      return false;
    }

    return true;
  }
);
