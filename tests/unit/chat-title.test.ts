import assert from "node:assert/strict";
import test from "node:test";
import { getChatTitleFromUserText } from "../../lib/chat-title";

test("uses the first sentence as the chat title", () => {
  assert.equal(
    getChatTitleFromUserText("513100当前溢价是多少？顺便看下最近回测。"),
    "513100当前溢价是多少？"
  );
});

test("falls back to the first non-empty line when there is no sentence ending", () => {
  assert.equal(
    getChatTitleFromUserText("\n\n纳指ETF和标普ETF怎么配"),
    "纳指ETF和标普ETF怎么配"
  );
});

test("truncates long first sentences without calling a model", () => {
  assert.equal(
    getChatTitleFromUserText(
      "请帮我比较513100和513870在不同净值口径下的溢价变化，并说明为什么最近两个交易日的差值明显扩大以及对应的切换回测表现。"
    ),
    "请帮我比较513100和513870在不同净值口径下的溢价变化，并说明为什么最近两个交易日的差值..."
  );
});

test("returns the fallback title when the first message has no text", () => {
  assert.equal(getChatTitleFromUserText("   \n\t "), "New chat");
});
