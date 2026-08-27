import { password, select } from "@inquirer/prompts";
import { setStoredApiKey } from "../config/credentials.js";
import { saveGlobalConfig } from "../config/store.js";
import type { TandemConfig } from "../config/schema.js";

export async function runFirstRunWizard(): Promise<TandemConfig> {
  console.log("Prvo pokretanje — potreban je DeepSeek API ključ.\n");

  const apiKey = await password({
    message: "DeepSeek API ključ:",
    mask: "*",
    validate: (value) => (value.trim().length > 0 ? true : "Ključ ne može biti prazan."),
  });

  const defaultModel = await select<"deepseek-v4-pro" | "deepseek-v4-flash">({
    message: "Podrazumevani model:",
    choices: [
      { name: "deepseek-v4-pro (jači, skuplji)", value: "deepseek-v4-pro" },
      { name: "deepseek-v4-flash (brži, jeftiniji)", value: "deepseek-v4-flash" },
    ],
    default: "deepseek-v4-pro",
  });

  const defaultReasoningEffort = await select<"low" | "high" | "max">({
    message: "Podrazumevani reasoning effort:",
    choices: [
      { name: "low", value: "low" },
      { name: "high", value: "high" },
      { name: "max", value: "max" },
    ],
    default: "high",
  });

  await setStoredApiKey(apiKey.trim());
  const config: TandemConfig = { defaultModel, defaultReasoningEffort };
  await saveGlobalConfig(config);

  console.log("\nSačuvano — ključ je u OS credential store-u, podešavanja u ~/.tandem/config.json.\n");
  return config;
}
