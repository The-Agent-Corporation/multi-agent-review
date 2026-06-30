# GSD MAR Checkpoint Capability Design

## Decision

Build MAR into GSD as a project capability overlay, not as a long-lived GSD fork.

GSD owns the work loop: discuss, design/spec where present, plan, execute, verify, ship. MAR owns the adversarial multi-model review protocol that can run at those loop boundaries. From a user's point of view, the review layer should feel native to GSD, but MAR should stay a separate engine so it can also serve PR review and non-GSD workflows.

Fork GSD only if a concrete extension point is missing and cannot be supplied by a small upstream patch.

## Goals

- Add blocking MAR review checkpoints to GSD loop transitions.
- Keep coding itself single-worker. MAR runs when the worker produces a user-facing artifact or reaches a loop boundary.
- Review all important GSD artifacts: intent/context, design/spec, plan, implementation diff, verification/fix state, and PR/ship state.
- Default to blocking on serious findings.
- Default blocked resolution to asking the user.
- Allow an opt-in auto-fix-and-rerun mode with bounded retries.
- Keep reviewer work isolated in MAR run workspaces and repo-aware worktrees.
- Preserve MAR's independence invariant: reviewers do not see peer drafts before the cross-review boundary.

## Non-Goals

- Do not replace GSD's phase loop.
- Do not embed MAR protocol logic inside GSD Core.
- Do not start with a daemon or real-time agent bus.
- Do not require a single vendor runtime.
- Do not make a broad GSD fork just to install files or commands.

## User Experience

The primary setup command is:

```bash
mar gsd install --mode required
```

It installs a project-scoped GSD capability overlay for the current repository. Required mode enables blocking gates by default. Advisory mode can be used for early rollout:

```bash
mar gsd install --mode advisory
```

GSD then runs as normal. At each enabled checkpoint, MAR writes artifacts such as:

```text
.planning/mar-checkpoints/
  plan-post/
    latest.json
    20260630-abc123/
      input.md
      verdict.json
      summary.md
      run-id.txt
```

If MAR blocks, the user sees the blocker summary and GSD stops before crossing the boundary. The default next action is to ask the user what to do: revise manually, waive with a reason, or run an optional auto-fix cycle if enabled.

## Checkpoint Stages

| GSD point | MAR stage | Review target |
| --- | --- | --- |
| `discuss:post` | `intent` | Phase context, decisions, constraints, discussion log |
| `plan:pre` | `spec` | UI-SPEC, AI-SPEC, requirement/spec artifacts if present |
| `plan:post` | `plan` | PLAN.md files before execution |
| `execute:post` | `implementation` | final phase diff plus summaries |
| `verify:post` | `verification` | VERIFICATION.md, REVIEW.md, fix state, deferred issues |
| `ship:pre` | `ship` | PR brief, release notes, current branch diff/status |

The first implementation should support `plan`, `implementation`, and `ship` because these have the clearest high-value failure modes and map to existing MAR PR/diff behavior. The design must keep the stage enum complete so intent/spec/verification can be added without changing the public API.

## CLI Surface

### Run a Checkpoint

```bash
mar checkpoint plan --phase-dir .planning/phases/06-example --mode required
mar checkpoint implementation --base main --mode required
mar checkpoint ship --pr 42 --mode required
```

Common flags:

- `--mode required|advisory`: required exits non-zero on block; advisory writes artifacts and exits zero.
- `--out <dir>`: checkpoint artifact directory. Default: `.planning/mar-checkpoints/<stage>/`.
- `--config <path>`: MAR roster config, same meaning as existing commands.
- `--gated|--autonomous`: passed through to MAR protocol run.
- `--max-diff-bytes <n>`: caps generated diff input.
- `--allow-self-review`: permits the current runtime's vendor as a reviewer. Default remains independence-first.

### Read a Verdict

```bash
mar checkpoint verdict --stage plan --out .planning/mar-checkpoints/plan-post
```

This is deterministic. It reads the latest `verdict.json` and exits:

- `0` for pass, warn, advisory block, or waived verdicts.
- `2` for required block.
- `1` for missing/corrupt verdict or internal error.

This command is what GSD gates or gate-like skills call. The LLM review is not the gate; the saved verdict is.

### Install GSD Overlay

```bash
mar gsd install --mode required --target .
```

The installer writes a local capability bundle and, when a usable GSD capability lifecycle is present, asks GSD to install/consent it project-locally. If OpenGSD is not installed for the target runtime, MAR writes the bundle, points the user at `npx @opengsd/gsd-core@latest`, and prints an `npx -p @opengsd/gsd-core@latest gsd-tools capability install ...` command. Dogfood found one machine where `gsd` resolved to an unrelated timer CLI, so MAR should not rely on a bare `gsd` binary.

## Verdict Contract

`verdict.json` is the blocking contract:

```json
{
  "schemaVersion": 1,
  "stage": "plan",
  "point": "plan:post",
  "mode": "required",
  "status": "pass",
  "runId": "20260630-abc123",
  "summaryPath": ".planning/mar-checkpoints/plan-post/20260630-abc123/summary.md",
  "blockers": [],
  "warnings": [],
  "nextAction": "none",
  "createdAt": "2026-06-30T00:00:00.000Z"
}
```

Statuses:

- `pass`: no blocking findings.
- `warn`: non-blocking findings only.
- `block`: must stop in required mode.
- `waived`: user explicitly waived the block with a reason.
- `error`: MAR could not produce a trustworthy review; required mode treats this as blocking.

Blocker shape:

```json
{
  "id": "MAR-BLOCKER-001",
  "severity": "critical",
  "title": "Plan omits migration rollback",
  "evidence": ["src/db/migrate.ts:42"],
  "recommendation": "Add rollback acceptance criteria before execution."
}
```

Severity values are `critical`, `high`, `medium`, `low`, and `info`. Required mode blocks on `critical` and `high` by default. The policy can be changed later, but the first version should keep this simple.

## Producing the Verdict

MAR runs the existing 6-phase protocol over a checkpoint request document. That document instructs reviewers to produce a machine-readable verdict in the final integrated artifact using a fenced block:

````markdown
```mar-verdict-json
{ "status": "block", "blockers": [...] }
```
````

After the run, MAR extracts and validates the block. If no valid verdict exists, required mode fails closed with an `error` verdict. This keeps the GSD gate deterministic even though the review itself is model-driven.

## GSD Capability Overlay Shape

The generated capability should be project-scoped and named `mar-checkpoints`.

```text
.gsd/capabilities/mar-checkpoints/
  capability.json
  skills/
    mar-checkpoint-plan/SKILL.md
    mar-checkpoint-implementation/SKILL.md
    mar-checkpoint-ship/SKILL.md
```

The manifest should use direct command refs for loop steps, for example `ref.command: "mar checkpoint plan ..."`. Current OpenGSD activation treats manifest-declared skills as runtime-surfaced capabilities; third-party overlay skills may be installed and trusted without becoming surfaced in a Claude/Codex runtime. Keeping the manifest `skills` list empty and using command refs lets the hooks activate while still shipping the `skills/` docs as human-readable fallback instructions.

The manifest should register:

- steps that run MAR checkpoint review.
- gates, or gate-like deterministic command steps, that read `verdict.json`.

If GSD supports third-party command-family gate queries in the target version, use gates. If not, use a second skill/command step with `onError: "halt"` as a compatibility fallback and document that it is a transitional path.

## Required Mode Behavior

Required mode:

1. Runs the checkpoint.
2. Writes `verdict.json`.
3. If verdict is `block` or `error`, exits non-zero.
4. The GSD loop stops at that boundary.
5. The user is shown the blocker summary and next actions.

Advisory mode:

1. Runs the checkpoint.
2. Writes `verdict.json`.
3. Always exits zero unless MAR itself crashed before writing any verdict.
4. GSD continues, but the summary names warnings and blockers.

## Auto-Fix Mode

Auto-fix is opt-in and bounded.

Config:

```json
{
  "mar": {
    "autoFix": {
      "enabled": false,
      "maxCycles": 2,
      "worker": "gsd"
    }
  }
}
```

When enabled, a `block` verdict can trigger one repair cycle:

1. Write `fix-request.md` from blockers.
2. Ask GSD or the host coding worker to apply a focused fix.
3. Rerun the same MAR checkpoint.
4. Stop after `maxCycles` even if blockers remain.

The default remains ask-the-user. Auto-fix should not ship in the first minimal slice unless checkpoint verdicts and required gates are already reliable.

## Security and Trust

- GSD installation should be explicit. MAR must not silently patch global GSD settings.
- Project capability install should disclose executable surfaces.
- Review worktrees are isolation for accidental writes, not a security sandbox.
- Required mode fails closed on missing or malformed verdicts.
- No model output is trusted as a gate until it is written to `verdict.json` and validated.
- Waivers require a human-authored reason and are written to the checkpoint artifact directory.

## Open Questions

- Whether the installed GSD version can dispatch third-party command families from gates, or only from steps.
- Whether the OpenGSD capability lifecycle is consistently available on the user's machines; dogfood found one shell where `gsd` resolved to an unrelated timer CLI.
- Whether GSD should receive an upstream patch for a first-class `external-command` gate check if command-family gate queries are not enough.

## First Slice

Implement:

1. `mar checkpoint plan`
2. `mar checkpoint implementation`
3. `mar checkpoint verdict`
4. `mar gsd install --mode required|advisory`
5. Project capability bundle generation for `plan:post` and `execute:post`

Defer:

- intent/spec/verification checkpoints
- auto-fix cycles
- native GSD upstream patches
- broad host integration outside GSD
