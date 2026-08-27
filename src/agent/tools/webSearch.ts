import { runWebSearch } from "../../deepseek/webSearch.js";
import type { ToolDefinition } from "./types.js";

export const webSearchTool: ToolDefinition = {
  name: "web_search",
  description:
    "Pretraži internet za trenutne informacije — error poruke, dokumentaciju biblioteka, novosti. Koristi kad odgovor zahteva nešto što nije u kodu ili repo kontekstu.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Upit za pretragu." },
    },
    required: ["query"],
  },
  isDestructive: () => false,
  async execute(args, ctx) {
    const query = String(args["query"] ?? "");
    try {
      const { text, usage } = await runWebSearch(ctx.env, query, ctx.signal);
      // Responses API nema objavljen zaseban cenovnik — trošak se prijavljuje
      // po Flash tarifi kao najbolja dostupna procena (stvarni tokeni su tačni).
      ctx.usage.add("deepseek-v4-flash", usage);
      return { output: text, isError: false };
    } catch (err) {
      return { output: `Greška pri pretrazi: ${(err as Error).message}`, isError: true };
    }
  },
};
