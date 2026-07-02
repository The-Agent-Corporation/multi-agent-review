import { loadCredentials, MAR_CREDENTIAL_KEYS } from "../env/credentials.js";
import { ghText } from "./gh.js";

export interface SyncGithubSecretsOptions {
  repoPath?: string;
  githubRepo?: string;
  credentialsFile?: string;
}

export interface SyncGithubSecretsResult {
  repository: string;
  credentialsFile: string | undefined;
  set: string[];
  skipped: string[];
}

function cleanRepo(value: string): string {
  const trimmed = value.trim();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(trimmed)) {
    throw new Error(`invalid GitHub repository: ${value}`);
  }
  return trimmed;
}

export async function resolveGithubRepository(
  opts: SyncGithubSecretsOptions = {},
): Promise<string> {
  if (opts.githubRepo) return cleanRepo(opts.githubRepo);
  const stdout = await ghText(
    ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"],
    {
      cwd: opts.repoPath,
    },
  );
  return cleanRepo(stdout.trim());
}

export async function syncGithubSecrets(
  opts: SyncGithubSecretsOptions = {},
): Promise<SyncGithubSecretsResult> {
  const repository = await resolveGithubRepository(opts);
  const credentials = await loadCredentials({ file: opts.credentialsFile });
  const set: string[] = [];
  const skipped: string[] = [];

  for (const key of MAR_CREDENTIAL_KEYS) {
    const value = credentials[key];
    if (!value) {
      skipped.push(key);
      continue;
    }
    await ghText(["secret", "set", key, "--repo", repository], {
      cwd: opts.repoPath,
      input: value,
    });
    set.push(key);
  }

  return { repository, credentialsFile: opts.credentialsFile, set, skipped };
}
