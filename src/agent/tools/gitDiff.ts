import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ToolDefinition } from "./types.js";

const execFileAsync = promisify(execFile);
const MAX_OUTPUT_CHARS = 30_000;

export const gitDiffTool: ToolDefinition = {
  name: "git_diff",
  description: "Prikaži git diff za radni direktorijum (neustavljene izmene), opciono za jednu putanju.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Ograniči diff na ovu putanju." },
      staged: { type: "boolean", description: "Prikaži staged izmene (--cached) umesto working tree." },
    },
    required: [],
  },
  isDestructive: () => false,
  async execute(args, ctx) {
    const staged = Boolean(args["staged"]);
    const scopePath = args["path"] ? String(args["path"]) : undefined;
    const gitArgs = ["diff", ...(staged ? ["--cached"] : []), ...(scopePath ? ["--", scopePath] : [])];

    try {
      const { stdout } = await execFileAsync("git", gitArgs, { cwd: ctx.cwd, maxBuffer: 10 * 1024 * 1024 });
      const output = stdout.length > MAX_OUTPUT_CHARS ? stdout.slice(0, MAX_OUTPUT_CHARS) + "\n... (isečeno)" : stdout;
      return { output: output.trim() || "(nema izmena)", isError: false };
    } catch (err) {
      return { output: `Greška pri git diff: ${(err as Error).message}`, isError: true };
    }
  },
};
