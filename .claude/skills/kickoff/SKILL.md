---
name: kickoff
description: Start a Revealyst workstream session identically every time. Use when the founder types /kickoff <workstream> (e.g. /kickoff W1-D) to create the worktree + branch and compose the standard session-starting prompt in plan mode. Implements "one agent, one workstream" (rule 3).
---

# /kickoff <workstream>

Bootstraps one lettered workstream (e.g. `W1-D`, `W2-J`, `W1-S`) into an isolated,
plan-mode session. The workstream id is passed as the argument.

## Steps

1. **Resolve the workstream.** Read its section from
   [Execution Plan](../../../docs/Revealyst_Execution_Plan.md) and its playbook notes in
   [Claude Code Workflow §3](../../../docs/Revealyst_Claude_Code_Workflow.md). If the id
   is unknown or ambiguous, stop and ask.

2. **Create the worktree + branch** (lowercase id as branch name), unless it already
   exists. W0 workstreams run in the main checkout and get **no** worktree — for a `W0-*`
   id, skip this step and say so.
   ```
   git worktree add ../revealyst-<id> <id>
   ```

3. **Compose the kickoff prompt** and present it, then **enter plan mode** (do not build):
   - The workstream's full section from the execution plan (its deliverables + exit-gate slice).
   - Pointers to the **frozen contracts** and the **fixture directories** it builds against
     (from `CLAUDE.md` → Frozen contracts). Reminder: build against fixtures, **never** read
     another workstream's branch (rule 2).
   - Rules **2, 3, 7** restated, and the four review invariants (`CLAUDE.md` §Review invariants).
   - The wave's exit-gate criteria, phrased as this session's target.

4. **Propose a `/goal`** pinned to this workstream's slice of the exit gate — a *verifiable*
   condition (tests / CI / measured output), not a vibe. Example for W1-D:
   `/goal Anthropic connector lands normalized, attribution-tagged, backfilled metric_records
   from recorded fixtures; backfill wall-time test green; CI green.`

5. **State the inner loop** the session will run:
   plan mode → feature-dev flow → build against fixtures → own tests →
   `/commit-push-pr` → `/code-review` → merge on green CI. Small PRs; a workstream is a chain.

Do **not** start building. Kickoff ends at an approved plan.
