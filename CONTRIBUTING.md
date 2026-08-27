# Contributing to Tandem Mode

Thanks for taking a look. This is a small, early-stage project — a solo
side effort turned open-source, not a company product — so process here is
intentionally light.

## Setup

```bash
git clone https://github.com/zdrave08/Tandem-Mode.git
cd Tandem-Mode
pnpm install
cp .env.example .env   # or let `pnpm dev` walk you through the first-run wizard
pnpm typecheck
pnpm dev "read package.json and tell me the version" --yes
```

You'll need a DeepSeek API key ([platform.deepseek.com](https://platform.deepseek.com))
to run anything that actually calls the model.

## Ground rules

- **TypeScript, strict.** `pnpm typecheck` must pass before a PR — no `any`
  escapes without a specific reason, `exactOptionalPropertyTypes` is on.
- **No unverified API behavior.** Anything about the DeepSeek API that isn't
  obvious from a type signature should be checked against a live call or the
  official docs and written down in [`docs/api-notes.md`](./docs/api-notes.md),
  not assumed from a blog post or another project's code. See that file for
  the format — Status / Nalaz / Izvor / Datum (yes, in Serbian; that's the
  maintainer's working language for that file specifically, the codebase and
  everything else is English).
- **Windows is first-class**, not an afterthought. If you touch path handling,
  the shell tool, or file I/O, test on Windows or say clearly in the PR that
  you didn't and it needs a check.
- **Safety.** Nothing that mutates files, runs shell commands, or otherwise
  changes state should ever happen silently. If you add a tool, give it a
  correct `isDestructive()` — when in doubt, treat it as destructive.
- **Small PRs.** One thing at a time is easier to review than a redesign.

## Where things live

- `src/deepseek/` — API client (chat completions, vision, web search)
- `src/agent/` — the tool-calling loop, tools, sessions, usage tracking
- `src/orchestrator/` — planner/worker/reviewer
- `src/repl/` — slash commands, runtime state, first-run wizard
- `src/cli.tsx` — Ink UI, REPL and single-shot entry points

## Adding a tool

Look at an existing one first (`src/agent/tools/readFile.ts` is a simple
read-only example, `src/agent/tools/edit.ts` a destructive one). A tool is a
plain object: `name`, `description`, a JSON-schema `parameters`, `isDestructive(args)`,
and `execute(args, ctx)`. Register it in `src/agent/tools/index.ts`.

## Good first issues

Look for the `good first issue` label, or check section 4 of the
[development plan](./deepseek-cli-development-plan.md) for features that were
deliberately deferred rather than built by the maintainer — `/compact`,
`/diff`, `/save-profile`/`/profile`, a notification hook on task completion,
and Linux/macOS clipboard support for `/paste` are all open.

## Reporting bugs / API surprises

If DeepSeek's actual behavior doesn't match what `docs/api-notes.md` says,
that's a genuinely useful bug report even if nothing in the code is wrong —
open an issue with the request/response you saw.

## License

By contributing, you agree your contribution is licensed under the project's
[MIT license](./LICENSE).
