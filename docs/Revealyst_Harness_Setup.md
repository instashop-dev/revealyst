# Revealyst — Harness Setup Status

**Date:** July 4, 2026 · **Basis:** [Claude Code Workflow v1.4](Revealyst_Claude_Code_Workflow.md)

This records what the harness looks like right now. The **full §2 apparatus** is implemented
— hooks, custom subagents, and the saved gate-review workflow are all in place, ahead of §8's
"start with the minimum" guidance, by the founder's choice. §8 remains the fallback posture:
if any piece proves noisier than useful, it can be pulled back to the simplified default and
re-added on the triggers in the last table.

## Implemented now

| Artifact | Path | Workflow ref |
|---|---|---|
| Fleet shared brain (stack, rules 1–7, frozen-contract pointers, tripwires, tenancy, the 4 review invariants) | `CLAUDE.md` | §2.1, §8 |
| Worktree include list for background sessions | `.worktreeinclude` | §2.2 |
| `/kickoff <workstream>` — worktree + branch + standard plan-mode prompt + `/goal` | `.claude/skills/kickoff/` | §2.3 |
| `/gate-check <wave>` — mechanical checklist → evidence pack (uses `/code-review ultra`) | `.claude/skills/gate-check/` | §2.3, §4 |
| `/adr <title>` — ADR scaffold for post-freeze contract changes | `.claude/skills/adr/` | §2.3 |
| `/new-connector <vendor>` — connector against the frozen `Connector` + fixture harness | `.claude/skills/new-connector/` | §2.3 |
| ADR home + template | `docs/decisions/` | §4.5 |
| Gate evidence-pack home | `docs/gates/` | §4.3 |
| Post-edit typecheck hook (`tsc --noEmit` on the touched package; no-ops pre-W0-B) | `.claude/hooks/post-edit-typecheck.mjs` + `.claude/settings.json` | §2.2 |
| Tripwire-guard hook (blocks rule-7 tech in imports/deps/manifests at write time) | `.claude/hooks/tripwire-guard.mjs` + `.claude/settings.json` | §2.2 |
| `contract-guardian` subagent (read-only frozen-contract-drift reviewer) | `.claude/agents/contract-guardian.md` | §2.4 |
| `adversarial-reviewer` subagent (refute-mode gate reviewer) | `.claude/agents/adversarial-reviewer.md` | §2.4 |
| `/gate-review <wave>` saved workflow (finders → adversarial verify → synthesis) | `.claude/workflows/gate-review.js` | §2.3, §6 |

The **frozen-contracts section of `CLAUDE.md`** is scaffolded (standing rule + artifact list)
but its exact paths are filled in at the **W0-C freeze ceremony** (Workflow §3, W0 step 4) —
that ceremony is project execution, not setup.

Plugins/skills in §2.5 (`feature-dev`, `code-review`, `commit-commands`, `security-review`,
`frontend-design`, `ui-ux-pro-max`, `shadcn`, `verify`, `claude-md-management`,
`marketing-skills`, `deep-research`, `schedule`) are already installed — nothing to author.

## Deferred — needs something that doesn't exist pre-W0, or is genuine execution

| Deferred | Workflow ref | Re-add / do when |
|---|---|---|
| `/fewer-permission-prompts` allowlist (adds to `.claude/settings.json`) | §2.2 | After the first few W0 sessions produce transcripts to mine. |
| CI: typecheck, tests, contract tests, preview deploy (GitHub Actions) | §2.6 | The walking skeleton (W0-B) exists to run against. **This is the only automation §8 keeps** — set it up first thing in W0-B. |
| MCP servers: Neon, Cloudflare (Paddle at W3) | §2.6 | W0-B (Neon/Cloudflare) and W3 (Paddle) — need live credentials; external config. |
| Routines (`/schedule`): approval chasers, PR-triggered review, quarterly re-verify | §2.6, §3, §6 | W0, once external approvals are actually filed (rule 5) — an execution action. |
| Property-based / mutation / adversarial tenancy tests; timed E2E assertion; nightly E2E | §8 | Per the §8 escalation table (first missed bug, billing go-live at W3-M, first real customer org, first regression, E2E breaks twice). |

## Not yet started (project execution — out of scope for setup)
W0-A vendor fact-finding (`docs/connector-facts.md`), W0-B walking skeleton, W0-C schema &
typed contracts + freeze ceremony, and everything in W1–W3. `/kickoff` is ready to start
these when the founder chooses to begin.
