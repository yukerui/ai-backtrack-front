import assert from "node:assert/strict";
import test from "node:test";
import {
  getChatHistoryState,
  hasEmptyChatHistory,
  isGuestUserEmail,
} from "../../lib/history-sidebar";

test("hasEmptyChatHistory requires at least one page", () => {
  assert.equal(hasEmptyChatHistory([]), false);
  assert.equal(hasEmptyChatHistory([{ chats: [] }]), true);
});

test("getChatHistoryState keeps fetch errors out of the empty state", () => {
  assert.equal(
    getChatHistoryState({
      userEmail: "guest-1",
      isLoading: false,
      hasError: true,
      pages: [],
    }),
    "error"
  );
});

test("getChatHistoryState returns guest-empty for guest sessions", () => {
  assert.equal(
    getChatHistoryState({
      userEmail: "guest-1",
      isLoading: false,
      hasError: false,
      pages: [{ chats: [] }],
    }),
    "guest-empty"
  );
  assert.equal(isGuestUserEmail("guest-1"), true);
});

test("getChatHistoryState returns empty for regular users", () => {
  assert.equal(
    getChatHistoryState({
      userEmail: "user@example.com",
      isLoading: false,
      hasError: false,
      pages: [{ chats: [] }],
    }),
    "empty"
  );
});

test("getChatHistoryState returns ready when there is chat data", () => {
  assert.equal(
    getChatHistoryState({
      userEmail: "user@example.com",
      isLoading: false,
      hasError: false,
      pages: [{ chats: [{ id: "1" }] }],
    }),
    "ready"
  );
});
