import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative } from "node:path";

export interface PlanCheckpointInputOptions {
  phaseDir: string;
  planFiles: string[];
}

export interface ImplementationCheckpointInputOptions {
  baseRef: string;
  diffText: string;
  summaries: string[];
}

const VERDICT_INSTRUCTIONS = `## Final Verdict

Return your final machine-readable verdict in exactly one fenced block named \`mar-verdict-json\`.

The JSON in that block must include: \`status\`, \`blockers\`, \`warnings\`, and \`nextAction\`.
Use \`status: "pass"\`, \`blockers: []\`, \`warnings: []\`, and \`nextAction: "none"\` only when there are no blocking findings.
`;

function markdownFenceFor(text: string): string {
  const runs = text.match(/`{3,}/g) ?? [];
  const longest = runs.reduce((max, run) => Math.max(max, run.length), 2);
  return "`".repeat(longest + 1);
}

function neutralizeEmbeddedFences(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => (line.startsWith("```") ? ` ${line}` : line))
    .join("\n");
}

async function assertInsidePhaseDir(phaseDir: string, planFile: string): Promise<string> {
  const [phaseRoot, filePath] = await Promise.all([realpath(phaseDir), realpath(planFile)]);
  const rel = relative(phaseRoot, filePath);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`plan file "${planFile}" is outside phase directory "${phaseDir}"`);
  }
  return filePath;
}

export async function renderPlanCheckpointInput(opts: PlanCheckpointInputOptions): Promise<string> {
  const planContents = await Promise.all(
    opts.planFiles.map(async (planFile) => {
      const filePath = await assertInsidePhaseDir(opts.phaseDir, planFile);
      return {
        path: planFile,
        content: await readFile(filePath, "utf8"),
      };
    }),
  );

  const filesText =
    planContents.length === 0
      ? "- none"
      : planContents
          .map((plan) => {
            const content = neutralizeEmbeddedFences(plan.content);
            const fence = markdownFenceFor(content);
            return `## Plan File: ${plan.path}

${fence}markdown
${content}
${fence}`;
          })
          .join("\n\n");

  return `# MAR Checkpoint Review: plan

phase directory: ${opts.phaseDir}

Review the plan artifacts below. Find blockers a non-coder user would miss, especially hidden implementation risk, ambiguous acceptance criteria, missing rollback or verification paths, and decisions that would force the user to approve work without enough context.

${filesText}

${VERDICT_INSTRUCTIONS}`;
}

export async function renderImplementationCheckpointInput(
  opts: ImplementationCheckpointInputOptions,
): Promise<string> {
  const summariesText =
    opts.summaries.length === 0
      ? "- none"
      : opts.summaries.map((summary) => `- ${summary}`).join("\n");

  const diffText = neutralizeEmbeddedFences(opts.diffText);
  const diffFence = markdownFenceFor(diffText);

  return `# MAR Checkpoint Review: implementation

base ref: ${opts.baseRef}

Review the implementation against the base ref, summaries, and diff. Find blockers a non-coder user would miss, especially changes that do not match the plan, hidden data-loss risk, missing tests, weak verification, or user-impacting behavior not called out in the summaries.

## Summaries

${summariesText}

## Diff

${diffFence}diff
${diffText}
${diffFence}

${VERDICT_INSTRUCTIONS}`;
}
