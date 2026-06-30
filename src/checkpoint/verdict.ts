import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  CheckpointBlocker,
  type CheckpointBlocker as CheckpointBlockerType,
  CheckpointNextAction,
  type CheckpointNextAction as CheckpointNextActionType,
  CheckpointSeverity,
  CheckpointStatus,
  type CheckpointStatus as CheckpointStatusType,
  CheckpointVerdict,
  type CheckpointVerdict as CheckpointVerdictType,
  shouldBlock,
} from "./schema.js";

export type ExtractedCheckpointVerdict = Partial<CheckpointVerdictType> & {
  status: CheckpointStatusType;
  blockers: CheckpointBlockerType[];
  warnings: CheckpointBlockerType[];
  nextAction: CheckpointNextActionType;
};

const VERDICT_FENCE_RE = /^```mar-verdict-json[ \t]*\r?\n([\s\S]*?)\r?\n```[ \t]*(?=\r?\n|$)/gm;

function failClosed(title: string, recommendation: string): ExtractedCheckpointVerdict {
  return {
    status: "error",
    blockers: [
      {
        id: "MAR-CHECKPOINT-ERROR",
        severity: "critical",
        title,
        evidence: [],
        recommendation,
      },
    ],
    warnings: [],
    nextAction: "ask_user",
  };
}

function usefulText(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return fallback;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry) => usefulText(entry, "")).filter((entry) => entry.length > 0);
}

function normalizeBlocker(
  value: unknown,
  index: number,
  kind: "blocker" | "warning",
): CheckpointBlockerType | undefined {
  const fallbackId = kind === "blocker" ? `MAR-BLOCKER-${index + 1}` : `MAR-WARNING-${index + 1}`;
  const fallbackText = kind === "blocker" ? "Checkpoint blocker" : "Checkpoint warning";
  const defaultSeverity = kind === "blocker" ? "high" : "medium";

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    const text = usefulText(value, fallbackText);
    return {
      id: fallbackId,
      severity: defaultSeverity,
      title: text,
      evidence: [],
      recommendation: text,
    };
  }

  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return kind === "blocker"
      ? {
          id: fallbackId,
          severity: defaultSeverity,
          title: fallbackText,
          evidence: [],
          recommendation: "Review the malformed checkpoint blocker entry.",
        }
      : undefined;
  }

  const record = value as Record<string, unknown>;
  const title = usefulText(record.title ?? record.message ?? record.description, fallbackText);
  const recommendation = usefulText(
    record.recommendation ?? record.action ?? record.fix ?? record.remediation,
    title,
  );
  const candidate = {
    id: usefulText(record.id, fallbackId),
    severity: CheckpointSeverity.safeParse(record.severity).success
      ? (record.severity as CheckpointBlockerType["severity"])
      : defaultSeverity,
    title,
    evidence: stringArray(record.evidence),
    recommendation,
  };

  const parsed = CheckpointBlocker.safeParse(candidate);
  if (parsed.success) {
    return parsed.data;
  }
  return kind === "blocker"
    ? {
        id: fallbackId,
        severity: defaultSeverity,
        title,
        evidence: [],
        recommendation,
      }
    : undefined;
}

function normalizeBlockers(value: unknown, kind: "blocker" | "warning"): CheckpointBlockerType[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry, index) => normalizeBlocker(entry, index, kind))
    .filter((entry): entry is CheckpointBlockerType => entry !== undefined);
}

function hasBlockingSeverity(blockers: CheckpointBlockerType[]): boolean {
  return blockers.some((blocker) => blocker.severity === "critical" || blocker.severity === "high");
}

export function extractVerdictFromMarkdown(markdown: string): ExtractedCheckpointVerdict {
  const matches = [...markdown.matchAll(VERDICT_FENCE_RE)];
  if (matches.length === 0) {
    return failClosed(
      "Missing machine-readable verdict fenced block",
      "Ask the reviewer to return a mar-verdict-json fenced block.",
    );
  }
  if (matches.length > 1) {
    return failClosed(
      "Multiple machine-readable verdict fenced blocks",
      "Ask the reviewer to return exactly one mar-verdict-json fenced block.",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(matches[0][1] ?? "");
  } catch {
    return failClosed(
      "Malformed machine-readable verdict JSON",
      "Ask the reviewer to return valid JSON in the mar-verdict-json fenced block.",
    );
  }

  const record =
    parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  const verdict = record as Record<string, unknown>;
  let status = CheckpointStatus.safeParse(verdict.status).success
    ? (verdict.status as CheckpointStatusType)
    : "error";
  const blockers = normalizeBlockers(verdict.blockers, "blocker");
  const warnings = normalizeBlockers(verdict.warnings, "warning");

  if (verdict.blockers !== undefined && !Array.isArray(verdict.blockers)) {
    return failClosed(
      "Malformed machine-readable verdict blockers",
      "Ask the reviewer to provide blockers as an array of structured blocker entries.",
    );
  }
  if (status === "block" && blockers.length === 0) {
    return failClosed(
      "Malformed machine-readable verdict blockers",
      "Ask the reviewer to provide at least one structured blocker for a block verdict.",
    );
  }
  if ((status === "pass" || status === "warn") && hasBlockingSeverity(blockers)) {
    status = "error";
  }

  const parsedNextAction = CheckpointNextAction.safeParse(verdict.nextAction);
  const nextAction =
    status === "block" || status === "error"
      ? parsedNextAction.success && parsedNextAction.data !== "none"
        ? parsedNextAction.data
        : "ask_user"
      : parsedNextAction.success
        ? parsedNextAction.data
        : "none";

  return {
    ...verdict,
    status,
    blockers,
    warnings,
    nextAction,
  };
}

export async function writeVerdict(
  outDir: string,
  verdict: CheckpointVerdictType,
): Promise<string> {
  const parsed = CheckpointVerdict.parse(verdict);
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, "latest.json");
  writeFileSync(outPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
  return outPath;
}

export function gateExitCode(verdictPath: string): number {
  try {
    const verdict = CheckpointVerdict.parse(JSON.parse(readFileSync(verdictPath, "utf8")));
    return shouldBlock(verdict) ? 2 : 0;
  } catch {
    return 1;
  }
}
