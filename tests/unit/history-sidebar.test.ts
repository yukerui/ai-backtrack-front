import assert from "node:assert/strict";
import test from "node:test";
import {
  getChatHistoryState,
  hasEmptyChatHistory,
  isGuestUserType,
} from "../../lib/history-sidebar";

test("hasEmptyChatHistory requires at least one page", () => {
  assert.equal(hasEmptyChatHistory([]), false);
  assert.equal(hasEmptyChatHistory([{ chats: [] }]), true);
});

test("getChatHistoryState keeps fetch errors out of the empty state", () => {
  assert.equal(
    getChatHistoryState({
      userType: "guest",
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
      userType: "guest",
      isLoading: false,
      hasError: false,
      pages: [{ chats: [] }],
    }),
    "guest-empty"
  );
  assert.equal(isGuestUserType("guest"), true);
});

test("getChatHistoryState returns empty for regular users", () => {
  assert.equal(
    getChatHistoryState({
      userType: "regular",
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
      userType: "regular",
      isLoading: false,
      hasError: false,
      pages: [{ chats: [{ id: "1" }] }],
    }),
    "ready"
  );
});

test("getChatHistoryState treats missing user type as a regular empty state", () => {
  assert.equal(
    getChatHistoryState({
      isLoading: false,
      hasError: false,
      pages: [{ chats: [] }],
    }),
    "empty"
  );
});
