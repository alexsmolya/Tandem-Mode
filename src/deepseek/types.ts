export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: ChatRole;
  /** `null` je legalno za assistant poruku koja je samo tool_calls, bez teksta. */
  content: string | null;
  /** Samo za role "assistant" kad su tools u igri. */
  reasoningContent?: string;
  toolCalls?: ToolCall[];
  /** Samo za role "tool" — koji poziv ovaj rezultat zatvara. */
  toolCallId?: string;
}

export interface ToolSpec {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ThinkingConfig {
  reasoningEffort: "low" | "high" | "max";
}

export interface ChatCompletionParams {
  model: "deepseek-v4-pro" | "deepseek-v4-flash";
  messages: ChatMessage[];
  thinking?: ThinkingConfig;
  tools?: ToolSpec[];
  /** Zahteva validan JSON string kao `content` — šema se opisuje u promptu, API je ne nameće. */
  jsonOutput?: boolean;
}

export interface ChatCompletionResult {
  content: string;
  reasoningContent: string;
  usage: UsageInfo;
}

export interface UsageInfo {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  promptCacheHitTokens: number;
  promptCacheMissTokens: number;
  reasoningTokens: number;
}

export type StreamEvent =
  | { type: "content_delta"; delta: string }
  // Prikazuje se korisniku. Bez tools API ovo tiho ignoriše ako se vrati u
  // history; sa tools, prethodni reasoning_content treba vratiti uz naredni
  // poziv u istom tool-calling nizu, pa ga agent petlja čuva i prosleđuje.
  | { type: "reasoning_delta"; delta: string }
  // Fragment jednog tool poziva (OpenAI-stil): prvi fragment po `index` nosi
  // `id`+`name`, svi naredni nose samo komad `argumentsDelta` — pozivalac
  // spaja po `index`.
  | { type: "tool_call_delta"; index: number; id?: string; name?: string; argumentsDelta?: string }
  | { type: "usage"; usage: UsageInfo }
  | { type: "done"; finishReason: string | null };
