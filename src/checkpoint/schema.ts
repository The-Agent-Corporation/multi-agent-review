import { z } from "zod";

export const CheckpointStage = z.enum([
  "intent",
  "spec",
  "plan",
  "implementation",
  "verification",
  "ship",
]);
export type CheckpointStage = z.infer<typeof CheckpointStage>;

export const CheckpointMode = z.enum(["required", "advisory"]);
export type CheckpointMode = z.infer<typeof CheckpointMode>;

export const CheckpointStatus = z.enum(["pass", "warn", "block", "waived", "error"]);
export type CheckpointStatus = z.infer<typeof CheckpointStatus>;

export const CheckpointSeverity = z.enum(["critical", "high", "medium", "low", "info"]);
export type CheckpointSeverity = z.infer<typeof CheckpointSeverity>;

export const CheckpointBlocker = z.object({
  id: z.string().min(1),
  severity: CheckpointSeverity,
  title: z.string().min(1),
  evidence: z.array(z.string()).default([]),
  recommendation: z.string().min(1),
});
export type CheckpointBlocker = z.infer<typeof CheckpointBlocker>;

export const CheckpointNextAction = z.enum(["none", "ask_user", "auto_fix", "rerun"]);
export type CheckpointNextAction = z.infer<typeof CheckpointNextAction>;

export const CheckpointVerdict = z
  .object({
    schemaVersion: z.literal(1),
    stage: CheckpointStage,
    point: z.string().min(1),
    mode: CheckpointMode,
    status: CheckpointStatus,
    runId: z.string().min(1),
    summaryPath: z.string().min(1),
    blockers: z.array(CheckpointBlocker).default([]),
    warnings: z.array(CheckpointBlocker).default([]),
    nextAction: CheckpointNextAction.default("none"),
    createdAt: z.string().datetime(),
    waiver: z
      .object({
        reason: z.string().min(1),
        waivedAt: z.string().datetime(),
      })
      .optional(),
  })
  .superRefine((verdict, ctx) => {
    if (verdict.status === "waived" && verdict.waiver === undefined) {
      ctx.addIssue({
        code: "custom",
        message: "waived checkpoint verdicts require waiver details",
        path: ["waiver"],
      });
    }
    if (
      (verdict.status === "block" || verdict.status === "error") &&
      verdict.nextAction === "none"
    ) {
      ctx.addIssue({
        code: "custom",
        message: "blocking checkpoint verdicts require a follow-up action",
        path: ["nextAction"],
      });
    }
  });
export type CheckpointVerdict = z.infer<typeof CheckpointVerdict>;

export interface CheckpointConfig {
  stage: CheckpointStage;
  mode: CheckpointMode;
  inputPath: string;
  outDir: string;
  configPath?: string;
  baseRef?: string;
  worktree?: boolean;
}

export function shouldBlock(verdict: CheckpointVerdict): boolean {
  if (verdict.mode !== "required") {
    return false;
  }
  if (verdict.status === "error") {
    return true;
  }
  if (verdict.status !== "block") {
    return false;
  }
  return verdict.blockers.some(
    (blocker) => blocker.severity === "critical" || blocker.severity === "high",
  );
}
