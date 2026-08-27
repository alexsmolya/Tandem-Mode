import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { TandemEnv } from "../config/env.js";

const MAX_IMAGE_BYTES = 32 * 1024 * 1024;

const MIME_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

const DEFAULT_QUESTION =
  "Opiši detaljno šta se vidi na slici — ako je screenshot buga, fokusiraj se na vidljivu grešku, tekst poruke, i UI kontekst.";

export async function describeImage(
  env: TandemEnv,
  imagePath: string,
  question?: string
): Promise<string> {
  const ext = path.extname(imagePath).toLowerCase();
  const mime = MIME_BY_EXT[ext];
  if (!mime) {
    throw new Error(`Nepodržan format slike '${ext}'. Podržano: JPEG, PNG, GIF, WebP.`);
  }

  const stats = await stat(imagePath);
  if (stats.size > MAX_IMAGE_BYTES) {
    throw new Error(`Slika je prevelika (${(stats.size / 1024 / 1024).toFixed(1)} MiB, limit 32 MiB).`);
  }

  const buffer = await readFile(imagePath);
  const dataUri = `data:${mime};base64,${buffer.toString("base64")}`;

  const response = await fetch(`${env.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.apiKey}`,
    },
    body: JSON.stringify({
      model: "deepseek-v4-flash-vision-exp",
      stream: false,
      thinking: { type: "disabled" },
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: question?.trim() || DEFAULT_QUESTION },
            { type: "image_url", image_url: { url: dataUri } },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`DeepSeek vision API error ${response.status}: ${body}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("Vision odgovor nije sadržao tekst.");
  }
  return content;
}
