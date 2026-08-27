import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ToolDefinition } from "./types.js";

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let idx = 0;
  for (;;) {
    idx = haystack.indexOf(needle, idx);
    if (idx === -1) break;
    count++;
    idx += needle.length;
  }
  return count;
}

export const editTool: ToolDefinition = {
  name: "edit",
  description:
    "Zameni tačan string u fajlu novim stringom. `oldString` mora biti jedinstven u fajlu osim ako je replaceAll=true. Čuva originalni stil kraja linije (CRLF/LF).",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Putanja do fajla." },
      oldString: { type: "string", description: "Tačan tekst koji se menja (sa dovoljno konteksta da bude jedinstven)." },
      newString: { type: "string", description: "Tekst kojim se zamenjuje." },
      replaceAll: { type: "boolean", description: "Zameni sve pojave umesto zahteva za jedinstvenost." },
    },
    required: ["path", "oldString", "newString"],
  },
  // Uvek menja fajl na disku.
  isDestructive: () => true,
  async execute(args, ctx) {
    const filePath = String(args["path"] ?? "");
    const oldString = String(args["oldString"] ?? "");
    const newString = String(args["newString"] ?? "");
    const replaceAll = Boolean(args["replaceAll"]);
    const resolved = path.resolve(ctx.cwd, filePath);

    if (oldString === newString) {
      return { output: "oldString i newString su identični — nema izmene.", isError: true };
    }

    let raw: string;
    try {
      raw = await readFile(resolved, "utf8");
    } catch (err) {
      return { output: `Greška pri čitanju ${resolved}: ${(err as Error).message}`, isError: true };
    }

    const eol = raw.includes("\r\n") ? "\r\n" : "\n";
    const normalized = raw.replace(/\r\n/g, "\n");
    const needle = oldString.replace(/\r\n/g, "\n");
    const replacement = newString.replace(/\r\n/g, "\n");

    const occurrences = countOccurrences(normalized, needle);
    if (occurrences === 0) {
      return { output: `oldString nije pronađen u ${filePath}.`, isError: true };
    }
    if (occurrences > 1 && !replaceAll) {
      return {
        output: `oldString se pojavljuje ${occurrences} puta u ${filePath} — dodaj više konteksta da bude jedinstven, ili prosledi replaceAll=true.`,
        isError: true,
      };
    }

    const updated = replaceAll
      ? normalized.split(needle).join(replacement)
      : normalized.replace(needle, replacement);

    const finalContent = eol === "\r\n" ? updated.replace(/\n/g, "\r\n") : updated;

    try {
      await writeFile(resolved, finalContent, "utf8");
    } catch (err) {
      return { output: `Greška pri upisu ${resolved}: ${(err as Error).message}`, isError: true };
    }

    return {
      output: `Izmenjeno ${filePath} (${occurrences} ${occurrences === 1 ? "zamena" : "zamena"}).`,
      isError: false,
    };
  },
};
