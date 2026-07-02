import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ensureCredentialsFile,
  importCredentialsFromEnv,
  loadCredentials,
  loadEffectiveMarEnv,
  redactedCredentialReport,
} from "../src/env/credentials.js";

let workdir: string;
const previousCredentialsFile = process.env.MAR_CREDENTIALS_FILE;

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), "mar-credentials-"));
  delete process.env.MAR_CREDENTIALS_FILE;
});

afterEach(() => {
  if (previousCredentialsFile === undefined) delete process.env.MAR_CREDENTIALS_FILE;
  else process.env.MAR_CREDENTIALS_FILE = previousCredentialsFile;
  rmSync(workdir, { recursive: true, force: true });
});

describe("central MAR credentials", () => {
  it("creates a credential file with provider keys and private permissions", async () => {
    const file = join(workdir, "credentials.env");
    const result = await ensureCredentialsFile({ file });

    expect(result).toEqual({ path: file, created: true });
    expect(existsSync(file)).toBe(true);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const text = readFileSync(file, "utf8");
    expect(text).toContain("CLAUDE_CODE_OAUTH_TOKEN=");
    expect(text).toContain("CODEX_ACCESS_TOKEN=");
    expect(text).toContain("CODEX_API_KEY=");
    expect(text).toContain("GEMINI_API_KEY=");
    expect(text).toContain("XAI_API_KEY=");
  });

  it("imports known shell credentials without exposing values in reports", async () => {
    const file = join(workdir, "credentials.env");
    const result = await importCredentialsFromEnv({
      file,
      env: {
        CLAUDE_CODE_OAUTH_TOKEN: "claude-secret",
        CODEX_ACCESS_TOKEN: "codex-secret",
        XAI_API_KEY: "xai-secret",
        UNKNOWN_SECRET: "ignored",
      },
    });

    expect(result.imported).toEqual([
      "CLAUDE_CODE_OAUTH_TOKEN",
      "CODEX_ACCESS_TOKEN",
      "XAI_API_KEY",
    ]);
    expect(await loadCredentials({ file })).toEqual({
      CLAUDE_CODE_OAUTH_TOKEN: "claude-secret",
      CODEX_ACCESS_TOKEN: "codex-secret",
      XAI_API_KEY: "xai-secret",
    });
    expect(redactedCredentialReport(await loadCredentials({ file }))).toEqual([
      "CLAUDE_CODE_OAUTH_TOKEN=<redacted>",
      "CODEX_ACCESS_TOKEN=<redacted>",
      "XAI_API_KEY=<redacted>",
    ]);
    expect(redactedCredentialReport(await loadCredentials({ file })).join("\n")).not.toContain(
      "secret",
    );
  });

  it("loads central credentials and lets repo-local MAR.env override them", async () => {
    const credentialsFile = join(workdir, "credentials.env");
    process.env.MAR_CREDENTIALS_FILE = credentialsFile;
    await importCredentialsFromEnv({
      file: credentialsFile,
      env: {
        CODEX_ACCESS_TOKEN: "central-codex",
        GEMINI_API_KEY: "central-gemini",
      },
    });
    mkdirSync(join(workdir, ".mar"));
    writeFileSync(
      join(workdir, ".mar", "MAR.env"),
      "CODEX_ACCESS_TOKEN=repo-codex\nXAI_API_KEY=repo-xai\n",
      "utf8",
    );

    await expect(loadEffectiveMarEnv(workdir)).resolves.toEqual({
      CODEX_ACCESS_TOKEN: "repo-codex",
      GEMINI_API_KEY: "central-gemini",
      XAI_API_KEY: "repo-xai",
    });
  });
});
