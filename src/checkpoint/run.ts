import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type GatingOptions, type ProtocolExecution, runProtocol } from "../protocol/engine.js";
import type { MarConfig } from "../schema/config.js";
import type { ExecutionMetadata } from "../schema/manifest.js";
import { runDir as layoutRunDir, newRunId } from "../workspace/layout.js";
import { createRun, readManifest } from "../workspace/manifest.js";
import { renderImplementationCheckpointInput, renderPlanCheckpointInput } from "./input.js";
import {
  type CheckpointMode,
  type CheckpointStage,
  CheckpointVerdict,
  type CheckpointVerdict as CheckpointVerdictType,
  shouldBlock,
} from "./schema.js";
import { extractVerdictFromMarkdown, writeVerdict } from "./verdict.js";

export interface RunCheckpointOptions {
  cwd: string;
  stage: CheckpointStage;
  point: string;
  mode: CheckpointMode;
  config: MarConfig;
  outDir: string;
  phaseDir?: string;
  planFiles?: string[];
  baseRef?: string;
  diffText?: string;
  summaries?: string[];
  gating?: GatingOptions;
  execution?: ProtocolExecution;
}

export interface RunCheckpointResult {
  exitCode: number;
  checkpointDir: string;
  verdict: CheckpointVerdictType;
  runDir: string;
}

async function renderCheckpointInput(opts: RunCheckpointOptions): Promise<string> {
  if (opts.stage === "plan") {
    if (opts.phaseDir === undefined) {
      throw new Error("plan checkpoint requires phaseDir");
    }
    return renderPlanCheckpointInput({
      phaseDir: opts.phaseDir,
      planFiles: opts.planFiles ?? [],
    });
  }

  if (opts.stage === "implementation") {
    return renderImplementationCheckpointInput({
      baseRef: opts.baseRef ?? "HEAD",
      diffText: opts.diffText ?? "",
      summaries: opts.summaries ?? [],
    });
  }

  throw new Error(`unsupported checkpoint stage "${opts.stage}"`);
}

function integrationExcerpt(markdown: string): string {
  const trimmed = markdown.trim();
  if (trimmed.length <= 4_000) {
    return trimmed;
  }
  return `${trimmed.slice(0, 4_000)}\n\n...`;
}

function blockerList(verdict: CheckpointVerdictType): string {
  if (verdict.blockers.length === 0) {
    return "- none";
  }
  return verdict.blockers
    .map(
      (blocker) =>
        `- ${blocker.id} [${blocker.severity}] ${blocker.title}\n  Recommendation: ${blocker.recommendation}`,
    )
    .join("\n");
}

function failureVerdict(
  opts: RunCheckpointOptions,
  runId: string,
  summaryPath: string,
  reason: string,
  title = "MAR checkpoint protocol did not produce an integration artifact",
): CheckpointVerdictType {
  return CheckpointVerdict.parse({
    schemaVersion: 1,
    stage: opts.stage,
    point: opts.point,
    mode: opts.mode,
    status: "error",
    runId,
    summaryPath,
    blockers: [
      {
        id: "MAR-CHECKPOINT-PROTOCOL-ERROR",
        severity: "critical",
        title,
        evidence: [reason],
        recommendation: "Ask the user before proceeding; the checkpoint review did not complete.",
      },
    ],
    warnings: [],
    nextAction: "ask_user",
    createdAt: new Date().toISOString(),
  });
}

function fullVerdict(
  opts: RunCheckpointOptions,
  runId: string,
  summaryPath: string,
  markdown: string,
): CheckpointVerdictType {
  const extracted = extractVerdictFromMarkdown(markdown);
  return CheckpointVerdict.parse({
    schemaVersion: 1,
    stage: opts.stage,
    point: opts.point,
    mode: opts.mode,
    status: extracted.status,
    runId,
    summaryPath,
    blockers: extracted.blockers,
    warnings: extracted.warnings,
    nextAction: extracted.nextAction,
    createdAt: new Date().toISOString(),
  });
}

function manifestExecution(execution: ProtocolExecution): ExecutionMetadata {
  const terminalMode = execution.terminalMode ?? "headless";
  return {
    repoAware: execution.repoAware !== undefined,
    ...(execution.repoAware !== undefined
      ? {
          sourceRepoRoot: execution.repoAware.sourceRepoRoot,
          sourceCommit: execution.repoAware.sourceCommit,
        }
      : {}),
    terminalMode,
    worktrees: [],
  };
}

async function writeSummary(opts: {
  summaryPath: string;
  runDir: string;
  integrationPath?: string;
  integrationMarkdown?: string;
  protocolExitCode: number;
  verdict: CheckpointVerdictType;
  manifestStatus?: string;
}): Promise<void> {
  const integrationSection =
    opts.integrationPath && opts.integrationMarkdown !== undefined
      ? `## Integration Artifact

Path: ${opts.integrationPath}

\`\`\`markdown
${integrationExcerpt(opts.integrationMarkdown)}
\`\`\``
      : `## Integration Artifact

No integration artifact was produced.`;

  await writeFile(
    opts.summaryPath,
    `# MAR Checkpoint Summary

Run directory: ${opts.runDir}
Protocol exit code: ${opts.protocolExitCode}
${opts.manifestStatus ? `Manifest status: ${opts.manifestStatus}\n` : ""}
Checkpoint status: ${opts.verdict.status}
Next action: ${opts.verdict.nextAction}

${integrationSection}

## Blockers

${blockerList(opts.verdict)}
`,
    "utf8",
  );
}

export async function runCheckpoint(opts: RunCheckpointOptions): Promise<RunCheckpointResult> {
  const checkpointId = newRunId();
  const checkpointDir = join(opts.outDir, checkpointId);
  await mkdir(checkpointDir, { recursive: true });

  const input = await renderCheckpointInput(opts);
  const inputPath = join(checkpointDir, "input.md");
  await writeFile(inputPath, input, "utf8");

  const runId = newRunId();
  const protocolRunDir = join(opts.cwd, layoutRunDir(runId));
  await createRun({
    runDir: protocolRunDir,
    runId,
    status: "running",
    inputPath,
    ...(opts.execution !== undefined ? { execution: manifestExecution(opts.execution) } : {}),
  });

  const protocolExitCode = await runProtocol(
    protocolRunDir,
    opts.config,
    inputPath,
    opts.gating,
    opts.execution,
  );
  const manifest = await readManifest(protocolRunDir);
  const integrationArtifact = [...manifest.artifacts]
    .reverse()
    .find((artifact) => artifact.kind === "integration");
  const integrationPath =
    integrationArtifact !== undefined ? join(protocolRunDir, integrationArtifact.path) : undefined;
  const summaryPath = join(checkpointDir, "summary.md");

  let verdict: CheckpointVerdictType;
  let integrationMarkdown: string | undefined;
  if (protocolExitCode !== 0 || integrationPath === undefined || manifest.status !== "completed") {
    const terminalReason =
      manifest.status === "completed"
        ? "terminal protocol status with missing integration artifact"
        : `protocol manifest status was "${manifest.status}"`;
    verdict = failureVerdict(
      opts,
      runId,
      summaryPath,
      protocolExitCode !== 0
        ? `protocol exited with code ${protocolExitCode}; ${terminalReason}`
        : terminalReason,
      manifest.status === "escalated"
        ? "MAR checkpoint protocol escalated without consensus"
        : undefined,
    );
  } else {
    integrationMarkdown = await readFile(integrationPath, "utf8");
    try {
      verdict = fullVerdict(opts, runId, summaryPath, integrationMarkdown);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      verdict = failureVerdict(
        opts,
        runId,
        summaryPath,
        `integration verdict was invalid: ${message}`,
        "MAR checkpoint verdict was invalid",
      );
    }
  }

  await writeSummary({
    summaryPath,
    runDir: protocolRunDir,
    integrationPath,
    integrationMarkdown,
    protocolExitCode,
    verdict,
    manifestStatus: manifest.status,
  });
  const parsed = CheckpointVerdict.parse(verdict);
  await writeFile(
    join(checkpointDir, "verdict.json"),
    `${JSON.stringify(parsed, null, 2)}\n`,
    "utf8",
  );
  await writeVerdict(opts.outDir, parsed);

  return {
    exitCode: shouldBlock(parsed) ? 2 : protocolExitCode !== 0 ? protocolExitCode : 0,
    checkpointDir,
    verdict: parsed,
    runDir: protocolRunDir,
  };
}
