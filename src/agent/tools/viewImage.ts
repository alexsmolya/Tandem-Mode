import path from "node:path";
import { describeImage } from "../../deepseek/vision.js";
import type { ToolDefinition } from "./types.js";

export const viewImageTool: ToolDefinition = {
  name: "view_image",
  description:
    "Pogledaj sliku (screenshot buga, mockup, dijagram) i dobij tekstualni opis ili odgovor na pitanje o njoj. Koristi kad korisnik pomene screenshot ili sliku i da putanju do nje. Podržani formati: JPEG, PNG, GIF, WebP.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Putanja do slike." },
      question: {
        type: "string",
        description: "Šta konkretno pitati o slici. Podrazumevano: opšti opis fokusiran na moguću grešku.",
      },
    },
    required: ["path"],
  },
  isDestructive: () => false,
  async execute(args, ctx) {
    const imagePath = String(args["path"] ?? "");
    const question = args["question"] ? String(args["question"]) : undefined;
    const resolved = path.resolve(ctx.cwd, imagePath);

    try {
      const { text, usage } = await describeImage(ctx.env, resolved, question, ctx.signal);
      // vision-exp nema objavljen poseban cenovnik — trošak se prijavljuje
      // po Flash tarifi kao najbolja dostupna procena (stvarni tokeni su tačni).
      ctx.usage.add("deepseek-v4-flash", usage);
      return { output: text, isError: false };
    } catch (err) {
      return { output: `Greška pri analizi slike: ${(err as Error).message}`, isError: true };
    }
  },
};
