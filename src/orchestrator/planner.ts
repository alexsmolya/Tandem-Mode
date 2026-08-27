import { chatCompletionOnce } from "../deepseek/client.js";
import type { TandemEnv } from "../config/env.js";
import type { UsageInfo } from "../deepseek/types.js";
import { isPlan, type Plan } from "./types.js";

const PLANNER_SYSTEM_PROMPT = `Ti si planner u Tandem Mode coding agentu. Dobijaš zadatak i mapu
repozitorijuma. Podeli zadatak na male, nezavisne korake koje worker model
(bez pristupa ovom razgovoru, samo alatima read_file/list_dir/search/edit/
git_diff/shell/view_image) može samostalno izvršiti.

Odgovori ISKLJUČIVO validnim JSON-om, bez markdown ograda, tačno ove šeme:
{
  "summary": "kratak opis pristupa",
  "tasks": [
    { "id": "t1", "description": "...", "files": ["..."], "acceptanceCriteria": "..." }
  ]
}`;

const MAX_ATTEMPTS = 2;

export async function runPlanner(
  env: TandemEnv,
  task: string,
  repoMap: string,
  signal?: AbortSignal
): Promise<{ plan: Plan; usage: UsageInfo }> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const result = await chatCompletionOnce(env, {
      model: "deepseek-v4-pro",
      thinking: { reasoningEffort: "max" },
      jsonOutput: true,
      messages: [
        { role: "system", content: PLANNER_SYSTEM_PROMPT },
        { role: "user", content: `Zadatak:\n${task}\n\nMapa repozitorijuma:\n${repoMap}` },
      ],
      ...(signal ? { signal } : {}),
    });

    let parsed: unknown;
    try {
      parsed = JSON.parse(result.content);
    } catch {
      lastError = new Error(`Planner nije vratio validan JSON (pokušaj ${attempt}):\n${result.content.slice(0, 500)}`);
      continue;
    }
    if (!isPlan(parsed)) {
      lastError = new Error(`Planner JSON ne prati očekivanu šemu (pokušaj ${attempt}):\n${result.content.slice(0, 500)}`);
      continue;
    }

    return { plan: parsed, usage: result.usage };
  }

  // Poznato ponašanje: json_object mod povremeno vrati prazan/nevalidan
  // sadržaj (verovatno prolazna API nestabilnost, ne dosledna greška —
  // videti docs/api-notes.md). Jedan retry pokriva to bez rušenja pozivaoca.
  throw lastError ?? new Error("Planner nije uspeo posle više pokušaja.");
}
