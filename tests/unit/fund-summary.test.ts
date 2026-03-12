import assert from "node:assert/strict";
import test from "node:test";
import {
  createFundSummaryHeaders,
  extractTextFromMessageContent,
  normalizeGeneratedTitle,
  readFundSummaryConfig,
  resolveFundSummaryEndpoint,
} from "../../lib/ai/fund-summary";

test("resolveFundSummaryEndpoint normalizes OpenAI-compatible bases", () => {
  assert.equal(
    resolveFundSummaryEndpoint("https://example.com"),
    "https://example.com/v1/chat/completions"
  );
  assert.equal(
    resolveFundSummaryEndpoint("https://example.com/v1"),
    "https://example.com/v1/chat/completions"
  );
  assert.equal(
    resolveFundSummaryEndpoint("https://example.com/v1/chat/completions"),
    "https://example.com/v1/chat/completions"
  );
});

test("createFundSummaryHeaders uses Bearer authorization", () => {
  assert.deepEqual(createFundSummaryHeaders("abc"), {
    "content-type": "application/json",
    authorization: "Bearer abc",
  });
});

test("extractTextFromMessageContent supports string and array payloads", () => {
  assert.equal(extractTextFromMessageContent("hello"), "hello");
  assert.equal(
    extractTextFromMessageContent([
      { text: "first" },
      { input_text: "second" },
      { content: "third" },
    ]),
    "first\nsecond\nthird"
  );
});

test("normalizeGeneratedTitle strips wrappers and keeps first line", () => {
  assert.equal(
    normalizeGeneratedTitle('Title: "513100溢价查询"\nextra'),
    "513100溢价查询"
  );
});

test("readFundSummaryConfig reads dedicated env names", () => {
  assert.deepEqual(
    readFundSummaryConfig({
      FUND_SUMMARY_BASE: "https://summary.example.com",
      FUND_SUMMARY_MODEL: "gpt-5.2",
      FUND_SUMMARY_TOKEN: "secret",
    }),
    {
      base: "https://summary.example.com",
      model: "gpt-5.2",
      token: "secret",
    }
  );
});
