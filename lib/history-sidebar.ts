type ChatHistoryLike = {
  chats: unknown[];
};

export type ChatHistoryUserType = "guest" | "regular";

type ChatHistoryStateInput = {
  userType?: ChatHistoryUserType | null;
  isLoading: boolean;
  hasError: boolean;
  pages?: ChatHistoryLike[];
};

export type ChatHistoryState =
  | "loading"
  | "error"
  | "empty"
  | "guest-empty"
  | "ready";

export function isGuestUserType(userType?: ChatHistoryUserType | null) {
  return userType === "guest";
}

export function hasEmptyChatHistory(pages?: ChatHistoryLike[]) {
  return Boolean(
    pages &&
      pages.length > 0 &&
      pages.every(
        (page) => Array.isArray(page.chats) && page.chats.length === 0
      )
  );
}

export function getChatHistoryState({
  userType,
  isLoading,
  hasError,
  pages,
}: ChatHistoryStateInput): ChatHistoryState {
  if (isLoading) {
    return "loading";
  }

  if (hasError) {
    return "error";
  }

  if (hasEmptyChatHistory(pages)) {
    return isGuestUserType(userType) ? "guest-empty" : "empty";
  }

  return "ready";
}
