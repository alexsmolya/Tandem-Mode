import React, { useEffect, useRef, useState } from "react";
import { render, Text, Box, useApp, useInput } from "ink";
import { loadEnv } from "./config/env.js";
import { runAgentLoop, type AgentEvent } from "./agent/loop.js";
import { UsageAccumulator } from "./agent/usage.js";
import {
  appendSessionMessage,
  createSession,
  findLatestSession,
  loadSessionMessages,
  type Session,
} from "./agent/session.js";
import type { ChatMessage } from "./deepseek/types.js";

const SYSTEM_PROMPT = `Ti si Tandem Mode, coding agent koji radi u realnom repozitorijumu.
Koristi alate (read_file, list_dir, search, edit, git_diff, shell) da istražiš
kod i uradiš zatraženu izmenu. Kad završiš zadatak, odgovori sažeto bez tool
poziva da se petlja zaustavi.`;

interface ToolLogEntry {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: "running" | "done" | "denied";
  output?: string;
  isError?: boolean;
}

interface PendingApproval {
  toolName: string;
  args: Record<string, unknown>;
  resolve: (approved: boolean) => void;
}

function App({
  prompt,
  cwd,
  resume,
  autoApprove,
}: {
  prompt: string;
  cwd: string;
  resume: boolean;
  autoApprove: boolean;
}): React.ReactElement {
  const { exit } = useApp();
  const [reasoning, setReasoning] = useState("");
  const [content, setContent] = useState("");
  const [toolLog, setToolLog] = useState<ToolLogEntry[]>([]);
  const [pending, setPending] = useState<PendingApproval | null>(null);
  const [usageLine, setUsageLine] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);
  const pendingRef = useRef<PendingApproval | null>(null);

  useInput(
    (input) => {
      if (!pendingRef.current) return;
      const lower = input.toLowerCase();
      if (lower === "y") {
        pendingRef.current.resolve(true);
        pendingRef.current = null;
        setPending(null);
      } else if (lower === "n") {
        pendingRef.current.resolve(false);
        pendingRef.current = null;
        setPending(null);
      }
    },
    // Aktivan samo kad stvarno čekamo unos, da ne traži raw-mode uzalud.
    { isActive: pending !== null }
  );

  useEffect(() => {
    async function run(): Promise<void> {
      const env = loadEnv();
      const usage = new UsageAccumulator();

      let session: Session;
      let messages: ChatMessage[];

      if (resume) {
        const existing = await findLatestSession(cwd);
        if (!existing) throw new Error("Nema prethodne sesije za nastavak u ovom direktorijumu.");
        session = existing;
        messages = await loadSessionMessages(existing.filePath);
        const userMsg: ChatMessage = { role: "user", content: prompt };
        messages.push(userMsg);
        await appendSessionMessage(session, userMsg);
      } else {
        session = await createSession(cwd);
        const systemMsg: ChatMessage = { role: "system", content: SYSTEM_PROMPT };
        const userMsg: ChatMessage = { role: "user", content: prompt };
        messages = [systemMsg, userMsg];
        await appendSessionMessage(session, systemMsg);
        await appendSessionMessage(session, userMsg);
      }

      const approve = (toolName: string, args: Record<string, unknown>): Promise<boolean> => {
        if (autoApprove) {
          // Upozorenje ide u stderr, van Ink render stabla.
          console.error(`[--yes] auto-odobreno: ${toolName}(${JSON.stringify(args)})`);
          return Promise.resolve(true);
        }
        return new Promise((resolve) => {
          const entry: PendingApproval = { toolName, args, resolve };
          pendingRef.current = entry;
          setPending(entry);
        });
      };

      const iterator = runAgentLoop(messages, {
        env,
        model: "deepseek-v4-pro",
        thinking: { reasoningEffort: "high" },
        cwd,
        session,
        usage,
        approve,
      });

      for await (const event of iterator) {
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
            setToolLog((prev) => [
              ...prev,
              { id: event.id, name: event.name, args: event.args, status: "running" },
            ]);
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
            const total = usage.totals();
            setUsageLine(
              `tokens: ${total.promptTokens} in (${total.promptCacheHitTokens} cached) / ${total.completionTokens} out · ~$${usage.estimatedCostUsd().toFixed(4)} · ${usage.callCount} poziva`
            );
            break;
          }
          case "final":
            setContent(event.content);
            break;
          case "max_iterations_reached":
            setError("Dostignut je maksimalan broj iteracija bez finalnog odgovora.");
            break;
        }
      }
    }

    run()
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
      })
      .finally(() => {
        setFinished(true);
        exit();
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
          <Text>Dozvoli? (y/n)</Text>
        </Box>
      )}

      <Box flexDirection="column">
        <Text bold>odgovor:</Text>
        <Text>{content}</Text>
      </Box>

      {usageLine && <Text color="gray">{usageLine}</Text>}
      {error && <Text color="red">Greška: {error}</Text>}
      {finished && !error && <Text color="green">✓ gotovo</Text>}
    </Box>
  );
}

const argv = process.argv.slice(2);
const flags = new Set(["--resume", "-r", "--yes", "-y"]);
const resume = argv.includes("--resume") || argv.includes("-r");
const autoApprove = argv.includes("--yes") || argv.includes("-y");
const prompt = argv.filter((a) => !flags.has(a)).join(" ").trim();

if (!prompt) {
  console.error('Upotreba: pnpm dev "zadatak" [--resume] [--yes]');
  process.exit(1);
}

render(<App prompt={prompt} cwd={process.cwd()} resume={resume} autoApprove={autoApprove} />);
