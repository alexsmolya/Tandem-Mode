import React, { useEffect, useState } from "react";
import { render, Text, Box, useApp } from "ink";
import readline from "node:readline";
import { resolveApiKey, resolveBaseUrl } from "./config/env.js";
import { loadConfig } from "./config/store.js";
import { DEFAULT_CONFIG } from "./config/schema.js";
import { runFirstRunWizard } from "./repl/wizard.js";
import { handleCommand } from "./repl/commands.js";
import { SYSTEM_PROMPT } from "./repl/system-prompt.js";
import { runAgentLoop, type AgentEvent } from "./agent/loop.js";
import { UsageAccumulator } from "./agent/usage.js";
import { appendSessionMessage, createSession, findLatestSession, loadSessionMessages } from "./agent/session.js";
import type { RuntimeState } from "./repl/state.js";
import type { ChatMessage } from "./deepseek/types.js";

type Approver = (toolName: string, args: Record<string, unknown>) => Promise<boolean>;

interface ToolLogEntry {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: "running" | "done" | "denied";
  output?: string;
  isError?: boolean;
}

function TurnView({
  state,
  userText,
  askApproval,
  onDone,
}: {
  state: RuntimeState;
  userText: string;
  askApproval: Approver;
  onDone: () => void;
}) {
  const { exit } = useApp();
  const [reasoning, setReasoning] = useState("");
  const [content, setContent] = useState("");
  const [toolLog, setToolLog] = useState<ToolLogEntry[]>([]);
  const [pending, setPending] = useState<{ toolName: string; args: Record<string, unknown> } | null>(null);
  const [usageLine, setUsageLine] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    async function run(): Promise<void> {
      const userMsg: ChatMessage = { role: "user", content: userText };
      state.messages.push(userMsg);
      await appendSessionMessage(state.session, userMsg);

      const approve = async (toolName: string, args: Record<string, unknown>): Promise<boolean> => {
        if (state.autoApprove) {
          console.error(`[--yes] auto-odobreno: ${toolName}(${JSON.stringify(args)})`);
          return true;
        }
        setPending({ toolName, args });
        const approved = await askApproval(toolName, args);
        setPending(null);
        return approved;
      };

      const thinking = state.thinkingEnabled ? { reasoningEffort: state.reasoningEffort } : undefined;

      for await (const event of runAgentLoop(state.messages, {
        env: state.env,
        model: state.model,
        cwd: state.cwd,
        session: state.session,
        usage: state.usage,
        approve,
        ...(thinking !== undefined ? { thinking } : {}),
        ...(state.budgetUsd !== undefined ? { budgetUsd: state.budgetUsd } : {}),
      })) {
        handleEvent(event);
      }

      function handleEvent(event: AgentEvent): void {
        switch (event.type) {
          case "reasoning_delta":
            setReasoning((prev) => prev + event.delta);
            break;
          case "content_delta":
            setContent((prev) => prev + event.delta);
            break;
          case "tool_call_start":
            setToolLog((prev) => [...prev, { id: event.id, name: event.name, args: event.args, status: "running" }]);
            break;
          case "tool_call_result":
            setToolLog((prev) =>
              prev.map((t) =>
                t.id === event.id ? { ...t, status: "done", output: event.result.output, isError: event.result.isError } : t
              )
            );
            break;
          case "tool_call_denied":
            setToolLog((prev) => prev.map((t) => (t.id === event.id ? { ...t, status: "denied" } : t)));
            break;
          case "usage": {
            const total = state.usage.totals();
            setUsageLine(
              `tokens: ${total.promptTokens} in (${total.promptCacheHitTokens} cached) / ${total.completionTokens} out · ~$${state.usage.estimatedCostUsd().toFixed(4)} · ${state.usage.callCount} poziva`
            );
            break;
          }
          case "final":
            setContent(event.content);
            break;
          case "max_iterations_reached":
            setNotice("Dostignut je maksimalan broj iteracija bez finalnog odgovora.");
            break;
          case "budget_exceeded":
            setNotice(
              `Budžet od $${event.budgetUsd.toFixed(2)} je dostignut (potrošeno ~$${event.spentUsd.toFixed(4)}). Petlja je zaustavljena pre sledećeg poziva — sesija je sačuvana, poveci budžet sa /budget i nastavi.`
            );
            break;
        }
      }
    }

    run()
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        exit();
        onDone();
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Box flexDirection="column" gap={1}>
      {reasoning.length > 0 && (
        <Box flexDirection="column">
          <Text dimColor>thinking:</Text>
          <Text dimColor>{reasoning}</Text>
        </Box>
      )}

      {toolLog.map((t) => (
        <Box key={t.id} flexDirection="column">
          <Text color={t.status === "denied" ? "yellow" : t.isError ? "red" : "cyan"}>
            [{t.status === "running" ? "…" : t.status === "denied" ? "odbijeno" : "gotovo"}] {t.name}(
            {JSON.stringify(t.args)})
          </Text>
          {t.output && <Text dimColor>{t.output.slice(0, 500)}</Text>}
        </Box>
      ))}

      {pending && (
        <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
          <Text color="yellow" bold>
            Destruktivna akcija: {pending.toolName}({JSON.stringify(pending.args)})
          </Text>
          <Text dimColor>Odgovor se traži ispod, u redu za unos.</Text>
        </Box>
      )}

      {content.length > 0 && (
        <Box flexDirection="column">
          <Text bold>odgovor:</Text>
          <Text>{content}</Text>
        </Box>
      )}

      {usageLine && <Text color="gray">{usageLine}</Text>}
      {notice && <Text color="yellow">{notice}</Text>}
      {error && <Text color="red">Greška: {error}</Text>}
    </Box>
  );
}

async function runTurn(state: RuntimeState, userText: string, askApproval: Approver): Promise<void> {
  await new Promise<void>((resolve) => {
    render(<TurnView state={state} userText={userText} askApproval={askApproval} onDone={resolve} />);
  });
}

/** Za single-shot poteze: sopstveni for-await čitač linija samo za y/n odobrenja. */
function createLineApprover(): { approve: Approver; close: () => void } {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const resolveRef: { current: ((approved: boolean) => void) | null } = { current: null };

  const consumeLines = async (): Promise<void> => {
    for await (const rawLine of rl) {
      if (resolveRef.current) {
        resolveRef.current(rawLine.trim().toLowerCase() === "y");
        resolveRef.current = null;
      }
    }
  };
  void consumeLines();

  const approve: Approver = (toolName, args) => {
    console.log(`\nDozvoli izvršavanje ${toolName}(${JSON.stringify(args)})? (y/n)`);
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
    });
  };

  return { approve, close: () => rl.close() };
}

/**
 * `.question()` je nepouzdan na piped/non-TTY stdin-u posle prvog poziva
 * (poznata Node quirka — drugi poziv nikad ne razrešava). Zato se čitanje
 * linija radi isključivo preko `for await...of rl`, koje pouzdano isporučuje
 * svaku liniju, uz ručni state-machine za odobrenje umesto ugnježdenog
 * `.question()`.
 */
async function runRepl(state: RuntimeState): Promise<void> {
  console.log(`Tandem Mode — sesija ${state.session.id}. /help za komande, /exit za izlaz.\n`);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: "> " });
  let closed = false;
  rl.on("close", () => {
    closed = true;
  });
  const showPrompt = (): void => {
    if (!closed) rl.prompt();
  };

  const approvalRef: { current: ((approved: boolean) => void) | null } = { current: null };
  let turnActive = false;
  let lastTurn: Promise<void> = Promise.resolve();

  const askApproval: Approver = (toolName, args) => {
    console.log(`\nDozvoli izvršavanje ${toolName}(${JSON.stringify(args)})? (y/n)`);
    return new Promise<boolean>((resolve) => {
      approvalRef.current = resolve;
    });
  };

  showPrompt();

  for await (const rawLine of rl) {
    const line = rawLine.trim();

    if (approvalRef.current) {
      approvalRef.current(line.toLowerCase() === "y");
      approvalRef.current = null;
      continue;
    }

    if (!line) {
      showPrompt();
      continue;
    }

    if (turnActive) {
      console.log("Sačekaj da se trenutni potez završi.");
      continue;
    }

    if (line.startsWith("/")) {
      const outcome = await handleCommand(line, state);
      if (outcome === "exit") break;
      showPrompt();
      continue;
    }

    turnActive = true;
    lastTurn = runTurn(state, line, askApproval).finally(() => {
      turnActive = false;
      showPrompt();
    });
  }

  await lastTurn;
  if (!closed) rl.close();
}

interface ParsedArgv {
  prompt: string;
  resume: boolean;
  autoApprove: boolean;
  model?: "deepseek-v4-pro" | "deepseek-v4-flash";
  effort?: "low" | "high" | "max";
  budgetUsd?: number;
}

function parseArgv(argv: string[]): ParsedArgv {
  const rest: string[] = [];
  let resume = false;
  let autoApprove = false;
  let model: ParsedArgv["model"];
  let effort: ParsedArgv["effort"];
  let budgetUsd: number | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--resume" || arg === "-r") {
      resume = true;
    } else if (arg === "--yes" || arg === "-y") {
      autoApprove = true;
    } else if (arg === "--model") {
      const value = argv[++i];
      if (value === "deepseek-v4-pro" || value === "deepseek-v4-flash") model = value;
    } else if (arg === "--effort") {
      const value = argv[++i];
      if (value === "low" || value === "high" || value === "max") effort = value;
    } else if (arg === "--budget") {
      const value = Number(argv[++i]);
      if (Number.isFinite(value) && value > 0) budgetUsd = value;
    } else if (arg !== undefined) {
      rest.push(arg);
    }
  }

  const parsed: ParsedArgv = { prompt: rest.join(" ").trim(), resume, autoApprove };
  if (model !== undefined) parsed.model = model;
  if (effort !== undefined) parsed.effort = effort;
  if (budgetUsd !== undefined) parsed.budgetUsd = budgetUsd;
  return parsed;
}

async function main(): Promise<void> {
  const cwd = process.cwd();
  const parsed = parseArgv(process.argv.slice(2));

  const config = await loadConfig(cwd);
  let apiKey = await resolveApiKey();

  if (!apiKey) {
    if (!process.stdin.isTTY) {
      console.error(
        "Nema DeepSeek API ključa. Postavi DEEPSEEK_API_KEY env promenljivu ili pokreni tandem interaktivno da odradiš first-run wizard."
      );
      process.exitCode = 1;
      return;
    }
    const wizardConfig = await runFirstRunWizard();
    Object.assign(config, wizardConfig);
    apiKey = await resolveApiKey();
    if (!apiKey) {
      console.error("Ključ nije sačuvan ispravno — pokušaj ponovo.");
      process.exitCode = 1;
      return;
    }
  }

  const env = { apiKey, baseUrl: resolveBaseUrl(config) };

  let session;
  let messages: ChatMessage[];
  if (parsed.resume) {
    const existing = await findLatestSession(cwd);
    if (!existing) {
      console.error("Nema prethodne sesije za nastavak u ovom direktorijumu.");
      process.exitCode = 1;
      return;
    }
    session = existing;
    messages = await loadSessionMessages(existing.filePath);
  } else {
    session = await createSession(cwd);
    const systemMsg: ChatMessage = { role: "system", content: SYSTEM_PROMPT };
    messages = [systemMsg];
    await appendSessionMessage(session, systemMsg);
  }

  const state: RuntimeState = {
    env,
    cwd,
    model: parsed.model ?? config.defaultModel ?? DEFAULT_CONFIG.defaultModel,
    thinkingEnabled: true,
    reasoningEffort: parsed.effort ?? config.defaultReasoningEffort ?? DEFAULT_CONFIG.defaultReasoningEffort,
    autoApprove: parsed.autoApprove,
    session,
    messages,
    usage: new UsageAccumulator(),
  };
  const budgetUsd = parsed.budgetUsd ?? config.budgetUsd;
  if (budgetUsd !== undefined) state.budgetUsd = budgetUsd;

  if (parsed.prompt) {
    const approver = createLineApprover();
    await runTurn(state, parsed.prompt, approver.approve);
    approver.close();
  } else {
    await runRepl(state);
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
