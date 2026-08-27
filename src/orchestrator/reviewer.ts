import { chatCompletionOnce } from "../deepseek/client.js";
import type { TandemEnv } from "../config/env.js";
import type { UsageInfo } from "../deepseek/types.js";
import { isReviewResult, type Plan, type ReviewResult } from "./types.js";

const REVIEWER_SYSTEM_PROMPT = `Ti si reviewer u Tandem Mode coding agentu. Dobijaš originalni zadatak,
plan koji je worker(i) izvršio, i git diff stvarnih izmena. Proveri da li
diff zaista ispunjava zadatak i kriterijume prihvatanja iz plana, da nema
nepotrebnih izmena, i da je kod razuman.

Odgovori ISKLJUČIVO validnim JSON-om, bez markdown ograda, tačno ove šeme:
{
  "approved": true|false,
  "notes": "kratko obrazloženje",
  "corrections": [{ "description": "...", "files": ["..."] }]
}
"corrections" je prazan niz ako je approved true.`;

export async function runReviewer(
  env: TandemEnv,
  originalTask: string,
  plan: Plan,
  gitDiff: string
): Promise<{ result: ReviewResult; usage: UsageInfo }> {
  const response = await chatCompletionOnce(env, {
    model: "deepseek-v4-pro",
    thinking: { reasoningEffort: "high" },
    jsonOutput: true,
    messages: [
      { role: "system", content: REVIEWER_SYSTEM_PROMPT },
      {
        role: "user",
        content: `Originalni zadatak:\n${originalTask}\n\nPlan:\n${JSON.stringify(plan, null, 2)}\n\nGit diff:\n${gitDiff.slice(0, 15000)}`,
      },
    ],
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(response.content);
  } catch {
    throw new Error(`Reviewer nije vratio validan JSON:\n${response.content.slice(0, 500)}`);
  }
  if (!isReviewResult(parsed)) {
    throw new Error(`Reviewer JSON ne prati očekivanu šemu:\n${response.content.slice(0, 500)}`);
  }

  const result: ReviewResult = {
    approved: parsed.approved,
    notes: parsed.notes ?? "",
    corrections: parsed.corrections ?? [],
  };

  return { result, usage: response.usage };
}
