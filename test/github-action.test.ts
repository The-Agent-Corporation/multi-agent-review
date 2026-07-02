import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const actionPath = "action.yml";
const workflowPath = join(".github", "workflows", "mar-pr-review.yml");

describe("GitHub Action PR review wrapper", () => {
  it("exposes a composite action that target repositories can call", () => {
    expect(existsSync(actionPath)).toBe(true);
    const action = readFileSync(actionPath, "utf8");

    expect(action).toContain("using: composite");
    expect(action).toContain("pr:");
    expect(action).toContain("notify-webhook-url:");
    expect(action).toContain("notify-webhook-token:");
    expect(action).toContain("notify-kind:");
    expect(action).toContain("notify-target:");
    expect(action).toContain("default: default");
    expect(action).toContain("claude-oauth-token:");
    expect(action).toContain("codex-access-token:");
    expect(action).toContain("codex-api-key:");
    expect(action).toContain("gemini-api-key:");
    expect(action).toContain("google-cloud-project:");
    expect(action).toContain("xai-api-key:");
    expect(action).toContain("grok-api-key:");
    expect(action).toContain("github-token:");
    expect(action).toContain("working-directory: $" + "{{ github.action_path }}");
    expect(action).toContain("uses: actions/checkout@v4");
    expect(action).toContain("working-directory: $" + "{{ github.workspace }}");
    expect(action).toContain("npm ci");
    expect(action).toContain("npm run build");
    expect(action).toContain('node "$' + '{GITHUB_ACTION_PATH}/dist/src/cli.js" preflight');
    expect(action).toContain("ready_vendors");
    expect(action).toContain("continuing with surviving-agent protocol");
    expect(action).toContain('--config "$MAR_CONFIG"');
    expect(action).toContain('node "$' + '{GITHUB_ACTION_PATH}/dist/src/cli.js" "$' + '{args[@]}"');
    expect(action).toContain("GH_TOKEN: $" + "{{ inputs.github-token }}");
    expect(action).toContain("MAR_NOTIFY_WEBHOOK_URL: $" + "{{ inputs.notify-webhook-url }}");
    expect(action).toContain("MAR_NOTIFY_WEBHOOK_TOKEN: $" + "{{ inputs.notify-webhook-token }}");
    expect(action).toContain("MAR_NOTIFY_KIND: $" + "{{ inputs.notify-kind }}");
    expect(action).toContain("MAR_NOTIFY_TARGET: $" + "{{ inputs.notify-target }}");
    expect(action).toContain("CLAUDE_CODE_OAUTH_TOKEN: $" + "{{ inputs.claude-oauth-token }}");
    expect(action).toContain("CODEX_ACCESS_TOKEN: $" + "{{ inputs.codex-access-token }}");
    expect(action).toContain("CODEX_API_KEY: $" + "{{ inputs.codex-api-key }}");
    expect(action).toContain("GEMINI_API_KEY: $" + "{{ inputs.gemini-api-key }}");
    expect(action).toContain("GOOGLE_CLOUD_PROJECT: $" + "{{ inputs.google-cloud-project }}");
    expect(action).toContain("XAI_API_KEY: $" + "{{ inputs.xai-api-key }}");
    expect(action).toContain("GROK_API_KEY: $" + "{{ inputs.grok-api-key }}");
    expect(action).toContain("codex login --with-access-token");
    expect(action).toContain("codex login --with-api-key");
    expect(action).toContain("unset CODEX_ACCESS_TOKEN");
    expect(action).toContain("unset CODEX_API_KEY");
    expect(action).toContain("unset OPENAI_API_KEY");
    expect(action).toContain("MAR_CONFIG: $" + "{{ github.action_path }}/mar.config.json");
    expect(action).toContain("PREFLIGHT: $" + "{{ inputs.preflight }}");
    expect(action).toContain("gh pr view");
    expect(action).toContain("headRefOid");
    expect(action).toContain("number");
    expect(action).toContain("repos/$" + "{GITHUB_REPOSITORY}/statuses/$" + "{status_sha}");
    expect(action).toContain("find_status_comment_id");
    expect(action).toContain("post_success_comment");
    expect(action).toContain("post_failure_comment");
    expect(action).toContain("post_completion_notification");
    expect(action).toContain('pr notify "$' + '{PR_SELECTOR}"');
    expect(action).toContain('--status "$' + '{state}"');
    expect(action).toContain("<!-- mar-review-status -->");
    expect(action).toContain("MAR multi-agent review");
    expect(action).toContain("MAR multi-agent review in progress");
    expect(action).toContain("MAR multi-agent review completed");
    expect(action).toContain("posted a unified PR review");
    expect(action).toContain("MAR multi-agent review failed");
    expect(action).toContain("Open the workflow run logs");
    expect(action).toContain("issues/$" + "{pr_number}/comments");
    expect(action).toContain("issues: write");
    expect(action).toContain("statuses: write");
  });

  it("is an automatic and manual self-hosted wrapper around the built mar CLI", () => {
    expect(existsSync(workflowPath)).toBe(true);
    const workflow = readFileSync(workflowPath, "utf8");

    expect(workflow).toContain("pull_request:");
    expect(workflow).toContain("types: [opened, reopened, synchronize, ready_for_review]");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("pr:");
    expect(workflow).toContain("issues: write");
    expect(workflow).toContain("statuses: write");
    expect(workflow).toContain("cancel-in-progress: true");
    expect(workflow).toContain("runs-on: self-hosted");
    expect(workflow).toContain("!github.event.pull_request.draft");
    expect(workflow).toContain(
      "github.event.pull_request.head.repo.full_name == github.repository",
    );
    expect(workflow).toContain("Resolve PR review mode");
    expect(workflow).toContain("MAR_POST_REVIEW=true");
    expect(workflow).toContain("uses: ./");
    expect(workflow).toContain("pr: $" + "{{ env.PR_SELECTOR }}");
    expect(workflow).toContain("post: $" + "{{ env.MAR_POST_REVIEW }}");
    expect(workflow).toContain("claude-oauth-token: $" + "{{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}");
    expect(workflow).toContain("codex-access-token: $" + "{{ secrets.CODEX_ACCESS_TOKEN }}");
    expect(workflow).toContain("codex-api-key: $" + "{{ secrets.CODEX_API_KEY }}");
    expect(workflow).toContain("gemini-api-key: $" + "{{ secrets.GEMINI_API_KEY }}");
    expect(workflow).toContain(
      "google-cloud-project: $" + "{{ secrets.GOOGLE_CLOUD_PROJECT || vars.GOOGLE_CLOUD_PROJECT }}",
    );
    expect(workflow).toContain("xai-api-key: $" + "{{ secrets.XAI_API_KEY }}");
    expect(workflow).toContain("grok-api-key: $" + "{{ secrets.GROK_API_KEY }}");
    expect(workflow).toContain("notify-webhook-url: $" + "{{ secrets.MAR_NOTIFY_WEBHOOK_URL }}");
    expect(workflow).toContain(
      "notify-webhook-token: $" + "{{ secrets.MAR_NOTIFY_WEBHOOK_TOKEN }}",
    );
    expect(workflow).toContain(
      "notify-kind: $" + "{{ vars.MAR_NOTIFY_KIND || 'claude-code-channel' }}",
    );
    expect(workflow).toContain(
      "notify-target: $" + "{{ secrets.MAR_NOTIFY_TARGET || vars.MAR_NOTIFY_TARGET || 'default' }}",
    );
    expect(workflow).toContain("github-token: $" + "{{ github.token }}");
  });
});
