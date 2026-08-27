# Benchmark design (M4)

**Status:** design + types only. Not run yet — needs a decision on the target
repo (real WP plugin, an anonymized copy, or a substitute project) before the
runner can produce numbers.

## Goal

Test the hypothesis from the plan (section 7): does orchestration
(Pro planner + Flash workers + Pro reviewer) keep most of Pro-only's quality
at meaningfully lower Pro-token cost? This is **not asserted anywhere** until
this benchmark actually shows it — see plan section 7.

## The three configurations

Same task set run three ways:

1. **Pro-only** — `deepseek-v4-pro`, no orchestration, single agent loop.
2. **Flash-only** — `deepseek-v4-flash`, no orchestration, single agent loop.
3. **Orchestration** — `/plan`, as built in M3.

## The 12 measurement dimensions (spec point 30)

| # | Dimension | How it's measured |
|---|---|---|
| 1 | Completion | Did the agent produce a final answer, or hit `max_iterations_reached` / `budget_exceeded` / an unrecoverable error? |
| 2 | Correctness | Does `verify` (task-defined check command) exit 0 against the resulting diff? |
| 3 | Build | Does the task's `build` command (if any) succeed? |
| 4 | Test | Does the task's `test` command (if any) pass? |
| 5 | Unnecessary changes | Files touched outside what the task's acceptance criteria implies — diffed against a human-reviewed "expected files" list per task |
| 6 | Failed attempts | Count of `tool_call_result` events with `isError: true` |
| 7 | Self-correction | A failed attempt followed by a successful retry of a related action, before giving up |
| 8 | Architecture | Qualitative — not automatable. Scored by manual review (or a separate LLM-judge pass) of the diff's design quality, not by the harness itself |
| 9 | Tokens | From `UsageAccumulator.totals()` — real API `usage` fields, never estimated |
| 10 | Requests | `UsageAccumulator.callCount` |
| 11 | Cost | `UsageAccumulator.estimatedCostUsd()`, plus the off-peak equivalent for context |
| 12 | Time | Wall-clock duration of the run |

Dimensions 1–4, 6, 9–12 are directly automatable from what the agent loop
and usage accumulator already expose. Dimension 5 needs a per-task "expected
files" annotation to compare against. Dimension 7 needs a small heuristic
(same tool name + same or overlapping args, error then success, within N
iterations of each other). Dimension 8 is deliberately left manual/qualitative
— an automated score there would just be noise dressed up as data.

## Task format (planned shape for `src/benchmark/types.ts`)

```ts
interface BenchmarkTask {
  id: string;
  description: string;      // the prompt given to the agent
  expectedFiles: string[];  // for dimension 5
  setup?: string;           // shell command to reset the target repo to baseline
  build?: string;           // e.g. "php -l %file%" or "npm run build"
  test?: string;            // e.g. "npm test"
  verify: string;           // exits 0 if the task's goal was actually achieved
}
```

## What's still open before this can run

- The target repo itself (see plan, M1 exit criterion — still unresolved).
- A real task list (5–10 realistic tasks against that repo, each with
  `expectedFiles`/`verify`/optionally `build`/`test`) — needs the repo first.
- The runner (`src/benchmark/runner.ts`) that actually drives the three
  configurations per task, using `runAgentLoop`/`runOrchestration` and a
  fresh git worktree or `git stash`/`git reset --hard` between runs so tasks
  don't interfere with each other.
- A report formatter that turns the raw results into the README table.

## Reporting

Whatever the numbers say goes in the README as-is — plan section 4 in the
master plan is explicit that a negative or mixed result is still credible
data, not a launch blocker.
