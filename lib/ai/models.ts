// Curated list of chat models shown in the selector.
export const DEFAULT_CHAT_MODEL = "gpt-5.3-codex";

export type ChatModel = {
  id: string;
  name: string;
  provider: string;
  description: string;
  disabled?: boolean;
};

export const chatModels: ChatModel[] = [
  // Anthropic
  {
    id: "anthropic/claude-haiku-4.5",
    name: "Claude Haiku 4.5",
    provider: "anthropic",
    description: "Fast and affordable, great for everyday tasks",
    disabled: true,
  },
  // OpenAI
  {
    id: "gpt-5.3-codex",
    name: "gpt-5.3-codex",
    provider: "openai",
    description: "Default Codex model",
  },
  {
    id: "gpt-5.2-codex",
    name: "gpt-5.2-codex",
    provider: "openai",
    description: "Earlier Codex model",
  },
  {
    id: "gpt-5.4",
    name: "gpt-5.4",
    provider: "openai",
    description: "GPT 5.4",
  },
  {
    id: "gpt-5.2",
    name: "gpt-5.2",
    provider: "openai",
    description: "GPT 5.2",
  },
  // Google
  {
    id: "google/gemini-2.5-flash-lite",
    name: "Gemini 2.5 Flash Lite",
    provider: "google",
    description: "Ultra fast and affordable",
    disabled: true,
  },
  {
    id: "google/gemini-3-pro-preview",
    name: "Gemini 3 Pro",
    provider: "google",
    description: "Most capable Google model",
    disabled: true,
  },
  // xAI
  {
    id: "xai/grok-4.1-fast-non-reasoning",
    name: "Grok 4.1 Fast",
    provider: "xai",
    description: "Fast with 30K context",
    disabled: true,
  },
];

// Group models by provider for UI
export const selectableModelIds = new Set(
  chatModels.filter((model) => !model.disabled).map((model) => model.id)
);

export const modelsByProvider = chatModels.reduce(
  (acc, model) => {
    if (!acc[model.provider]) {
      acc[model.provider] = [];
    }
    acc[model.provider].push(model);
    return acc;
  },
  {} as Record<string, ChatModel[]>
);
