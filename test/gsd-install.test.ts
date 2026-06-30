import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installGsdCapability } from "../src/gsd/install.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mar-gsd-install-"));
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

describe("installGsdCapability", () => {
  it("writes the required GSD MAR checkpoint capability overlay", async () => {
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const result = await installGsdCapability({ target: dir, mode: "required" });

    expect(result).toBe(0);

    const root = join(dir, ".gsd", "capabilities", "mar-checkpoints");
    const manifestPath = join(root, "capability.json");
    const planSkillPath = join(root, "skills", "mar-checkpoint-plan", "SKILL.md");
    const implementationSkillPath = join(
      root,
      "skills",
      "mar-checkpoint-implementation",
      "SKILL.md",
    );

    expect(existsSync(manifestPath)).toBe(true);
    expect(existsSync(planSkillPath)).toBe(true);
    expect(existsSync(implementationSkillPath)).toBe(true);

    const manifestText = readFileSync(manifestPath, "utf8");
    const manifest = JSON.parse(manifestText);
    expect(manifest.id).toBe("mar-checkpoints");
    expect(manifest.role).toBe("feature");
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(manifest.title).toBe("MAR checkpoints");
    expect(manifest.description).toContain("Multi-Agent Review");
    expect(manifest.tier).toBe("standard");
    expect(manifest.requires).toEqual([]);
    expect(manifest.engines.gsd).toBe(">=1.6.0");
    expect(manifest.runtimeCompat).toMatchObject({
      supported: ["*"],
      unsupported: [],
    });
    expect(manifest.config["workflow.mar_checkpoints"]).toMatchObject({
      type: "boolean",
      default: true,
    });
    expect(manifest.skills).toEqual([]);
    expect(manifest.agents).toEqual([]);
    expect(manifest.hooks).toEqual([]);
    expect(manifest.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          point: "plan:post",
          ref: {
            command:
              "mar checkpoint plan --mode required --out .planning/mar-checkpoints/plan-post --phase-dir .planning",
          },
          produces: ["MAR-CHECKPOINT-PLAN.md"],
          consumes: [],
          when: "workflow.mar_checkpoints",
          onError: "halt",
        }),
        expect.objectContaining({
          point: "execute:post",
          ref: {
            command:
              "mar checkpoint implementation --mode required --out .planning/mar-checkpoints/execute-post",
          },
          produces: ["MAR-CHECKPOINT-IMPLEMENTATION.md"],
          consumes: [],
          when: "workflow.mar_checkpoints",
          onError: "halt",
        }),
      ]),
    );
    expect(manifest.contributions).toEqual([]);
    expect(manifest.gates).toEqual([]);
    expect(manifestText).toContain("plan:post");
    expect(manifestText).toContain("execute:post");
    expect(manifestText).toContain("halt");
    expect(stdout).toHaveBeenCalledWith(expect.stringContaining("npx @opengsd/gsd-core@latest"));
    expect(stdout).toHaveBeenCalledWith(expect.stringContaining("gsd-tools capability install"));
    expect(stdout).toHaveBeenCalledWith(expect.stringContaining("--scope project --yes"));
    expect(stdout).toHaveBeenCalledWith(expect.stringContaining("timer or another unrelated tool"));

    const planSkill = readFileSync(planSkillPath, "utf8");
    expect(planSkill).toContain(
      "mar checkpoint plan --mode required --out .planning/mar-checkpoints/plan-post --phase-dir .planning",
    );
    expect(planSkill).toContain("mar checkpoint verdict --out .planning/mar-checkpoints/plan-post");

    const implementationSkill = readFileSync(implementationSkillPath, "utf8");
    expect(implementationSkill).toContain(
      "mar checkpoint implementation --mode required --out .planning/mar-checkpoints/execute-post",
    );
    expect(implementationSkill).toContain(
      "mar checkpoint verdict --out .planning/mar-checkpoints/execute-post",
    );
  });

  it("writes advisory capability hooks with skip-on-error behavior", async () => {
    await installGsdCapability({ target: dir, mode: "advisory" });

    const manifestText = readFileSync(
      join(dir, ".gsd", "capabilities", "mar-checkpoints", "capability.json"),
      "utf8",
    );
    const manifest = JSON.parse(manifestText);
    expect(manifest.id).toBe("mar-checkpoints");
    expect(manifest.config["workflow.mar_checkpoints"].default).toBe(true);
    expect(manifest.steps.every((step: { onError: string }) => step.onError === "skip")).toBe(true);
    expect(manifestText).toContain("skip");
  });

  it("prints OpenGSD-compatible local specs for relative target paths", async () => {
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const previousCwd = process.cwd();

    try {
      process.chdir(dir);
      await installGsdCapability({ target: "relative-target", mode: "required" });
    } finally {
      process.chdir(previousCwd);
    }

    expect(stdout).toHaveBeenCalledWith(
      expect.stringContaining(
        "gsd-tools capability install ./relative-target/.gsd/capabilities/mar-checkpoints --scope project --yes",
      ),
    );
  });
});
