import type {
  AssistantModelMessage,
  ToolModelMessage,
  UIMessage,
  UIMessagePart,
} from 'ai';
import { type ClassValue, clsx } from 'clsx';
import { formatISO } from 'date-fns';
import { twMerge } from 'tailwind-merge';
import type { DBMessage, Document } from '@/lib/db/schema';
import { ChatSDKError, type ErrorCode } from './errors';
import type { ChatMessage, ChatTools, CustomUIDataTypes } from './types';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const fetcher = async (url: string) => {
  const response = await fetch(url);

  if (!response.ok) {
    const { code, cause } = await response.json();
    throw new ChatSDKError(code as ErrorCode, cause);
  }

  return response.json();
};

function getFallbackChatErrorCode(status: number): ErrorCode {
  switch (status) {
    case 401:
      return "unauthorized:chat";
    case 403:
      return "forbidden:chat";
    case 404:
      return "not_found:chat";
    case 429:
      return "rate_limit:chat";
    default:
      return status >= 500 ? "offline:chat" : "bad_request:api";
  }
}

async function normalizeChatTransportError(response: Response) {
  const raw = await response.text().catch(() => "");
  let parsed:
    | Partial<{ code: unknown; cause: unknown; message: unknown }>
    | null = null;

  if (raw) {
    try {
      parsed = JSON.parse(raw) as Partial<{
        code: unknown;
        cause: unknown;
        message: unknown;
      }>;
    } catch {
      parsed = null;
    }
  }

  const code =
    typeof parsed?.code === "string" && parsed.code.includes(":")
      ? (parsed.code as ErrorCode)
      : getFallbackChatErrorCode(response.status);
  const cause =
    typeof parsed?.cause === "string" && parsed.cause.trim()
      ? parsed.cause
      : typeof parsed?.message === "string" && parsed.message.trim()
        ? parsed.message
        : raw.trim() || response.statusText || undefined;

  return new ChatSDKError(code, cause);
}

export async function fetchWithErrorHandlers(
  input: RequestInfo | URL,
  init?: RequestInit,
) {
  try {
    const response = await fetch(input, init);

    if (!response.ok) {
      throw await normalizeChatTransportError(response);
    }

    return response;
  } catch (error: unknown) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new ChatSDKError('offline:chat');
    }

    throw error;
  }
}

export function getLocalStorage(key: string) {
  if (typeof window !== 'undefined') {
    return JSON.parse(localStorage.getItem(key) || '[]');
  }
  return [];
}

export function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

type ResponseMessageWithoutId = ToolModelMessage | AssistantModelMessage;
type ResponseMessage = ResponseMessageWithoutId & { id: string };

export function getMostRecentUserMessage(messages: UIMessage[]) {
  const userMessages = messages.filter((message) => message.role === 'user');
  return userMessages.at(-1);
}

export function getDocumentTimestampByIndex(
  documents: Document[],
  index: number,
) {
  if (!documents) { return new Date(); }
  if (index > documents.length) { return new Date(); }

  return documents[index].createdAt;
}

export function getTrailingMessageId({
  messages,
}: {
  messages: ResponseMessage[];
}): string | null {
  const trailingMessage = messages.at(-1);

  if (!trailingMessage) { return null; }

  return trailingMessage.id;
}

export function sanitizeText(text: string) {
  return text.replace('<has_function_call>', '');
}

const MARKDOWN_LINK_OR_URL_REGEX = /\[[^\]]+]\([^)]+\)|https?:\/\/[^\s<>()`]+/g;

function normalizeBrokenMarkdownLinks(text: string) {
  // Fix common malformed pattern from model output:
  // [label](https://example.com`)
  return text.replace(/\]\(([^)\s`]+)`\)/g, "]($1)");
}

function stripTrailingUrlPunctuation(url: string) {
  return url.replace(/[.,;!?]+$/g, "");
}

export function linkifyUrlsAsMarkdown(text: string) {
  if (!text) {
    return text;
  }

  const normalized = normalizeBrokenMarkdownLinks(text);

  return normalized.replace(MARKDOWN_LINK_OR_URL_REGEX, (match) => {
    // Keep existing markdown links unchanged.
    if (match.startsWith("[")) {
      return match;
    }

    const url = stripTrailingUrlPunctuation(match);
    return `[${url}](${url})`;
  });
}

export function convertToUIMessages(messages: DBMessage[]): ChatMessage[] {
  return messages.map((message) => ({
    id: message.id,
    role: message.role as 'user' | 'assistant' | 'system',
    parts: message.parts as UIMessagePart<CustomUIDataTypes, ChatTools>[],
    metadata: {
      createdAt: formatISO(message.createdAt),
    },
  }));
}

export function getTextFromMessage(message: ChatMessage | UIMessage): string {
  return message.parts
    .filter((part) => part.type === 'text')
    .map((part) => (part as { type: 'text'; text: string}).text)
    .join('');
}
