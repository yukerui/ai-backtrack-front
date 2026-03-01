import "server-only";

import { createHash } from "node:crypto";

const WHITESPACE_REGEX = /\s+/g;
const PUNCT_SYMBOL_REGEX = /[\p{P}\p{S}]+/gu;

export function normalizeQuestionForCache(text: string) {
  return String(text || "")
    .trim()
    .toLowerCase()
    .replace(PUNCT_SYMBOL_REGEX, " ")
    .replace(WHITESPACE_REGEX, " ")
    .trim();
}

export function getQuestionHash(text: string) {
  const normalized = normalizeQuestionForCache(text);
  if (!normalized) {
    return "";
  }
  return createHash("sha256").update(normalized).digest("hex");
}
