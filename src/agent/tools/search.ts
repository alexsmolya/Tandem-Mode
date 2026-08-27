import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ToolDefinition } from "./types.js";

const execFileAsync = promisify(execFile);
const MAX_OUTPUT_CHARS = 20_000;

export const searchTool: ToolDefinition = {
  name: "search",
  description: "Pretraži sadržaj fajlova regex šablonom preko ripgrep-a (rg).",
  parameters: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "Regex šablon za pretragu." },
      path: { type: "string", description: "Direktorijum ili fajl za pretragu. Podrazumevano radni direktorijum." },
      glob: { type: "string", description: "Opcioni glob filter fajlova, npr. '*.ts'." },
      caseInsensitive: { type: "boolean", description: "Pretraga bez razlikovanja velikih/malih slova." },
    },
    required: ["pattern"],
  },
  isDestructive: () => false,
  async execute(args, ctx) {
    const pattern = String(args["pattern"] ?? "");
    const searchPath = String(args["path"] ?? ".");
    const glob = args["glob"] ? String(args["glob"]) : undefined;
    const caseInsensitive = Boolean(args["caseInsensitive"]);

    const rgArgs = ["--line-number", "--with-filename", "--max-count", "200"];
    if (caseInsensitive) rgArgs.push("--ignore-case");
    if (glob) rgArgs.push("--glob", glob);
    rgArgs.push("--", pattern, searchPath);

    try {
      const { stdout } = await execFileAsync("rg", rgArgs, { cwd: ctx.cwd, maxBuffer: 10 * 1024 * 1024 });
      const output = stdout.length > MAX_OUTPUT_CHARS ? stdout.slice(0, MAX_OUTPUT_CHARS) + "\n... (isečeno)" : stdout;
      return { output: output.trim() || "(nema poklapanja)", isError: false };
    } catch (err) {
      const e = err as { code?: string | number; message: string };
      if (e.code === "ENOENT") {
        return {
          output: "ripgrep (rg) nije instaliran ili nije u PATH-u. Instaliraj ga da bi search alat radio.",
          isError: true,
        };
      }
      // rg vraća exit code 1 kad nema poklapanja — to nije greška alata.
      if (e.code === 1) {
        return { output: "(nema poklapanja)", isError: false };
      }
      return { output: `Greška pri pretrazi: ${e.message}`, isError: true };
    }
  },
};
