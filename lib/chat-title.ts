const FALLBACK_CHAT_TITLE = "New chat";
const MAX_CHAT_TITLE_LENGTH = 48;
const SENTENCE_ENDINGS = new Set(["。", "！", "？", "!", "?", "；", ";"]);

function normalizeTitleSource(text: string) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\t+/g, " ")
    .trim();
}

function getFirstNonEmptyLine(text: string) {
  return normalizeTitleSource(text)
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);
}

function getFirstSentence(text: string) {
  const firstLine = getFirstNonEmptyLine(text);

  if (!firstLine) {
    return "";
  }

  for (let index = 0; index < firstLine.length; index++) {
    const character = firstLine[index];

    if (character && SENTENCE_ENDINGS.has(character)) {
      return firstLine
        .slice(0, index + 1)
        .replace(/\s+/g, " ")
        .trim();
    }
  }

  return firstLine.replace(/\s+/g, " ").trim();
}

export function getChatTitleFromUserText(text: string) {
  const firstSentence = getFirstSentence(text);

  if (!firstSentence) {
    return FALLBACK_CHAT_TITLE;
  }

  const characters = Array.from(firstSentence);

  if (characters.length <= MAX_CHAT_TITLE_LENGTH) {
    return firstSentence;
  }

  return `${characters.slice(0, MAX_CHAT_TITLE_LENGTH).join("").trimEnd()}...`;
}
