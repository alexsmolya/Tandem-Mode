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

export async function runPlanner(
  env: TandemEnv,
  task: string,
  repoMap: string,
  signal?: AbortSignal
): Promise<{ plan: Plan; usage: UsageInfo }> {
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
    throw new Error(`Planner nije vratio validan JSON:\n${result.content.slice(0, 500)}`);
  }
  if (!isPlan(parsed)) {
    throw new Error(`Planner JSON ne prati očekivanu šemu:\n${result.content.slice(0, 500)}`);
  }

  return { plan: parsed, usage: result.usage };
}
