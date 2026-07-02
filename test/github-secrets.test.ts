import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetGhRunner, setGhRunner } from "../src/github/gh.js";
import { syncGithubSecrets } from "../src/github/secrets.js";

let workdir: string;

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), "mar-github-secrets-"));
});

afterEach(() => {
  resetGhRunner();
  rmSync(workdir, { recursive: true, force: true });
});

describe("GitHub secret sync", () => {
  it("sets populated central credentials through gh stdin", async () => {
    const credentialsFile = join(workdir, "credentials.env");
    writeFileSync(
      credentialsFile,
      "CLAUDE_CODE_OAUTH_TOKEN=claude-secret\nCODEX_ACCESS_TOKEN=codex-secret\nXAI_API_KEY=xai-secret\n",
      "utf8",
    );
    const calls: Array<{ args: string[]; input?: string }> = [];
    setGhRunner(async (args, opts) => {
      calls.push({ args, input: opts?.input });
      return { stdout: "", stderr: "", exitCode: 0 };
    });

    const result = await syncGithubSecrets({
      repoPath: workdir,
      githubRepo: "The-Agent-Corporation/FirmVault",
      credentialsFile,
    });

    expect(result.repository).toBe("The-Agent-Corporation/FirmVault");
    expect(result.set).toEqual(["CLAUDE_CODE_OAUTH_TOKEN", "CODEX_ACCESS_TOKEN", "XAI_API_KEY"]);
    expect(calls).toEqual([
      {
        args: [
          "secret",
          "set",
          "CLAUDE_CODE_OAUTH_TOKEN",
          "--repo",
          "The-Agent-Corporation/FirmVault",
        ],
        input: "claude-secret",
      },
      {
        args: ["secret", "set", "CODEX_ACCESS_TOKEN", "--repo", "The-Agent-Corporation/FirmVault"],
        input: "codex-secret",
      },
      {
        args: ["secret", "set", "XAI_API_KEY", "--repo", "The-Agent-Corporation/FirmVault"],
        input: "xai-secret",
      },
    ]);
    expect(calls.flatMap((call) => call.args)).not.toContain("claude-secret");
    expect(calls.flatMap((call) => call.args)).not.toContain("codex-secret");
    expect(calls.flatMap((call) => call.args)).not.toContain("xai-secret");
    expect(result.skipped).toContain("CODEX_API_KEY");
  });

  it("resolves the current GitHub repository when owner/name is omitted", async () => {
    const credentialsFile = join(workdir, "credentials.env");
    writeFileSync(credentialsFile, "CODEX_ACCESS_TOKEN=codex-secret\n", "utf8");
    const calls: Array<{ args: string[]; input?: string }> = [];
    setGhRunner(async (args, opts) => {
      calls.push({ args, input: opts?.input });
      if (args[0] === "repo") {
        return { stdout: "The-Agent-Corporation/FirmVault\n", stderr: "", exitCode: 0 };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    });

    await expect(syncGithubSecrets({ repoPath: workdir, credentialsFile })).resolves.toMatchObject({
      repository: "The-Agent-Corporation/FirmVault",
      set: ["CODEX_ACCESS_TOKEN"],
    });
    expect(calls[0].args).toEqual([
      "repo",
      "view",
      "--json",
      "nameWithOwner",
      "--jq",
      ".nameWithOwner",
    ]);
  });
});
