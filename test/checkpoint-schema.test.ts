import { describe, expect, it } from "vitest";
import {
  CheckpointMode,
  CheckpointSeverity,
  CheckpointStage,
  CheckpointStatus,
  CheckpointVerdict,
  shouldBlock,
} from "../src/checkpoint/schema.js";

describe("Checkpoint schema", () => {
  it("parses a minimal passing required verdict without blocking", () => {
    const parsed = CheckpointVerdict.parse({
      schemaVersion: 1,
      stage: "plan",
      point: "plan:post",
      mode: "required",
      status: "pass",
      runId: "20260630-abc123",
      summaryPath: ".planning/mar-checkpoints/plan-post/20260630-abc123/summary.md",
      createdAt: "2026-06-30T00:00:00.000Z",
    });

    expect(parsed.blockers).toEqual([]);
    expect(parsed.warnings).toEqual([]);
    expect(parsed.nextAction).toBe("none");
    expect(shouldBlock(parsed)).toBe(false);
  });

  it("parses a required high-severity block verdict and blocks", () => {
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

  it("does not block advisory mode when status is block", () => {
    const parsed = CheckpointVerdict.parse({
      schemaVersion: 1,
      stage: "spec",
      point: "spec:post",
      mode: "advisory",
      status: "block",
      runId: "20260630-abc123",
      summaryPath: "summary.md",
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
      createdAt: "2026-06-30T00:00:00.000Z",
    });

    expect(shouldBlock(parsed)).toBe(false);
  });

  it("blocks required error verdicts even without blockers", () => {
    const parsed = CheckpointVerdict.parse({
      schemaVersion: 1,
      stage: "verification",
      point: "verify:post",
      mode: "required",
      status: "error",
      runId: "20260630-abc123",
      summaryPath: "summary.md",
      nextAction: "ask_user",
      createdAt: "2026-06-30T00:00:00.000Z",
    });

    expect(parsed.blockers).toEqual([]);
    expect(shouldBlock(parsed)).toBe(true);
  });

  it("does not block required block verdicts with medium-only blockers", () => {
    const parsed = CheckpointVerdict.parse({
      schemaVersion: 1,
      stage: "ship",
      point: "ship:pre",
      mode: "required",
      status: "block",
      runId: "20260630-abc123",
      summaryPath: "summary.md",
      blockers: [
        {
          id: "MAR-BLOCKER-002",
          severity: "medium",
          title: "Documentation gap",
          recommendation: "Update the release notes.",
        },
      ],
      nextAction: "ask_user",
      createdAt: "2026-06-30T00:00:00.000Z",
    });

    expect(parsed.blockers[0]?.evidence).toEqual([]);
    expect(shouldBlock(parsed)).toBe(false);
  });

  it("keeps checkpoint enum option order exact", () => {
    expect(CheckpointStage.options).toEqual([
      "intent",
      "spec",
      "plan",
      "implementation",
      "verification",
      "ship",
    ]);
    expect(CheckpointMode.options).toEqual(["required", "advisory"]);
    expect(CheckpointStatus.options).toEqual(["pass", "warn", "block", "waived", "error"]);
    expect(CheckpointSeverity.options).toEqual(["critical", "high", "medium", "low", "info"]);
  });

  it("rejects waived verdicts without waiver details", () => {
    expect(() =>
      CheckpointVerdict.parse({
        schemaVersion: 1,
        stage: "plan",
        point: "plan:post",
        mode: "required",
        status: "waived",
        runId: "20260630-abc123",
        summaryPath: "summary.md",
        createdAt: "2026-06-30T00:00:00.000Z",
      }),
    ).toThrow();
  });

  it("rejects block and error verdicts without a follow-up action", () => {
    expect(() =>
      CheckpointVerdict.parse({
        schemaVersion: 1,
        stage: "plan",
        point: "plan:post",
        mode: "required",
        status: "block",
        runId: "20260630-abc123",
        summaryPath: "summary.md",
        blockers: [
          {
            id: "MAR-BLOCKER-001",
            severity: "high",
            title: "Missing tests",
            recommendation: "Add test coverage.",
          },
        ],
        createdAt: "2026-06-30T00:00:00.000Z",
      }),
    ).toThrow();

    expect(() =>
      CheckpointVerdict.parse({
        schemaVersion: 1,
        stage: "implementation",
        point: "execute:post",
        mode: "required",
        status: "error",
        runId: "20260630-abc123",
        summaryPath: "summary.md",
        createdAt: "2026-06-30T00:00:00.000Z",
      }),
    ).toThrow();
  });
});
