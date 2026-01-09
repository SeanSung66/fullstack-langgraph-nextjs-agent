import { ChatOpenAI } from "@langchain/openai";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";

export interface CreateChatModelOptions {
  provider?: string; // 'openai' | 'google' | 'deepseek' | others later
  model: string;
  temperature?: number;
}

/**
 * Central factory for creating a chat model based on provider + model name.
 */
export function createChatModel({
  provider = "google",
  model,
  temperature = 1,
}: CreateChatModelOptions): BaseChatModel {
  switch (provider) {
    case "openai":
      return new ChatOpenAI({ model, temperature });
    case "deepseek":
      return new ChatOpenAI({
        model,
        temperature,
        configuration: {
          baseURL: "https://api.deepseek.com/v1",
          apiKey: process.env.DEEPSEEK_API_KEY,
        },
      });
    case "google":
    default:
      return new ChatGoogleGenerativeAI({ model, temperature });
  }
}
export interface AgentConfigOptions {
  model?: string;
  provider?: string; // 'google' | 'openai' etc.
  systemPrompt?: string; // system prompt override
  tools?: unknown[]; // tools from registry or direct tool objects
  approveAllTools?: boolean; // if true, skip tool approval prompts
}

export const DEFAULT_MODEL_PROVIDER = "google";
export const DEFAULT_MODEL_NAME = "gemini-3-flash-preview";
