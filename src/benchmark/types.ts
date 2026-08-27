import type { UsageInfo } from "../deepseek/types.js";

export type BenchmarkConfigName = "pro-only" | "flash-only" | "orchestration";

export interface BenchmarkTask {
  id: string;
  /** Prompt given to the agent, verbatim. */
  description: string;
  /** Za dimenziju 5 (nepotrebne izmene) — fajlovi koje bi razuman fix trebalo da dotakne. */
  expectedFiles: string[];
  /** Shell komanda koja vraća target repo na čisto polazno stanje pre poteza. */
  setup?: string;
  /** Npr. "php -l %file%" ili "npm run build". */
  build?: string;
  /** Npr. "npm test". */
  test?: string;
  /** Shell komanda koja izlazi sa 0 ako je zadatak stvarno ispunjen. */
  verify: string;
}

export interface BenchmarkResult {
  taskId: string;
  config: BenchmarkConfigName;
  completed: boolean;
  correct: boolean;
  buildPassed: boolean | null;
  testPassed: boolean | null;
  unnecessaryFileChanges: number;
  failedAttempts: number;
  selfCorrected: boolean;
  usage: UsageInfo;
  requestCount: number;
  costUsd: number;
  offPeakCostUsd: number;
  durationMs: number;
  /** Dimenzija 8 (arhitektura) je namerno kvalitativna — popunjava se ručno/naknadno, ne ovde. */
  architectureNotes?: string;
}
