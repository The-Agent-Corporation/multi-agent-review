import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";
import { afterEach, describe, expect, it } from "vitest";
import { buildProgram, discoverPlanFiles, readCheckpointDiff } from "../src/cli.js";

let workdir: string | undefined;

afterEach(() => {
  process.exitCode = undefined;
  if (workdir) {
    rmSync(workdir, { recursive: true, force: true });
    workdir = undefined;
  }
});

describe("checkpoint CLI registration", () => {
  it("registers checkpoint and gsd commands in the CLI source", () => {
    const cli = readFileSync("src/cli.ts", "utf8");
    expect(cli).toContain('.command("checkpoint")');
    expect(cli).toContain('.command("gsd")');
    expect(cli).toContain("checkpoint verdict");
    expect(cli).toContain("gsd install");
    expect(cli).toContain("runCheckpoint");
    expect(cli).toContain("gateExitCode");
    expect(cli).toContain('git", ["diff", "--no-ext-diff"');
    expect(cli).toContain('git", ["ls-files", "--others", "--exclude-standard"');
    expect(cli).toContain("discoverPlanFiles");
    expect(cli).toContain("writeCheckpointCliErrorVerdict");
    expect(cli).toContain("--max-diff-bytes");
  });

  it("lists checkpoint and gsd in top-level help", () => {
    const help = buildProgram().helpInformation();
    expect(help).toContain("checkpoint");
    expect(help).toContain("gsd");
  });

  it("writes a deterministic checkpoint error verdict when setup fails before MAR runs", async () => {
    const priorCwd = process.cwd();
    workdir = mkdtempSync(join(tmpdir(), "mar-cli-checkpoint-"));
    process.chdir(workdir);
    try {
      const outDir = join(workdir, "checkpoint-out");
      await buildProgram().parseAsync(
        ["node", "mar", "checkpoint", "implementation", "--out", outDir],
        { from: "node" },
      );

      expect(process.exitCode).toBe(2);
      const latestPath = join(outDir, "latest.json");
      expect(existsSync(latestPath)).toBe(true);
      const latest = JSON.parse(readFileSync(latestPath, "utf8"));
      expect(latest).toMatchObject({
        stage: "implementation",
        point: "execute:post",
        mode: "required",
        status: "error",
        nextAction: "ask_user",
      });
      expect(latest.blockers[0]).toMatchObject({
        id: "MAR-CHECKPOINT-CLI-SETUP",
        severity: "critical",
      });
    } finally {
      process.chdir(priorCwd);
    }
  });

  it("writes an error verdict for invalid checkpoint options before verdict evaluation", async () => {
    const priorCwd = process.cwd();
    workdir = mkdtempSync(join(tmpdir(), "mar-cli-invalid-option-"));
    process.chdir(workdir);
    try {
      const outDir = join(workdir, "checkpoint-out");
      await buildProgram().parseAsync(
        ["node", "mar", "checkpoint", "implementation", "--out", outDir, "--max-diff-bytes", "0"],
        { from: "node" },
      );

      expect(process.exitCode).toBe(2);
      const latest = JSON.parse(readFileSync(join(outDir, "latest.json"), "utf8"));
      expect(latest).toMatchObject({
        stage: "implementation",
        status: "error",
        nextAction: "ask_user",
      });
      expect(latest.blockers[0].evidence[0]).toContain("--max-diff-bytes");
    } finally {
      process.chdir(priorCwd);
    }
  });

  it("discovers plan-like files under the phase directory", async () => {
    workdir = mkdtempSync(join(tmpdir(), "mar-cli-plan-discovery-"));
    writeFileSync(join(workdir, "b.md"), "# B\n", "utf8");
    writeFileSync(join(workdir, "a.markdown"), "# A\n", "utf8");
    writeFileSync(join(workdir, "notes.txt"), "notes\n", "utf8");
    writeFileSync(join(workdir, "skip.json"), "{}", "utf8");

    expect(await discoverPlanFiles(workdir)).toEqual([
      join(workdir, "a.markdown"),
      join(workdir, "b.md"),
      join(workdir, "notes.txt"),
    ]);
  });

  it("includes untracked files in implementation checkpoint diff and enforces the cap before reading", async () => {
    const priorCwd = process.cwd();
    workdir = mkdtempSync(join(tmpdir(), "mar-cli-diff-"));
    process.chdir(workdir);
    try {
      await execa("git", ["init"], { cwd: workdir });
      await execa("git", ["config", "user.email", "test@example.com"], { cwd: workdir });
      await execa("git", ["config", "user.name", "Test User"], { cwd: workdir });
      writeFileSync(join(workdir, "tracked.txt"), "before\n", "utf8");
      await execa("git", ["add", "tracked.txt"], { cwd: workdir });
      await execa("git", ["commit", "-m", "base"], { cwd: workdir });
      writeFileSync(join(workdir, "tracked.txt"), "after\n", "utf8");
      writeFileSync(join(workdir, "new-file.txt"), "new content\n", "utf8");

      const diff = await readCheckpointDiff("HEAD");
      expect(diff).toContain("diff --git");
      expect(diff).toContain("after");
      expect(diff).toContain("## Untracked file: new-file.txt");
      expect(diff).toContain("new content");
      await expect(readCheckpointDiff("HEAD", 4)).rejects.toThrow(/exceeds the 4-byte cap/);
    } finally {
      process.chdir(priorCwd);
    }
  });
});
