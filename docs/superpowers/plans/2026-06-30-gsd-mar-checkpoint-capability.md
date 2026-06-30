# GSD MAR Checkpoint Capability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a GSD-first MAR checkpoint layer that can block GSD plan and implementation boundaries using MAR's existing multi-agent review protocol.

**Architecture:** MAR remains the review engine. New checkpoint modules build review inputs, run the existing protocol, extract a machine-readable verdict, and write deterministic checkpoint artifacts. A GSD installer emits a project-scoped capability overlay that calls those checkpoint commands from GSD loop points.

**Tech Stack:** TypeScript, Node 22, commander, zod, fs-extra, Vitest, existing MAR protocol/workspace modules.

---

## File Structure

- Create `src/checkpoint/schema.ts`: stage/mode/status enums, `CheckpointVerdict` schema, config types.
- Create `src/checkpoint/verdict.ts`: extract, normalize, persist, and gate verdicts.
- Create `src/checkpoint/input.ts`: render checkpoint request documents for plan and implementation stages.
- Create `src/checkpoint/run.ts`: orchestrate checkpoint run, call `runProtocol`, write checkpoint artifacts.
- Create `src/gsd/install.ts`: emit a GSD project capability overlay and optional install instructions.
- Modify `src/cli.ts`: add `mar checkpoint ...` and `mar gsd install` command families.
- Modify `src/schema/config.ts`: add optional `checkpoint` defaults if needed.
- Create `test/checkpoint-schema.test.ts`.
- Create `test/checkpoint-verdict.test.ts`.
- Create `test/checkpoint-input.test.ts`.
- Create `test/checkpoint-run.test.ts`.
- Create `test/gsd-install.test.ts`.
- Update `README.md`: document GSD-first checkpoint setup.

## Task 1: Checkpoint Schema

**Files:**
- Create: `src/checkpoint/schema.ts`
- Test: `test/checkpoint-schema.test.ts`

- [ ] **Step 1: Write the failing schema tests**

```ts
import { describe, expect, it } from "vitest";
import {
  CheckpointMode,
  CheckpointStage,
  CheckpointVerdict,
  shouldBlock,
} from "../src/checkpoint/schema.js";

describe("Checkpoint schema", () => {
  it("accepts a minimal passing verdict", () => {
    const parsed = CheckpointVerdict.parse({
      schemaVersion: 1,
      stage: "plan",
      point: "plan:post",
      mode: "required",
      status: "pass",
      runId: "20260630-abc123",
      summaryPath: ".planning/mar-checkpoints/plan-post/20260630-abc123/summary.md",
      blockers: [],
      warnings: [],
      nextAction: "none",
      createdAt: "2026-06-30T00:00:00.000Z",
    });

    expect(parsed.stage).toBe("plan");
    expect(shouldBlock(parsed)).toBe(false);
  });

  it("blocks required high-severity blocker verdicts", () => {
    const parsed = CheckpointVerdict.parse({
      schemaVersion: 1,
      stage: "implementation",
      point: "execute:post",
      mode: "required",
      status: "block",
      runId: "20260630-abc123",
      summaryPath: "summary.md",
      blockers: [
        {
          id: "MAR-BLOCKER-001",
          severity: "high",
          title: "Missing rollback",
          evidence: ["src/db/migrate.ts:42"],
          recommendation: "Add rollback acceptance criteria.",
        },
      ],
      warnings: [],
      nextAction: "ask_user",
      createdAt: "2026-06-30T00:00:00.000Z",
    });

    expect(shouldBlock(parsed)).toBe(true);
  });

  it("does not block advisory mode even when status is block", () => {
    const parsed = CheckpointVerdict.parse({
      schemaVersion: 1,
      stage: "plan",
      point: "plan:post",
      mode: "advisory",
      status: "block",
      runId: "20260630-abc123",
      summaryPath: "summary.md",
      blockers: [
        {
          id: "MAR-BLOCKER-001",
          severity: "critical",
          title: "Bad plan",
          evidence: [],
          recommendation: "Rewrite the plan.",
        },
      ],
      warnings: [],
      nextAction: "ask_user",
      createdAt: "2026-06-30T00:00:00.000Z",
    });

    expect(shouldBlock(parsed)).toBe(false);
  });

  it("keeps the stage and mode vocabularies closed", () => {
    expect(CheckpointStage.options).toEqual([
      "intent",
      "spec",
      "plan",
      "implementation",
      "verification",
      "ship",
    ]);
    expect(CheckpointMode.options).toEqual(["required", "advisory"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/checkpoint-schema.test.ts`

Expected: FAIL because `src/checkpoint/schema.ts` does not exist.

- [ ] **Step 3: Implement the schema**

```ts
import { z } from "zod";

export const CheckpointStage = z.enum([
  "intent",
  "spec",
  "plan",
  "implementation",
  "verification",
  "ship",
]);

export const CheckpointMode = z.enum(["required", "advisory"]);

export const CheckpointStatus = z.enum(["pass", "warn", "block", "waived", "error"]);

export const CheckpointSeverity = z.enum(["critical", "high", "medium", "low", "info"]);

export const CheckpointBlocker = z.object({
  id: z.string().min(1),
  severity: CheckpointSeverity,
  title: z.string().min(1),
  evidence: z.array(z.string()).default([]),
  recommendation: z.string().min(1),
});

export const CheckpointVerdict = z.object({
  schemaVersion: z.literal(1),
  stage: CheckpointStage,
  point: z.string().min(1),
  mode: CheckpointMode,
  status: CheckpointStatus,
  runId: z.string().min(1),
  summaryPath: z.string().min(1),
  blockers: z.array(CheckpointBlocker).default([]),
  warnings: z.array(CheckpointBlocker).default([]),
  nextAction: z.enum(["none", "ask_user", "auto_fix", "rerun"]).default("none"),
  createdAt: z.string().datetime(),
  waiver: z
    .object({
      reason: z.string().min(1),
      waivedAt: z.string().datetime(),
    })
    .optional(),
});

export type CheckpointStage = z.infer<typeof CheckpointStage>;
export type CheckpointMode = z.infer<typeof CheckpointMode>;
export type CheckpointVerdict = z.infer<typeof CheckpointVerdict>;

export function shouldBlock(verdict: CheckpointVerdict): boolean {
  if (verdict.mode !== "required") return false;
  if (verdict.status === "error") return true;
  if (verdict.status !== "block") return false;
  return verdict.blockers.some(
    (b) => b.severity === "critical" || b.severity === "high",
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/checkpoint-schema.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/checkpoint/schema.ts test/checkpoint-schema.test.ts
git commit -m "feat: add checkpoint verdict schema"
```

## Task 2: Verdict Extraction and Gate Command Logic

**Files:**
- Create: `src/checkpoint/verdict.ts`
- Test: `test/checkpoint-verdict.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  extractVerdictFromMarkdown,
  gateExitCode,
  writeVerdict,
} from "../src/checkpoint/verdict.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mar-verdict-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("checkpoint verdict extraction", () => {
  it("extracts the mar-verdict-json fenced block", () => {
    const verdict = extractVerdictFromMarkdown(`
# Integrated Review

\`\`\`mar-verdict-json
{"status":"block","blockers":[{"id":"MAR-BLOCKER-001","severity":"high","title":"Bad plan","evidence":["x.ts:1"],"recommendation":"Fix it."}],"warnings":[],"nextAction":"ask_user"}
\`\`\`
`);

    expect(verdict.status).toBe("block");
    expect(verdict.blockers[0].id).toBe("MAR-BLOCKER-001");
  });

  it("fails closed when the block is absent", () => {
    const verdict = extractVerdictFromMarkdown("# No structured verdict");
    expect(verdict.status).toBe("error");
    expect(verdict.blockers[0].title).toContain("machine-readable verdict");
  });

  it("writes latest.json and returns required block exit code 2", async () => {
    const written = await writeVerdict(dir, {
      schemaVersion: 1,
      stage: "plan",
      point: "plan:post",
      mode: "required",
      status: "block",
      runId: "run-1",
      summaryPath: "summary.md",
      blockers: [
        {
          id: "MAR-BLOCKER-001",
          severity: "high",
          title: "Bad plan",
          evidence: [],
          recommendation: "Fix it.",
        },
      ],
      warnings: [],
      nextAction: "ask_user",
      createdAt: "2026-06-30T00:00:00.000Z",
    });

    expect(readFileSync(join(dir, "latest.json"), "utf8")).toContain("MAR-BLOCKER-001");
    expect(written).toBe(join(dir, "latest.json"));
    expect(gateExitCode(join(dir, "latest.json"))).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/checkpoint-verdict.test.ts`

Expected: FAIL because `src/checkpoint/verdict.ts` does not exist.

- [ ] **Step 3: Implement verdict extraction and gate behavior**

```ts
import { mkdir, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CheckpointVerdict, shouldBlock } from "./schema.js";

const FENCE_RE = /```mar-verdict-json\s*([\s\S]*?)```/m;

export function extractVerdictFromMarkdown(markdown: string): Pick<
  CheckpointVerdict,
  "status" | "blockers" | "warnings" | "nextAction"
> {
  const match = FENCE_RE.exec(markdown);
  if (!match) {
    return failClosed("MAR produced no machine-readable verdict");
  }
  try {
    const parsed = JSON.parse(match[1]);
    const status = parsed.status === "pass" || parsed.status === "warn" || parsed.status === "block"
      ? parsed.status
      : "error";
    return {
      status,
      blockers: Array.isArray(parsed.blockers) ? parsed.blockers : [],
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
      nextAction: parsed.nextAction ?? (status === "block" ? "ask_user" : "none"),
    };
  } catch {
    return failClosed("MAR produced malformed machine-readable verdict JSON");
  }
}

function failClosed(title: string): Pick<
  CheckpointVerdict,
  "status" | "blockers" | "warnings" | "nextAction"
> {
  return {
    status: "error",
    blockers: [
      {
        id: "MAR-BLOCKER-STRUCTURE",
        severity: "critical",
        title,
        evidence: [],
        recommendation: "Rerun the checkpoint or inspect the MAR run artifacts manually.",
      },
    ],
    warnings: [],
    nextAction: "ask_user",
  };
}

export async function writeVerdict(outDir: string, verdict: CheckpointVerdict): Promise<string> {
  const parsed = CheckpointVerdict.parse(verdict);
  await mkdir(outDir, { recursive: true });
  const target = join(outDir, "latest.json");
  await writeFile(target, JSON.stringify(parsed, null, 2) + "\n", "utf8");
  return target;
}

export function gateExitCode(verdictPath: string): number {
  try {
    const verdict = CheckpointVerdict.parse(JSON.parse(readFileSync(verdictPath, "utf8")));
    return shouldBlock(verdict) ? 2 : 0;
  } catch {
    return 1;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/checkpoint-verdict.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/checkpoint/verdict.ts test/checkpoint-verdict.test.ts
git commit -m "feat: add checkpoint verdict extraction"
```

## Task 3: Checkpoint Input Rendering

**Files:**
- Create: `src/checkpoint/input.ts`
- Test: `test/checkpoint-input.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  renderImplementationCheckpointInput,
  renderPlanCheckpointInput,
} from "../src/checkpoint/input.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mar-checkpoint-input-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("checkpoint input rendering", () => {
  it("renders plan files with verdict instructions", async () => {
    const phaseDir = join(dir, "phase");
    writeFileSync(join(dir, "plan.md"), "# Plan\n\nTouch src/a.ts\n", "utf8");

    const input = await renderPlanCheckpointInput({
      phaseDir,
      planFiles: [join(dir, "plan.md")],
    });

    expect(input).toContain("# MAR Checkpoint Review: plan");
    expect(input).toContain("Touch src/a.ts");
    expect(input).toContain("```mar-verdict-json");
  });

  it("renders implementation diff text and summaries", async () => {
    const input = await renderImplementationCheckpointInput({
      baseRef: "main",
      diffText: "diff --git a/src/a.ts b/src/a.ts\n+const ok = true;\n",
      summaries: ["Implemented parser changes."],
    });

    expect(input).toContain("# MAR Checkpoint Review: implementation");
    expect(input).toContain("base ref: main");
    expect(input).toContain("+const ok = true;");
    expect(input).toContain("Implemented parser changes.");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/checkpoint-input.test.ts`

Expected: FAIL because `src/checkpoint/input.ts` does not exist.

- [ ] **Step 3: Implement renderers**

```ts
import { readFile } from "node:fs/promises";

export interface PlanCheckpointInputOptions {
  phaseDir: string;
  planFiles: string[];
}

export interface ImplementationCheckpointInputOptions {
  baseRef: string;
  diffText: string;
  summaries: string[];
}

const VERDICT_INSTRUCTIONS = [
  "## Required final verdict",
  "",
  "The integrated final answer MUST contain exactly one fenced block named `mar-verdict-json`.",
  "The JSON inside must include status, blockers, warnings, and nextAction.",
  "",
  "```mar-verdict-json",
  "{\"status\":\"pass\",\"blockers\":[],\"warnings\":[],\"nextAction\":\"none\"}",
  "```",
].join("\n");

export async function renderPlanCheckpointInput(opts: PlanCheckpointInputOptions): Promise<string> {
  const sections = await Promise.all(
    opts.planFiles.map(async (file) => {
      const text = await readFile(file, "utf8");
      return `## Plan File: ${file}\n\n${text}`;
    }),
  );
  return [
    "# MAR Checkpoint Review: plan",
    "",
    `Phase directory: ${opts.phaseDir}`,
    "",
    "Review these GSD plan artifacts before execution. Find blockers a non-coder user would miss.",
    "",
    ...sections,
    "",
    VERDICT_INSTRUCTIONS,
  ].join("\n");
}

export async function renderImplementationCheckpointInput(
  opts: ImplementationCheckpointInputOptions,
): Promise<string> {
  return [
    "# MAR Checkpoint Review: implementation",
    "",
    `base ref: ${opts.baseRef}`,
    "",
    "Review the implementation diff and summaries for bugs, regressions, missing tests, and plan drift.",
    "",
    "## Summaries",
    "",
    opts.summaries.length > 0 ? opts.summaries.map((s) => `- ${s}`).join("\n") : "- none",
    "",
    "## Diff",
    "",
    "```diff",
    opts.diffText,
    "```",
    "",
    VERDICT_INSTRUCTIONS,
  ].join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/checkpoint-input.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/checkpoint/input.ts test/checkpoint-input.test.ts
git commit -m "feat: render checkpoint review inputs"
```

## Task 4: Checkpoint Runner

**Files:**
- Create: `src/checkpoint/run.ts`
- Test: `test/checkpoint-run.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCheckpoint } from "../src/checkpoint/run.js";
import { MarConfig } from "../src/schema/config.js";

vi.setConfig({ testTimeout: 60_000 });

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mar-checkpoint-run-"));
  process.env.MAR_EMIT_BASE = "claude";
});

afterEach(() => {
  delete process.env.MAR_EMIT_BASE;
  rmSync(dir, { recursive: true, force: true });
});

describe("runCheckpoint", () => {
  it("writes input, summary, run id, and verdict artifacts", async () => {
    const fake = join(dir, "fake.mjs");
    writeFileSync(
      fake,
      `
const isCodex = process.argv[2] === "exec";
const author = isCodex ? "codex" : "claude";
const text = process.argv.join(" ");
const phase = /\\\\[phase:([a-z]+)\\\\]/.exec(text)?.[1] ?? "draft";
function body() {
  if (phase === "integration") {
    return "---\\\\nphase: integration\\\\nauthor: " + author + "\\\\nbase: claude\\\\nadditions: []\\\\n---\\\\n\\\\n# Integrated\\\\n\\\\n\\`\\`\\`mar-verdict-json\\\\n{\\\\"status\\\\":\\\\"pass\\\\",\\\\"blockers\\\\":[],\\\\"warnings\\\\":[],\\\\"nextAction\\\\":\\\\"none\\\\"}\\\\n\\`\\`\\`\\\\n";
  }
  if (phase === "review") return "---\\\\nphase: review\\\\nauthor: " + author + "\\\\ntargets: peer\\\\nissues: []\\\\n---\\\\n";
  if (phase === "response") return "---\\\\nphase: response\\\\nauthor: " + author + "\\\\nreviewOf: peer\\\\nresponses: []\\\\n---\\\\n";
  if (phase === "evaluation") return "---\\\\nphase: evaluation\\\\nround: 1\\\\nauthor: " + author + "\\\\nproposedBase: claude\\\\nremainingDisagreements: []\\\\ncitations: []\\\\n---\\\\n";
  return author + ":" + phase;
}
if (isCodex) {
  process.stdout.write(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: body() } }) + "\\\\n");
  process.stdout.write(JSON.stringify({ type: "turn.completed" }) + "\\\\n");
} else {
  process.stdout.write(JSON.stringify({ is_error: false, result: body(), duration_ms: 1 }));
}
`,
      "utf8",
    );
    const plan = join(dir, "plan.md");
    writeFileSync(plan, "# Plan\n", "utf8");
    const config = MarConfig.parse({
      agents: [
        { name: "claude", vendor: "claude", bin: `node ${fake}` },
        { name: "codex", vendor: "codex", bin: `node ${fake}` },
      ],
      defaults: { retries: 0, timeoutMs: 30_000 },
    });

    const result = await runCheckpoint({
      cwd: dir,
      stage: "plan",
      point: "plan:post",
      mode: "required",
      config,
      planFiles: [plan],
      phaseDir: dir,
      outDir: join(dir, ".planning", "mar-checkpoints", "plan-post"),
    });

    expect(result.exitCode).toBe(0);
    expect(existsSync(join(result.checkpointDir, "input.md"))).toBe(true);
    expect(existsSync(join(result.checkpointDir, "summary.md"))).toBe(true);
    expect(JSON.parse(readFileSync(join(dir, ".planning", "mar-checkpoints", "plan-post", "latest.json"), "utf8")).status).toBe("pass");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/checkpoint-run.test.ts`

Expected: FAIL because `src/checkpoint/run.ts` does not exist.

- [ ] **Step 3: Implement runner**

Implement `runCheckpoint` with this behavior:

```ts
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
}
```

Implementation requirements:

- Create a new checkpoint id with `newRunId()`.
- Create `<outDir>/<checkpointId>/`.
- Render `input.md` with the stage-specific renderer.
- Create a normal MAR run under `cwd/runs/<runId>`.
- Call `runProtocol(runDir, config, inputPath, gating, execution)`.
- Find the latest integration artifact in the manifest.
- Extract a verdict with `extractVerdictFromMarkdown`.
- Write `summary.md` with the integration artifact excerpt and blocker list.
- Write `<checkpointDir>/verdict.json` and `<outDir>/latest.json`.
- Return `{ exitCode, checkpointDir, verdict }`, where `exitCode` is `2` for required blocks.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/checkpoint-run.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/checkpoint/run.ts test/checkpoint-run.test.ts
git commit -m "feat: run MAR checkpoints"
```

## Task 5: CLI Commands

**Files:**
- Modify: `src/cli.ts`
- Test: add assertions in `test/cli-roster.test.ts` or create `test/cli-checkpoint.test.ts`

- [ ] **Step 1: Write failing CLI tests**

Create `test/cli-checkpoint.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("checkpoint CLI registration", () => {
  it("registers checkpoint and gsd commands in the built CLI source", () => {
    const cli = readFileSync("src/cli.ts", "utf8");
    expect(cli).toContain('.command("checkpoint")');
    expect(cli).toContain('.command("gsd")');
    expect(cli).toContain("checkpoint verdict");
    expect(cli).toContain("gsd install");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/cli-checkpoint.test.ts`

Expected: FAIL because CLI commands are not registered.

- [ ] **Step 3: Add CLI command routing**

In `src/cli.ts`, import:

```ts
import { gateExitCode } from "./checkpoint/verdict.js";
import { runCheckpoint } from "./checkpoint/run.js";
import { installGsdCapability } from "./gsd/install.js";
```

Add interfaces:

```ts
interface CheckpointOptions extends RunOptions {
  mode?: string;
  out?: string;
  phaseDir?: string;
  planFile?: string[];
  base?: string;
}

interface CheckpointVerdictOptions {
  out?: string;
}

interface GsdInstallOptions {
  mode?: string;
  target?: string;
  force?: boolean;
}
```

Register:

```ts
program
  .command("checkpoint")
  .description("Run or inspect MAR checkpoint reviews")
  .addCommand(
    new Command("plan")
      .option("--phase-dir <path>")
      .option("--plan-file <path...>")
      .option("--mode <mode>", "required|advisory", "required")
      .option("--out <dir>")
      .action((opts) => runCheckpointPlan(opts).then((code) => process.exitCode = code)),
  )
  .addCommand(
    new Command("implementation")
      .option("--base <ref>", "diff base", "main")
      .option("--mode <mode>", "required|advisory", "required")
      .option("--out <dir>")
      .action((opts) => runCheckpointImplementation(opts).then((code) => process.exitCode = code)),
  )
  .addCommand(
    new Command("verdict")
      .requiredOption("--out <dir>")
      .action((opts) => {
        process.exitCode = gateExitCode(join(opts.out, "latest.json"));
      }),
  );

program
  .command("gsd")
  .description("Install MAR into GSD workflows")
  .addCommand(
    new Command("install")
      .option("--mode <mode>", "required|advisory", "required")
      .option("--target <path>", "target repo", ".")
      .option("--force")
      .action((opts) => installGsdCapability(opts).then((code) => process.exitCode = code)),
  );
```

Use existing `loadConfig`, `resolveGating`, and `detectGitRepo` helpers inside the `runCheckpointPlan` and `runCheckpointImplementation` wrappers. Keep commander thin; business logic stays in `src/checkpoint`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/cli-checkpoint.test.ts`

Expected: PASS.

- [ ] **Step 5: Run TypeScript build**

Run: `npm run build`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/cli.ts test/cli-checkpoint.test.ts
git commit -m "feat: expose checkpoint CLI commands"
```

## Task 6: GSD Capability Overlay Installer

**Files:**
- Create: `src/gsd/install.ts`
- Test: `test/gsd-install.test.ts`

- [ ] **Step 1: Write failing installer tests**

```ts
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installGsdCapability } from "../src/gsd/install.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mar-gsd-install-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("installGsdCapability", () => {
  it("writes a project capability overlay in required mode", async () => {
    const code = await installGsdCapability({ target: dir, mode: "required" });
    expect(code).toBe(0);

    const root = join(dir, ".gsd", "capabilities", "mar-checkpoints");
    expect(existsSync(join(root, "capability.json"))).toBe(true);
    expect(existsSync(join(root, "skills", "mar-checkpoint-plan", "SKILL.md"))).toBe(true);
    expect(readFileSync(join(root, "capability.json"), "utf8")).toContain("plan:post");
    expect(readFileSync(join(root, "capability.json"), "utf8")).toContain("execute:post");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/gsd-install.test.ts`

Expected: FAIL because `src/gsd/install.ts` does not exist.

- [ ] **Step 3: Implement overlay writer**

Implement:

```ts
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface GsdInstallOptions {
  target?: string;
  mode?: string;
  force?: boolean;
}

export async function installGsdCapability(opts: GsdInstallOptions): Promise<number> {
  const target = opts.target ?? ".";
  const mode = opts.mode === "advisory" ? "advisory" : "required";
  const root = join(target, ".gsd", "capabilities", "mar-checkpoints");
  await mkdir(join(root, "skills", "mar-checkpoint-plan"), { recursive: true });
  await mkdir(join(root, "skills", "mar-checkpoint-implementation"), { recursive: true });

  await writeFile(join(root, "capability.json"), JSON.stringify(buildCapability(mode), null, 2) + "\n", "utf8");
  await writeFile(
    join(root, "skills", "mar-checkpoint-plan", "SKILL.md"),
    buildPlanSkill(mode),
    "utf8",
  );
  await writeFile(
    join(root, "skills", "mar-checkpoint-implementation", "SKILL.md"),
    buildImplementationSkill(mode),
    "utf8",
  );

  process.stdout.write(`wrote GSD MAR checkpoint capability to ${root}\n`);
  process.stdout.write(`next: gsd capability install ${root} --scope project --yes\n`);
  return 0;
}
```

`buildCapability(mode)` should return a feature capability with:

- `id: "mar-checkpoints"`
- `role: "feature"`
- `runtimeCompat.supported: ["*"]`
- `skills: ["mar-checkpoint-plan", "mar-checkpoint-implementation"]`
- config key `workflow.mar_checkpoints`
- steps at `plan:post` and `execute:post`

Use `onError: "halt"` in required mode and `onError: "skip"` in advisory mode until a deterministic GSD gate query is verified on the installed GSD version.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/gsd-install.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/gsd/install.ts test/gsd-install.test.ts
git commit -m "feat: emit GSD checkpoint capability"
```

## Task 7: Documentation and Validation

**Files:**
- Modify: `README.md`
- Optional modify: `.planning/PROJECT.md` to promote this as a v1.1 active requirement after user approval.

- [ ] **Step 1: Add README section**

Add:

```markdown
## GSD checkpoint integration

MAR can run as a blocking review layer inside a GSD phase loop:

\`\`\`bash
mar gsd install --mode required
gsd capability install .gsd/capabilities/mar-checkpoints --scope project --yes
\`\`\`

Required mode runs MAR at configured GSD checkpoints and stops the loop when
`verdict.json` contains blocking findings. Advisory mode writes the same artifacts
without stopping the loop.
```

- [ ] **Step 2: Run focused tests**

Run:

```bash
npm test -- \
  test/checkpoint-schema.test.ts \
  test/checkpoint-verdict.test.ts \
  test/checkpoint-input.test.ts \
  test/checkpoint-run.test.ts \
  test/gsd-install.test.ts \
  test/cli-checkpoint.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run build and lint**

Run:

```bash
npm run build
npm run lint
```

Expected: PASS.

- [ ] **Step 4: Run full test suite**

Run: `npm test`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: document GSD checkpoint integration"
```

## Self-Review

Spec coverage:

- GSD-first integration: covered by Tasks 6 and 7.
- MAR remains separate engine: covered by Tasks 3 and 4 using `runProtocol`.
- Blocking by default: covered by Tasks 1, 2, 5, and 6.
- Ask-by-default after block: represented by `nextAction: "ask_user"` in Tasks 1 and 2.
- Plan and final implementation diff checkpoints: covered by Tasks 3, 4, and 6.
- All checkpoint stages: enum includes full vocabulary, but first implementation only wires plan and implementation. This matches the design's first slice.
- Auto-fix-and-rerun: intentionally deferred in the design. Do not implement until required-mode verdicts are reliable.

Placeholder scan:

- No placeholder markers or vague "add tests" instructions remain.
- The only deferred items are explicitly marked as out of first slice.

Type consistency:

- `CheckpointStage`, `CheckpointMode`, `CheckpointVerdict`, `runCheckpoint`, `installGsdCapability`, `extractVerdictFromMarkdown`, and `gateExitCode` names are consistent across tasks.

Execution handoff:

Plan complete and saved to `docs/superpowers/plans/2026-06-30-gsd-mar-checkpoint-capability.md`.

Recommended execution mode: Subagent-driven, one task per subagent, because checkpoint runner, CLI wiring, and GSD overlay generation are independent enough to implement and review separately.
