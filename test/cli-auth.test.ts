import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { buildProgram } from "../src/cli.js";
import { resetGhRunner, setGhRunner } from "../src/github/gh.js";

vi.setConfig({ testTimeout: 30_000 });

let workdir: string;
const originalCwd = process.cwd();
const envKeys = ["CLAUDE_CODE_OAUTH_TOKEN", "CODEX_ACCESS_TOKEN", "XAI_API_KEY"] as const;
const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), "mar-cli-auth-"));
  process.chdir(workdir);
  process.exitCode = undefined;
});

afterEach(() => {
  process.chdir(originalCwd);
  vi.restoreAllMocks();
  resetGhRunner();
  for (const key of envKeys) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(workdir, { recursive: true, force: true });
});

it("mar auth init creates repo-local env files without printing secret values", async () => {
  let stdout = "";
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
    stdout += String(chunk);
    return true;
  });

  await buildProgram().parseAsync(["node", "mar", "auth", "init"], { from: "node" });

  expect(process.exitCode).toBe(0);
  const envPath = join(workdir, ".mar", "MAR.env");
  expect(existsSync(envPath)).toBe(true);
  expect(existsSync(join(workdir, ".mar", "MAR.env.example"))).toBe(true);
  expect(readFileSync(join(workdir, ".gitignore"), "utf8")).toContain(".mar/MAR.env");
  expect(statSync(envPath).mode & 0o777).toBe(0o600);
  expect(stdout).not.toContain("ANTHROPIC_API_KEY=<redacted>");
  expect(stdout).not.toContain("secret");
});

it("mar auth credentials init creates the central credential file without values", async () => {
  let stdout = "";
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
    stdout += String(chunk);
    return true;
  });
  const file = join(workdir, "credentials.env");

  await buildProgram().parseAsync(["node", "mar", "auth", "credentials", "init", "--file", file], {
    from: "node",
  });

  expect(process.exitCode).toBe(0);
  expect(existsSync(file)).toBe(true);
  expect(statSync(file).mode & 0o777).toBe(0o600);
  expect(readFileSync(file, "utf8")).toContain("CODEX_ACCESS_TOKEN=");
  expect(stdout).toContain(file);
  expect(stdout).not.toContain("secret");
});

it("mar auth credentials import-env imports known keys without printing values", async () => {
  let stdout = "";
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
    stdout += String(chunk);
    return true;
  });
  process.env.CLAUDE_CODE_OAUTH_TOKEN = "claude-secret";
  process.env.CODEX_ACCESS_TOKEN = "codex-secret";
  process.env.XAI_API_KEY = "xai-secret";
  const file = join(workdir, "credentials.env");

  await buildProgram().parseAsync(
    ["node", "mar", "auth", "credentials", "import-env", "--file", file],
    { from: "node" },
  );

  expect(process.exitCode).toBe(0);
  const text = readFileSync(file, "utf8");
  expect(text).toContain("CLAUDE_CODE_OAUTH_TOKEN=claude-secret");
  expect(text).toContain("CODEX_ACCESS_TOKEN=codex-secret");
  expect(text).toContain("XAI_API_KEY=xai-secret");
  expect(stdout).toContain("CLAUDE_CODE_OAUTH_TOKEN");
  expect(stdout).toContain("CODEX_ACCESS_TOKEN");
  expect(stdout).not.toContain("claude-secret");
  expect(stdout).not.toContain("codex-secret");
  expect(stdout).not.toContain("xai-secret");
});

it("mar auth sync-github writes central credentials to GitHub secrets via stdin", async () => {
  let stdout = "";
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
    stdout += String(chunk);
    return true;
  });
  const file = join(workdir, "credentials.env");
  writeFileSync(file, "CODEX_ACCESS_TOKEN=codex-secret\n", "utf8");
  const calls: Array<{ args: string[]; input?: string }> = [];
  setGhRunner(async (args, opts) => {
    calls.push({ args, input: opts?.input });
    return { stdout: "", stderr: "", exitCode: 0 };
  });

  await buildProgram().parseAsync(
    [
      "node",
      "mar",
      "auth",
      "sync-github",
      "--github-repo",
      "The-Agent-Corporation/FirmVault",
      "--credentials-file",
      file,
    ],
    { from: "node" },
  );

  expect(process.exitCode).toBe(0);
  expect(calls).toEqual([
    {
      args: ["secret", "set", "CODEX_ACCESS_TOKEN", "--repo", "The-Agent-Corporation/FirmVault"],
      input: "codex-secret",
    },
  ]);
  expect(stdout).toContain("set secrets: CODEX_ACCESS_TOKEN");
  expect(stdout).not.toContain("codex-secret");
});
