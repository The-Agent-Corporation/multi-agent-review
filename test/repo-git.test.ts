import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { agentWorktreePath, createAgentWorktree, detectGitRepo } from "../src/repo/git.js";

let workdir: string;

function git(args: string[], cwd = workdir): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), "mar-git-"));
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
});

describe("detectGitRepo", () => {
  it("returns undefined outside a git repo", async () => {
    expect(await detectGitRepo(workdir)).toBeUndefined();
  });

  it("detects git root and head commit", async () => {
    git(["init", "-q"]);
    git(["config", "user.email", "a@example.com"]);
    git(["config", "user.name", "A"]);
    writeFileSync(join(workdir, "README.md"), "# test\n", "utf8");
    git(["add", "README.md"]);
    git(["commit", "-qm", "init"]);

    const repo = await detectGitRepo(workdir);
    expect(realpathSync(repo?.root as string)).toBe(realpathSync(resolve(workdir)));
    expect(repo?.commit).toBe(git(["rev-parse", "HEAD"]));
  });
});

describe("agent worktrees", () => {
  it("creates a detached worktree under the run directory", async () => {
    git(["init", "-q"]);
    git(["config", "user.email", "a@example.com"]);
    git(["config", "user.name", "A"]);
    writeFileSync(join(workdir, "README.md"), "# test\n", "utf8");
    git(["add", "README.md"]);
    git(["commit", "-qm", "init"]);
    const commit = git(["rev-parse", "HEAD"]);
    const runDir = join(workdir, "runs", "r1");

    const worktree = await createAgentWorktree({
      repoRoot: workdir,
      commit,
      runDir,
      agent: "claude-1",
    });

    expect(worktree.path).toBe(agentWorktreePath(runDir, "claude-1"));
    expect(worktree.strategy).toBe("git-worktree");
    expect(existsSync(join(worktree.path, "README.md"))).toBe(true);
  });

  it("falls back to a detached local clone when linked worktree metadata cannot be created", async () => {
    git(["init", "-q"]);
    git(["config", "user.email", "a@example.com"]);
    git(["config", "user.name", "A"]);
    writeFileSync(join(workdir, "README.md"), "# test\n", "utf8");
    git(["add", "README.md"]);
    git(["commit", "-qm", "init"]);
    const commit = git(["rev-parse", "HEAD"]);
    const runDir = join(workdir, "runs", "r1");

    writeFileSync(join(workdir, ".git", "worktrees"), "not a directory\n", "utf8");

    const worktree = await createAgentWorktree({
      repoRoot: workdir,
      commit,
      runDir,
      agent: "claude-1",
    });

    expect(worktree.path).toBe(agentWorktreePath(runDir, "claude-1"));
    expect(worktree.strategy).toBe("git-clone");
    expect(existsSync(join(worktree.path, "README.md"))).toBe(true);
    expect(git(["-C", worktree.path, "rev-parse", "HEAD"])).toBe(commit);
  });

  it("rejects unsafe agent path segments", () => {
    expect(() => agentWorktreePath(join(workdir, "runs", "r1"), "../evil")).toThrow(/unsafe/);
  });
});
