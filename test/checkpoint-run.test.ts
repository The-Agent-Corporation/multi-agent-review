import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCheckpoint } from "../src/checkpoint/run.js";
import type { MarConfig } from "../src/schema/config.js";

vi.setConfig({ testTimeout: 60_000 });

let workdir: string;
let outDir: string;
let phaseDir: string;
let planPath: string;
let fakeCli: string;

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), "mar-checkpoint-run-"));
  outDir = join(workdir, "checkpoints");
  phaseDir = join(workdir, "phase");
  mkdirSync(phaseDir, { recursive: true });
  planPath = join(phaseDir, "plan.md");
  writeFileSync(planPath, "# Plan\n\nShip checkpoint runner.\n", "utf8");
  fakeCli = join(workdir, "fake-cli.mjs");
  writeFileSync(
    fakeCli,
    `
const args = process.argv.slice(2);
const isCodex = args[0] === "exec";
const text = args.join("\\n");
const phase = /\\[phase:([a-z]+)\\]/.exec(text)?.[1] ?? "draft";
const author = isCodex ? "codex" : "claude";
const scenario = process.env.MAR_CHECKPOINT_SCENARIO ?? "pass";

function verdictBlock() {
  if (scenario === "missing-verdict") {
    return "No machine-readable verdict here.\\n";
  }
  if (scenario === "advisory-block") {
    return \`\\\`\\\`\\\`mar-verdict-json
{
  "status": "block",
  "blockers": [
    {
      "id": "MAR-BLOCKER-001",
      "severity": "high",
      "title": "Missing verification proof",
      "evidence": ["test output absent"],
      "recommendation": "Run and attach checkpoint verification."
    }
  ],
  "warnings": [],
  "nextAction": "ask_user"
}
\\\`\\\`\\\`
\`;
  }
  if (scenario === "waived") {
    return \`\\\`\\\`\\\`mar-verdict-json
{
  "status": "waived",
  "blockers": [],
  "warnings": [],
  "nextAction": "none"
}
\\\`\\\`\\\`
\`;
  }
  return \`\\\`\\\`\\\`mar-verdict-json
{
  "status": "pass",
  "blockers": [],
  "warnings": [],
  "nextAction": "none"
}
\\\`\\\`\\\`
\`;
}

function artifact(kind) {
  if (kind === "review") {
    return \`---
phase: review
author: \${author}
targets: peer
issues:
  - n: 1
    severity: P2
    question: "Is the checkpoint plan testable?"
---

# Review
\`;
  }
  if (kind === "response") {
    return \`---
phase: response
author: \${author}
reviewOf: peer-review
responses:
  - issueRef: 1
    verdict: accept
---

# Response
\`;
  }
  if (kind === "evaluation") {
    const proposedBase = scenario === "escalated" ? author : "claude";
    return \`---
phase: evaluation
round: 1
author: \${author}
proposedBase: \${proposedBase}
remainingDisagreements: []
citations: []
---

# Evaluation
\`;
  }
  if (kind === "integration") {
    return \`---
phase: integration
author: \${author}
base: claude
additions:
  - verdict: merged
    additionRef: issue-1
---

# Integrated Checkpoint

\${verdictBlock()}
\`;
  }
  return \`# Draft by \${author}\\n\`;
}

const body = artifact(phase);
if (isCodex) {
  process.stdout.write(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: body } }) + "\\n");
  process.stdout.write(JSON.stringify({ type: "turn.completed" }) + "\\n");
} else {
  process.stdout.write(JSON.stringify({ is_error: false, result: body, duration_ms: 1 }));
}
`,
    "utf8",
  );
  process.env.MAR_EMIT_BASE = "claude";
});

afterEach(() => {
  delete process.env.MAR_EMIT_BASE;
  delete process.env.MAR_CHECKPOINT_SCENARIO;
  rmSync(workdir, { recursive: true, force: true });
});

function config(bin: string): MarConfig {
  return {
    agents: [
      { name: "claude", vendor: "claude", bin: `node ${bin}` },
      { name: "codex", vendor: "codex", bin: `node ${bin}` },
    ],
    defaults: { timeoutMs: 30_000, retries: 0, convergenceCap: 3 },
  } as MarConfig;
}

describe("runCheckpoint", () => {
  it("runs a plan checkpoint and writes pass verdict artifacts", async () => {
    const result = await runCheckpoint({
      cwd: workdir,
      stage: "plan",
      point: "plan:pre",
      mode: "required",
      config: config(fakeCli),
      outDir,
      phaseDir,
      planFiles: [planPath],
    });

    expect(result.exitCode).toBe(0);
    expect(existsSync(join(result.checkpointDir, "input.md"))).toBe(true);
    expect(readFileSync(join(result.checkpointDir, "input.md"), "utf8")).toContain(
      "Ship checkpoint runner.",
    );
    expect(readFileSync(join(result.checkpointDir, "summary.md"), "utf8")).toContain(
      "Integrated Checkpoint",
    );
    const verdict = JSON.parse(readFileSync(join(result.checkpointDir, "verdict.json"), "utf8"));
    const latest = JSON.parse(readFileSync(join(outDir, "latest.json"), "utf8"));
    expect(verdict.status).toBe("pass");
    expect(latest).toEqual(verdict);
    expect(result.verdict.status).toBe("pass");
    expect(result.runDir).toContain(join(workdir, "runs"));
  });

  it("fail-closes when integration output lacks an exact verdict block", async () => {
    process.env.MAR_CHECKPOINT_SCENARIO = "missing-verdict";

    const result = await runCheckpoint({
      cwd: workdir,
      stage: "plan",
      point: "plan:pre",
      mode: "required",
      config: config(fakeCli),
      outDir,
      phaseDir,
      planFiles: [planPath],
    });

    const latest = JSON.parse(readFileSync(join(outDir, "latest.json"), "utf8"));
    expect(result.exitCode).toBe(2);
    expect(latest.status).toBe("error");
    expect(latest.blockers[0].severity).toBe("critical");
    expect(latest.blockers[0].title).toMatch(/missing machine-readable verdict/i);
  });

  it("records advisory blocks without blocking the process exit", async () => {
    process.env.MAR_CHECKPOINT_SCENARIO = "advisory-block";

    const result = await runCheckpoint({
      cwd: workdir,
      stage: "plan",
      point: "plan:pre",
      mode: "advisory",
      config: config(fakeCli),
      outDir,
      phaseDir,
      planFiles: [planPath],
    });

    const latest = JSON.parse(readFileSync(join(outDir, "latest.json"), "utf8"));
    expect(result.exitCode).toBe(0);
    expect(latest.status).toBe("block");
    expect(latest.blockers[0]).toMatchObject({
      severity: "high",
      title: "Missing verification proof",
    });
  });

  it("returns a required error verdict when the protocol fails before integration", async () => {
    const result = await runCheckpoint({
      cwd: workdir,
      stage: "plan",
      point: "plan:pre",
      mode: "required",
      config: config("/nonexistent/mar-checkpoint-fake-cli.mjs"),
      outDir,
      phaseDir,
      planFiles: [planPath],
    });

    const latest = JSON.parse(readFileSync(join(outDir, "latest.json"), "utf8"));
    expect(result.exitCode).toBe(2);
    expect(latest.status).toBe("error");
    expect(latest.nextAction).toBe("ask_user");
    expect(latest.blockers[0]).toMatchObject({
      severity: "critical",
      title: "MAR checkpoint protocol did not produce an integration artifact",
    });
  });

  it("fail-closes escalated protocol runs even when the integration verdict says pass", async () => {
    process.env.MAR_CHECKPOINT_SCENARIO = "escalated";

    const result = await runCheckpoint({
      cwd: workdir,
      stage: "plan",
      point: "plan:pre",
      mode: "required",
      config: config(fakeCli),
      outDir,
      phaseDir,
      planFiles: [planPath],
    });

    const latest = JSON.parse(readFileSync(join(outDir, "latest.json"), "utf8"));
    expect(result.exitCode).toBe(2);
    expect(latest.status).toBe("error");
    expect(latest.nextAction).toBe("ask_user");
    expect(latest.blockers[0]).toMatchObject({
      severity: "critical",
      title: "MAR checkpoint protocol escalated without consensus",
    });
  });

  it("writes a deterministic error verdict when extracted verdict validation fails", async () => {
    process.env.MAR_CHECKPOINT_SCENARIO = "waived";

    const result = await runCheckpoint({
      cwd: workdir,
      stage: "plan",
      point: "plan:pre",
      mode: "required",
      config: config(fakeCli),
      outDir,
      phaseDir,
      planFiles: [planPath],
    });

    const latest = JSON.parse(readFileSync(join(outDir, "latest.json"), "utf8"));
    const checkpointVerdict = JSON.parse(
      readFileSync(join(result.checkpointDir, "verdict.json"), "utf8"),
    );
    expect(result.exitCode).toBe(2);
    expect(latest.status).toBe("error");
    expect(latest.nextAction).toBe("ask_user");
    expect(checkpointVerdict).toEqual(latest);
    expect(latest.blockers[0]).toMatchObject({
      severity: "critical",
      title: "MAR checkpoint verdict was invalid",
    });
    expect(existsSync(join(result.checkpointDir, "summary.md"))).toBe(true);
  });
});
