export interface PlanTask {
  id: string;
  description: string;
  files: string[];
  acceptanceCriteria: string;
}

export interface Plan {
  summary: string;
  tasks: PlanTask[];
}

export interface ReviewCorrection {
  description: string;
  files: string[];
}

export interface ReviewResult {
  approved: boolean;
  notes: string;
  corrections: ReviewCorrection[];
}

export function isPlan(value: unknown): value is Plan {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v["summary"] === "string" &&
    Array.isArray(v["tasks"]) &&
    v["tasks"].every(
      (t) =>
        typeof t === "object" &&
        t !== null &&
        typeof (t as Record<string, unknown>)["id"] === "string" &&
        typeof (t as Record<string, unknown>)["description"] === "string"
    )
  );
}

export function isReviewResult(value: unknown): value is ReviewResult {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v["approved"] === "boolean";
}
