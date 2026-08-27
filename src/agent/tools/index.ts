import type { ToolDefinition } from "./types.js";
import { toToolSpec } from "./types.js";
import { readFileTool } from "./readFile.js";
import { listDirTool } from "./listDir.js";
import { searchTool } from "./search.js";
import { editTool } from "./edit.js";
import { gitDiffTool } from "./gitDiff.js";
import { shellTool } from "./shell.js";
import { viewImageTool } from "./viewImage.js";

export const allTools: ToolDefinition[] = [
  readFileTool,
  listDirTool,
  searchTool,
  editTool,
  gitDiffTool,
  shellTool,
  viewImageTool,
];

export const toolSpecs = allTools.map(toToolSpec);

export function findTool(name: string): ToolDefinition | undefined {
  return allTools.find((t) => t.name === name);
}

export type { ToolDefinition, ToolContext, ToolResult } from "./types.js";
