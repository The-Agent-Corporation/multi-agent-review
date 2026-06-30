import { mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

export interface GsdInstallOptions {
  target?: string;
  mode?: string;
  force?: boolean;
}

type GsdCheckpointMode = "required" | "advisory";

interface CapabilityStep {
  point: string;
  ref: { command: string };
  produces: string[];
  consumes: string[];
  when: string;
  onError: "halt" | "skip";
}

interface CapabilityManifest {
  id: string;
  role: "feature";
  version: string;
  title: string;
  description: string;
  tier: "standard";
  requires: string[];
  engines: { gsd: string };
  runtimeCompat: {
    supported: string[];
    unsupported: string[];
    notes: Record<string, string>;
  };
  skills: string[];
  agents: string[];
  hooks: unknown[];
  config: Record<
    string,
    {
      type: "boolean";
      default: boolean;
      description: string;
    }
  >;
  steps: CapabilityStep[];
  contributions: unknown[];
  gates: unknown[];
}

const CAPABILITY_VERSION = "0.1.3";

function resolveMode(mode: string | undefined): GsdCheckpointMode {
  return mode === "advisory" ? "advisory" : "required";
}

function buildCapability(mode: GsdCheckpointMode): CapabilityManifest {
  const onError = mode === "required" ? "halt" : "skip";
  return {
    id: "mar-checkpoints",
    role: "feature",
    version: CAPABILITY_VERSION,
    title: "MAR checkpoints",
    description: "Runs Multi-Agent Review at GSD plan and implementation checkpoints.",
    tier: "standard",
    requires: [],
    engines: { gsd: ">=1.6.0" },
    runtimeCompat: {
      supported: ["*"],
      unsupported: [],
      notes: {
        "*": "Requires the mar CLI on PATH for the runtime session.",
      },
    },
    skills: [],
    agents: [],
    hooks: [],
    config: {
      "workflow.mar_checkpoints": {
        type: "boolean",
        default: true,
        description: "Enable MAR plan and implementation checkpoint steps.",
      },
    },
    steps: [
      {
        point: "plan:post",
        ref: {
          command: `mar checkpoint plan --mode ${mode} --out .planning/mar-checkpoints/plan-post --phase-dir .planning`,
        },
        produces: ["MAR-CHECKPOINT-PLAN.md"],
        consumes: [],
        when: "workflow.mar_checkpoints",
        onError,
      },
      {
        point: "execute:post",
        ref: {
          command: `mar checkpoint implementation --mode ${mode} --out .planning/mar-checkpoints/execute-post`,
        },
        produces: ["MAR-CHECKPOINT-IMPLEMENTATION.md"],
        consumes: [],
        when: "workflow.mar_checkpoints",
        onError,
      },
    ],
    contributions: [],
    gates: [],
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

function toOpenGsdLocalSpec(path: string): string {
  if (isAbsolute(path) || path.startsWith("./") || path.startsWith("../")) return path;
  return `./${path}`;
}

function buildNextSteps(root: string): string {
  const spec = toOpenGsdLocalSpec(root);
  return [
    "next:",
    "  1. If OpenGSD is not installed for this runtime, run: npx @opengsd/gsd-core@latest",
    `  2. Consent this project overlay with: npx -y -p @opengsd/gsd-core@latest gsd-tools capability install ${spec} --scope project --yes`,
    "  3. If a local `gsd` binary is a timer or another unrelated tool, prefer the `gsd-tools` command above.",
  ].join("\n");
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

  process.stdout.write(`wrote OpenGSD MAR checkpoint capability to ${root}\n`);
  process.stdout.write(`${buildNextSteps(root)}\n`);
  return 0;
}
