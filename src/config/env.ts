import { getStoredApiKey } from "./credentials.js";
import type { TandemConfig } from "./schema.js";

export interface TandemEnv {
  apiKey: string;
  baseUrl: string;
}

/** DEEPSEEK_API_KEY (env) ima prednost nad OS credential store-om — za CI/automatizaciju. */
export async function resolveApiKey(): Promise<string | null> {
  const envKey = process.env["DEEPSEEK_API_KEY"];
  if (envKey) return envKey;
  return getStoredApiKey();
}

export function resolveBaseUrl(config: TandemConfig): string {
  return process.env["DEEPSEEK_BASE_URL"] ?? config.baseUrl ?? "https://api.deepseek.com";
}
