import type { ToolSpec } from "../../deepseek/types.js";
import type { TandemEnv } from "../../config/env.js";
import type { UsageAccumulator } from "../usage.js";

export interface ToolContext {
  cwd: string;
  env: TandemEnv;
  /** Alati koji sami zovu API (vision, web search) prijavljuju svoj usage ovde. */
  usage: UsageAccumulator;
  signal?: AbortSignal;
}

export interface ToolResult {
  output: string;
  isError: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  /** Da li ova konkretna invokacija menja stanje (fajl/proces/git). */
  isDestructive: (args: Record<string, unknown>) => boolean;
  execute: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;
}

export function toToolSpec(tool: ToolDefinition): ToolSpec {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}
