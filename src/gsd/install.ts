import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface GsdInstallOptions {
  target?: string;
  mode?: string;
  force?: boolean;
}

type GsdCheckpointMode = "required" | "advisory";

interface CapabilityStep {
  id: string;
  point: string;
  skill: string;
  onError: "halt" | "skip";
  command: string;
  gate: string;
}

interface CapabilityManifest {
  id: string;
  role: "feature";
  runtimeCompat: { supported: string[] };
  config: { key: string; mode: GsdCheckpointMode };
  skills: string[];
  steps: CapabilityStep[];
}

function resolveMode(mode: string | undefined): GsdCheckpointMode {
  return mode === "advisory" ? "advisory" : "required";
}

function buildCapability(mode: GsdCheckpointMode): CapabilityManifest {
  const onError = mode === "required" ? "halt" : "skip";
  return {
    id: "mar-checkpoints",
    role: "feature",
    runtimeCompat: { supported: ["*"] },
    config: {
      key: "workflow.mar_checkpoints",
      mode,
    },
    skills: ["mar-checkpoint-plan", "mar-checkpoint-implementation"],
    steps: [
      {
        id: "mar-checkpoint-plan-post",
        point: "plan:post",
        skill: "mar-checkpoint-plan",
        onError,
        command: `mar checkpoint plan --mode ${mode} --out .planning/mar-checkpoints/plan-post --phase-dir .planning`,
        gate: "mar checkpoint verdict --out .planning/mar-checkpoints/plan-post",
      },
      {
        id: "mar-checkpoint-execute-post",
        point: "execute:post",
        skill: "mar-checkpoint-implementation",
        onError,
        command: `mar checkpoint implementation --mode ${mode} --out .planning/mar-checkpoints/execute-post`,
        gate: "mar checkpoint verdict --out .planning/mar-checkpoints/execute-post",
      },
    ],
  };
}

function buildPlanSkill(mode: GsdCheckpointMode): string {
  return `---
name: mar-checkpoint-plan
description: Run MAR checkpoint review after GSD plan creation.
---

# MAR Plan Checkpoint

Run:

\`\`\`bash
mar checkpoint plan --mode ${mode} --out .planning/mar-checkpoints/plan-post --phase-dir .planning
mar checkpoint verdict --out .planning/mar-checkpoints/plan-post
\`\`\`

Required mode halts on a blocking or invalid checkpoint verdict. Advisory mode records the same artifacts and lets GSD continue.
`;
}

function buildImplementationSkill(mode: GsdCheckpointMode): string {
  return `---
name: mar-checkpoint-implementation
description: Run MAR checkpoint review after GSD implementation work.
---

# MAR Implementation Checkpoint

Run:

\`\`\`bash
mar checkpoint implementation --mode ${mode} --out .planning/mar-checkpoints/execute-post
mar checkpoint verdict --out .planning/mar-checkpoints/execute-post
\`\`\`

Required mode halts on a blocking or invalid checkpoint verdict. Advisory mode records the same artifacts and lets GSD continue.
`;
}

export async function installGsdCapability(opts: GsdInstallOptions = {}): Promise<number> {
  const target = opts.target ?? ".";
  const mode = resolveMode(opts.mode);
  const root = join(target, ".gsd", "capabilities", "mar-checkpoints");
  const planSkillDir = join(root, "skills", "mar-checkpoint-plan");
  const implementationSkillDir = join(root, "skills", "mar-checkpoint-implementation");

  await mkdir(planSkillDir, { recursive: true });
  await mkdir(implementationSkillDir, { recursive: true });

  await writeFile(
    join(root, "capability.json"),
    `${JSON.stringify(buildCapability(mode), null, 2)}\n`,
    "utf8",
  );
  await writeFile(join(planSkillDir, "SKILL.md"), buildPlanSkill(mode), "utf8");
  await writeFile(join(implementationSkillDir, "SKILL.md"), buildImplementationSkill(mode), "utf8");

  process.stdout.write(`wrote GSD MAR checkpoint capability to ${root}\n`);
  process.stdout.write(`next: gsd capability install ${root} --scope project --yes\n`);
  return 0;
}
