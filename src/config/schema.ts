export interface TandemConfig {
  defaultModel?: "deepseek-v4-pro" | "deepseek-v4-flash";
  defaultReasoningEffort?: "low" | "high" | "max";
  budgetUsd?: number;
  baseUrl?: string;
}

export const DEFAULT_CONFIG: Required<Pick<TandemConfig, "defaultModel" | "defaultReasoningEffort">> = {
  defaultModel: "deepseek-v4-pro",
  defaultReasoningEffort: "high",
};
