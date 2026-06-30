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
    expect(manifest.runtimeCompat.supported).toEqual(["*"]);
    expect(manifest.config).toMatchObject({
      key: "workflow.mar_checkpoints",
      mode: "required",
    });
    expect(manifest.skills).toEqual(["mar-checkpoint-plan", "mar-checkpoint-implementation"]);
    expect(manifest.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          point: "plan:post",
          skill: "mar-checkpoint-plan",
          onError: "halt",
        }),
        expect.objectContaining({
          point: "execute:post",
          skill: "mar-checkpoint-implementation",
          onError: "halt",
        }),
      ]),
    );
    expect(manifestText).toContain("plan:post");
    expect(manifestText).toContain("execute:post");
    expect(manifestText).toContain("halt");
    expect(stdout).toHaveBeenCalledWith(expect.stringContaining("gsd capability install"));
    expect(stdout).toHaveBeenCalledWith(expect.stringContaining("--scope project --yes"));

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
    expect(manifest.config.mode).toBe("advisory");
    expect(manifest.steps.every((step: { onError: string }) => step.onError === "skip")).toBe(true);
    expect(manifestText).toContain("skip");
  });
});
