import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { type EnvMap, loadMarEnv, parseMarEnv } from "./mar-env.js";

export const MAR_CREDENTIAL_KEYS = [
  "CLAUDE_CODE_OAUTH_TOKEN",
  "CODEX_ACCESS_TOKEN",
  "CODEX_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_CLOUD_PROJECT",
  "XAI_API_KEY",
  "GROK_API_KEY",
  "MAR_NOTIFY_WEBHOOK_URL",
  "MAR_NOTIFY_WEBHOOK_TOKEN",
  "MAR_NOTIFY_TARGET",
] as const;

export type MarCredentialKey = (typeof MAR_CREDENTIAL_KEYS)[number];

export interface CredentialsFileOptions {
  file?: string;
  env?: NodeJS.ProcessEnv;
}

export interface EnsureCredentialsFileResult {
  path: string;
  created: boolean;
}

export interface ImportCredentialsFromEnvResult {
  path: string;
  created: boolean;
  imported: string[];
  skipped: string[];
}

function nonEmpty(value: string | undefined): string | undefined {
  return value && value.trim().length > 0 ? value : undefined;
}

export function defaultCredentialsPath(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = nonEmpty(env.MAR_CREDENTIALS_FILE);
  if (explicit) return resolve(explicit);
  const configHome = nonEmpty(env.XDG_CONFIG_HOME) ?? join(homedir(), ".config");
  return join(configHome, "mar", "credentials.env");
}

function credentialPath(opts: CredentialsFileOptions = {}): string {
  return opts.file ? resolve(opts.file) : defaultCredentialsPath(opts.env);
}

function template(values: EnvMap = {}): string {
  return [
    "# MAR credential store.",
    "# Local secrets only. Do not commit this file.",
    "# Populate with `mar auth credentials import-env` or edit by hand.",
    ...MAR_CREDENTIAL_KEYS.map((key) => `${key}=${values[key] ?? ""}`),
    "",
  ].join("\n");
}

function knownCredentials(env: EnvMap): EnvMap {
  const out: EnvMap = {};
  for (const key of MAR_CREDENTIAL_KEYS) {
    const value = nonEmpty(env[key]);
    if (value) out[key] = value;
  }
  return out;
}

export async function ensureCredentialsFile(
  opts: CredentialsFileOptions = {},
): Promise<EnsureCredentialsFileResult> {
  const path = credentialPath(opts);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const created = !existsSync(path);
  if (created) {
    await writeFile(path, template(), { encoding: "utf8", mode: 0o600 });
  }
  await chmod(path, 0o600);
  return { path, created };
}

export async function loadCredentials(opts: CredentialsFileOptions = {}): Promise<EnvMap> {
  const path = credentialPath(opts);
  if (!existsSync(path)) return {};
  return knownCredentials(parseMarEnv(await readFile(path, "utf8")));
}

export async function loadEffectiveMarEnv(repoRoot = process.cwd()): Promise<EnvMap> {
  return { ...(await loadCredentials()), ...(await loadMarEnv(repoRoot)) };
}

export function credentialsFromEnv(env: NodeJS.ProcessEnv = process.env): EnvMap {
  const out: EnvMap = {};
  for (const key of MAR_CREDENTIAL_KEYS) {
    const value = nonEmpty(env[key]);
    if (value) out[key] = value;
  }
  return out;
}

export async function importCredentialsFromEnv(
  opts: CredentialsFileOptions = {},
): Promise<ImportCredentialsFromEnvResult> {
  const path = credentialPath(opts);
  const ensured = await ensureCredentialsFile({ ...opts, file: path });
  const existing = await loadCredentials({ file: path });
  const incoming = credentialsFromEnv(opts.env ?? process.env);
  const merged = { ...existing, ...incoming };
  await writeFile(path, template(merged), { encoding: "utf8", mode: 0o600 });
  await chmod(path, 0o600);
  return {
    path,
    created: ensured.created,
    imported: Object.keys(incoming).sort(),
    skipped: MAR_CREDENTIAL_KEYS.filter((key) => incoming[key] === undefined),
  };
}

export function redactedCredentialReport(env: EnvMap): string[] {
  return Object.keys(knownCredentials(env))
    .sort()
    .map((key) => `${key}=<redacted>`);
}
