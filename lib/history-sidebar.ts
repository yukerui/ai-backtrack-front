const GUEST_EMAIL_REGEX = /^guest-\d+$/;

type ChatHistoryLike = {
  chats: unknown[];
};

type ChatHistoryStateInput = {
  userEmail?: string | null;
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

export function isGuestUserEmail(email?: string | null) {
  return GUEST_EMAIL_REGEX.test(email ?? "");
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
  userEmail,
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
    return isGuestUserEmail(userEmail) ? "guest-empty" : "empty";
  }

  return "ready";
}
