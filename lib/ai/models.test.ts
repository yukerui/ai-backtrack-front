import { simulateReadableStream } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import type {
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamPart,
  LanguageModelV3Usage,
} from "@ai-sdk/provider";
import { getResponseChunksByPrompt } from "@/tests/prompts/utils";

const mockUsage: LanguageModelV3Usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 20, text: 20, reasoning: 0 },
};

const stopFinishReason: LanguageModelV3GenerateResult["finishReason"] = {
  unified: "stop",
  raw: "stop",
};

function makeGenerateResult(text: string): LanguageModelV3GenerateResult {
  return {
    finishReason: stopFinishReason,
    usage: mockUsage,
    content: [{ type: "text", text }],
    warnings: [],
  };
}

export const chatModel = new MockLanguageModelV3({
  doGenerate: async () => makeGenerateResult("Hello, world!"),
  doStream: async ({ prompt }) => ({
    stream: simulateReadableStream({
      chunkDelayInMs: 500,
      initialDelayInMs: 1000,
      chunks: getResponseChunksByPrompt(prompt),
    }),
  }),
});

export const reasoningModel = new MockLanguageModelV3({
  doGenerate: async () => makeGenerateResult("Hello, world!"),
  doStream: async ({ prompt }) => ({
    stream: simulateReadableStream({
      chunkDelayInMs: 500,
      initialDelayInMs: 1000,
      chunks: getResponseChunksByPrompt(prompt, true),
    }),
  }),
});

export const titleModel = new MockLanguageModelV3({
  doGenerate: async () => makeGenerateResult("This is a test title"),
  doStream: async () => {
    const chunks: LanguageModelV3StreamPart[] = [
      { id: "1", type: "text-start" },
      { id: "1", type: "text-delta", delta: "This is a test title" },
      { id: "1", type: "text-end" },
      {
        type: "finish",
        finishReason: stopFinishReason,
        usage: mockUsage,
      },
    ];

    return {
      stream: simulateReadableStream({
        chunkDelayInMs: 500,
        initialDelayInMs: 1000,
        chunks,
      }),
    };
  },
});

export const artifactModel = new MockLanguageModelV3({
  doGenerate: async () => makeGenerateResult("Hello, world!"),
  doStream: async ({ prompt }) => ({
    stream: simulateReadableStream({
      chunkDelayInMs: 50,
      initialDelayInMs: 100,
      chunks: getResponseChunksByPrompt(prompt),
    }),
  }),
});
