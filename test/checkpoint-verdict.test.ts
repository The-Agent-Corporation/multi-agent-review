import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CheckpointVerdict } from "../src/checkpoint/schema.js";
import {
  extractVerdictFromMarkdown,
  gateExitCode,
  writeVerdict,
} from "../src/checkpoint/verdict.js";

let workdir: string;

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), "mar-checkpoint-verdict-"));
});

afterEach(() => {
  if (workdir) rmSync(workdir, { recursive: true, force: true });
});

function verdict(overrides: Partial<CheckpointVerdict> = {}): CheckpointVerdict {
  return {
    schemaVersion: 1,
    stage: "implementation",
    point: "execute:post",
    mode: "required",
    status: "pass",
    runId: "20260630-abc123",
    summaryPath: "summary.md",
    blockers: [],
    warnings: [],
    nextAction: "none",
    createdAt: "2026-06-30T00:00:00.000Z",
    ...overrides,
  };
}

describe("checkpoint verdict markdown extraction", () => {
  it("extracts a valid mar-verdict-json fenced block and defaults block nextAction to ask_user", () => {
    const extracted = extractVerdictFromMarkdown(`
# MAR checkpoint

\`\`\`mar-verdict-json
{
  "status": "block",
  "blockers": [
    {
      "id": "MAR-BLOCKER-001",
      "severity": "high",
      "title": "Missing rollback",
      "evidence": ["src/db/migrate.ts:42"],
      "recommendation": "Add rollback acceptance criteria."
    }
  ],
  "warnings": []
}
\`\`\`
`);

    expect(extracted.status).toBe("block");
    expect(extracted.nextAction).toBe("ask_user");
    expect(extracted.blockers?.[0]?.id).toBe("MAR-BLOCKER-001");
  });

  it("preserves an explicit ask_user nextAction from the fenced block", () => {
    const extracted = extractVerdictFromMarkdown(`
\`\`\`mar-verdict-json
{
  "status": "block",
  "blockers": ["Plan lacks migration rollback coverage."],
  "warnings": [],
  "nextAction": "ask_user"
}
\`\`\`
`);

    expect(extracted.status).toBe("block");
    expect(extracted.nextAction).toBe("ask_user");
    expect(extracted.blockers?.[0]).toMatchObject({
      severity: "high",
      title: "Plan lacks migration rollback coverage.",
      recommendation: "Plan lacks migration rollback coverage.",
    });
  });

  it("normalizes unknown status and malformed blocker entries", () => {
    const extracted = extractVerdictFromMarkdown(`
\`\`\`mar-verdict-json
{
  "status": "surprised",
  "blockers": [42, { "title": "Missing migration rollback" }, null],
  "nextAction": "ask_user"
}
\`\`\`
`);

    expect(extracted.status).toBe("error");
    expect(extracted.nextAction).toBe("ask_user");
    expect(extracted.warnings).toEqual([]);
    expect(extracted.blockers).toHaveLength(3);
    expect(extracted.blockers?.[0]).toMatchObject({
      severity: "high",
      title: "42",
      recommendation: "42",
    });
    expect(extracted.blockers?.[1]).toMatchObject({
      severity: "high",
      title: "Missing migration rollback",
      recommendation: "Missing migration rollback",
    });
  });

  it("defaults non-blocking statuses to no follow-up action", () => {
    const extracted = extractVerdictFromMarkdown(`
\`\`\`mar-verdict-json
{
  "status": "warn",
  "warnings": ["Add a release note."]
}
\`\`\`
`);

    expect(extracted.status).toBe("warn");
    expect(extracted.blockers).toEqual([]);
    expect(extracted.warnings?.[0]).toMatchObject({
      severity: "medium",
      title: "Add a release note.",
    });
    expect(extracted.nextAction).toBe("none");
  });

  it("uses an exact verdict fence name and fail-closes multiple verdict blocks", () => {
    const wrongFence = extractVerdictFromMarkdown(`
\`\`\`mar-verdict-jsonish
{"status":"pass","blockers":[],"warnings":[],"nextAction":"none"}
\`\`\`
`);
    const uppercaseFence = extractVerdictFromMarkdown(`
\`\`\`MAR-VERDICT-JSON
{"status":"pass","blockers":[],"warnings":[],"nextAction":"none"}
\`\`\`
`);
    const spacedFenceName = extractVerdictFromMarkdown(`
\`\`\` mar-verdict-json
{"status":"pass","blockers":[],"warnings":[],"nextAction":"none"}
\`\`\`
`);
    const longerFenceRun = extractVerdictFromMarkdown(`
\`\`\`\`mar-verdict-json
{"status":"pass","blockers":[],"warnings":[],"nextAction":"none"}
\`\`\`\`
`);
    const multipleFences = extractVerdictFromMarkdown(`
\`\`\`mar-verdict-json
{"status":"pass","blockers":[],"warnings":[],"nextAction":"none"}
\`\`\`

\`\`\`mar-verdict-json
{"status":"block","blockers":["Missing tests"]}
\`\`\`
`);

    expect(wrongFence.status).toBe("error");
    expect(wrongFence.blockers?.[0]?.title).toMatch(/machine-readable verdict/i);
    expect(uppercaseFence.status).toBe("error");
    expect(uppercaseFence.blockers?.[0]?.title).toMatch(/machine-readable verdict/i);
    expect(spacedFenceName.status).toBe("error");
    expect(spacedFenceName.blockers?.[0]?.title).toMatch(/machine-readable verdict/i);
    expect(longerFenceRun.status).toBe("error");
    expect(longerFenceRun.blockers?.[0]?.title).toMatch(/machine-readable verdict/i);
    expect(multipleFences.status).toBe("error");
    expect(multipleFences.blockers?.[0]?.title).toMatch(/multiple/i);
  });

  it("normalizes block and error nextAction none to ask_user", () => {
    const block = extractVerdictFromMarkdown(`
\`\`\`mar-verdict-json
{
  "status": "block",
  "blockers": ["Missing tests"],
  "nextAction": "none"
}
\`\`\`
`);
    const error = extractVerdictFromMarkdown(`
\`\`\`mar-verdict-json
{
  "status": "error",
  "nextAction": "none"
}
\`\`\`
`);

    expect(block.nextAction).toBe("ask_user");
    expect(error.nextAction).toBe("ask_user");
  });

  it("fail-closes block verdicts with malformed blocker collections", () => {
    const extracted = extractVerdictFromMarkdown(`
\`\`\`mar-verdict-json
{
  "status": "block",
  "blockers": "missing tests"
}
\`\`\`
`);

    expect(extracted.status).toBe("error");
    expect(extracted.nextAction).toBe("ask_user");
    expect(extracted.blockers?.[0]).toMatchObject({
      severity: "critical",
      title: "Malformed machine-readable verdict blockers",
    });
  });

  it("fail-closes pass and warn verdicts with malformed blocker collections", () => {
    const pass = extractVerdictFromMarkdown(`
\`\`\`mar-verdict-json
{
  "status": "pass",
  "blockers": "missing tests"
}
\`\`\`
`);
    const warn = extractVerdictFromMarkdown(`
\`\`\`mar-verdict-json
{
  "status": "warn",
  "blockers": { "title": "missing tests" },
  "warnings": []
}
\`\`\`
`);

    expect(pass.status).toBe("error");
    expect(pass.nextAction).toBe("ask_user");
    expect(pass.blockers?.[0]?.title).toMatch(/malformed/i);
    expect(warn.status).toBe("error");
    expect(warn.nextAction).toBe("ask_user");
    expect(warn.blockers?.[0]?.title).toMatch(/malformed/i);
  });

  it("fail-closes contradictory pass verdicts that include blocking blockers", () => {
    const extracted = extractVerdictFromMarkdown(`
\`\`\`mar-verdict-json
{
  "status": "pass",
  "blockers": [
    {
      "id": "MAR-BLOCKER-001",
      "severity": "critical",
      "title": "Tests are missing",
      "recommendation": "Add regression coverage."
    }
  ]
}
\`\`\`
`);

    expect(extracted.status).toBe("error");
    expect(extracted.nextAction).toBe("ask_user");
    expect(extracted.blockers?.[0]?.severity).toBe("critical");
  });

  it("fail-closes contradictory warn verdicts that include blocking blockers", () => {
    const extracted = extractVerdictFromMarkdown(`
\`\`\`mar-verdict-json
{
  "status": "warn",
  "blockers": [
    {
      "id": "MAR-BLOCKER-001",
      "severity": "high",
      "title": "Auth bypass",
      "recommendation": "Fix the authorization check."
    }
  ],
  "warnings": []
}
\`\`\`
`);

    expect(extracted.status).toBe("error");
    expect(extracted.nextAction).toBe("ask_user");
    expect(extracted.blockers?.[0]?.severity).toBe("high");
  });

  it("fail-closes missing fenced blocks to an error verdict", () => {
    const extracted = extractVerdictFromMarkdown("# Checkpoint\n\nNo structured block here.");

    expect(extracted.status).toBe("error");
    expect(extracted.nextAction).toBe("ask_user");
    expect(extracted.warnings).toEqual([]);
    expect(extracted.blockers?.[0]).toMatchObject({
      severity: "critical",
      recommendation: "Ask the reviewer to return a mar-verdict-json fenced block.",
    });
    expect(extracted.blockers?.[0]?.title).toMatch(/machine-readable verdict/i);
  });

  it("fail-closes malformed fenced JSON to an error verdict", () => {
    const extracted = extractVerdictFromMarkdown(`
\`\`\`mar-verdict-json
{ "status": "pass",
\`\`\`
`);

    expect(extracted.status).toBe("error");
    expect(extracted.nextAction).toBe("ask_user");
    expect(extracted.warnings).toEqual([]);
    expect(extracted.blockers?.[0]?.severity).toBe("critical");
    expect(extracted.blockers?.[0]?.title).toMatch(/malformed/i);
  });
});

describe("checkpoint verdict persistence and gate exit codes", () => {
  it("writes latest.json and returns 2 for a required high-severity block verdict", async () => {
    const outPath = await writeVerdict(
      workdir,
      verdict({
        status: "block",
        blockers: [
          {
            id: "MAR-BLOCKER-001",
            severity: "high",
            title: "Missing rollback",
            evidence: ["src/db/migrate.ts:42"],
            recommendation: "Add rollback acceptance criteria.",
          },
        ],
        nextAction: "ask_user",
      }),
    );

    expect(outPath).toBe(join(workdir, "latest.json"));
    expect(existsSync(outPath)).toBe(true);
    expect(readFileSync(outPath, "utf8")).toMatch(/\n$/);
    expect(gateExitCode(outPath)).toBe(2);
  });

  it("rejects schema-invalid verdicts before writing latest.json", async () => {
    await expect(
      writeVerdict(
        workdir,
        verdict({
          status: "block",
          blockers: [
            {
              id: "MAR-BLOCKER-001",
              severity: "high",
              title: "Missing tests",
              recommendation: "Add regression coverage.",
            },
          ],
          nextAction: "none",
        }),
      ),
    ).rejects.toThrow();
  });

  it("returns 0 for advisory block and required warn/pass verdicts", async () => {
    const advisoryBlock = await writeVerdict(
      join(workdir, "advisory"),
      verdict({
        mode: "advisory",
        status: "block",
        blockers: [
          {
            id: "MAR-BLOCKER-001",
            severity: "critical",
            title: "Spec gap",
            evidence: [],
            recommendation: "Rewrite the spec.",
          },
        ],
        nextAction: "ask_user",
      }),
    );
    const requiredWarn = await writeVerdict(
      join(workdir, "warn"),
      verdict({
        status: "warn",
        warnings: [
          {
            id: "MAR-WARNING-001",
            severity: "medium",
            title: "Documentation gap",
            evidence: [],
            recommendation: "Update docs.",
          },
        ],
      }),
    );
    const requiredPass = await writeVerdict(join(workdir, "pass"), verdict());

    expect(gateExitCode(advisoryBlock)).toBe(0);
    expect(gateExitCode(requiredWarn)).toBe(0);
    expect(gateExitCode(requiredPass)).toBe(0);
  });

  it("returns 1 for missing or invalid latest.json", () => {
    const invalidPath = join(workdir, "latest.json");
    writeFileSync(invalidPath, "{ invalid json\n");
    const schemaInvalidPath = join(workdir, "schema-invalid.json");
    writeFileSync(
      schemaInvalidPath,
      JSON.stringify({
        schemaVersion: 1,
        stage: "plan",
        point: "plan:post",
        mode: "required",
        status: "block",
        runId: "20260630-abc123",
        summaryPath: "summary.md",
        createdAt: "2026-06-30T00:00:00.000Z",
      }),
      "utf8",
    );

    expect(gateExitCode(join(workdir, "missing.json"))).toBe(1);
    expect(gateExitCode(invalidPath)).toBe(1);
    expect(gateExitCode(schemaInvalidPath)).toBe(1);
  });
});
