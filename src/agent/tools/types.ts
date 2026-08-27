import type { ToolSpec } from "../../deepseek/types.js";

export interface ToolContext {
  cwd: string;
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
