import { mkdir, appendFile, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { ChatMessage } from "../deepseek/types.js";

const SESSIONS_DIR = ".tandem/sessions";

export interface Session {
  id: string;
  filePath: string;
}

function sessionsDir(cwd: string): string {
  return path.join(cwd, SESSIONS_DIR);
}

export async function createSession(cwd: string): Promise<Session> {
  const dir = sessionsDir(cwd);
  await mkdir(dir, { recursive: true });
  const id = new Date().toISOString().replace(/[:.]/g, "-") + "-" + Math.random().toString(36).slice(2, 8);
  return { id, filePath: path.join(dir, `${id}.jsonl`) };
}

export async function appendSessionMessage(session: Session, message: ChatMessage): Promise<void> {
  await appendFile(session.filePath, JSON.stringify(message) + "\n", "utf8");
}

export async function loadSessionMessages(filePath: string): Promise<ChatMessage[]> {
  const raw = await readFile(filePath, "utf8");
  return raw
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as ChatMessage);
}

export async function findLatestSession(cwd: string): Promise<Session | null> {
  const dir = sessionsDir(cwd);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return null;
  }

  const jsonlFiles = entries.filter((f) => f.endsWith(".jsonl"));
  if (jsonlFiles.length === 0) return null;

  const withMtime = await Promise.all(
    jsonlFiles.map(async (f) => ({ f, mtime: (await stat(path.join(dir, f))).mtimeMs }))
  );
  withMtime.sort((a, b) => b.mtime - a.mtime);
  const latest = withMtime[0];
  if (!latest) return null;

  const id = latest.f.replace(/\.jsonl$/, "");
  return { id, filePath: path.join(dir, latest.f) };
}
