---
name: gate-check
description: Run a wave's exit-gate checklist mechanically and emit the evidence pack the founder judges. Use when the founder types /gate-check <wave> (e.g. /gate-check W1). Implements evidence-based human gates (rule 4). The founder reads one file and never diffs.
---

# /gate-check <wave>

Executes the wave's exit-gate checklist and writes `docs/gates/W<N>-evidence.md` — the
single markdown pack the founder judges. The wave id (e.g. `W1`) is the argument.

## Steps

1. **Load the wave's exit gate** from the [Execution Plan](../../../docs/Revealyst_Execution_Plan.md)
   and the playbook in [Workflow §3](../../../docs/Revealyst_Claude_Code_Workflow.md). Each gate
   item becomes a checklist row with pass/fail + evidence.

2. **Run the checks mechanically** and capture raw output — do not summarize away numbers:
   - Typecheck, unit tests, the **contract-test suite** (W1-S), and the happy-path E2E.
   - The **tenant-isolation test** (proof a cross-org read fails) — mandatory every gate.
   - The **golden dogfooding test** (recorded real payloads → known-true numbers).
   - Wave-specific measured evidence, e.g. **W2**: the instrumented signup → score timing
     (a measured number, not an assertion — see §8; the <10-min claim is a gate item).
   - Dashboards rendered against known-truth dogfooding data — screenshots via
     `verify` / Codex Preview.

3. **Adversarial pre-review** (rule 4) — on the wave's integrated branch, run all three,
   by agents that did not write the code:
   - **`/code-review ultra`** — multi-agent cloud review of the branch.
   - **`/gate-review W<N>`** — the saved workflow: parallel finders across risk dimensions,
     each finding adversarially refuted, survivors synthesized into an evidence section.
   - The **`contract-guardian`** and **`adversarial-reviewer`** subagents for any PR chain
     still open at the gate.
   Record surviving findings with a disposition each (findings, not raw diffs).

4. **Write `docs/gates/W<N>-evidence.md`**: the checklist table, test/E2E output, the
   isolation proof, the dogfooding comparison, screenshots, instrumented timings, and the
   adversarial findings with dispositions. Findings, not raw diffs.

5. **Hand off.** The founder answers rule 4's questions — "do these numbers match reality?
   would I trust this score?" — in hours, not weeks.
   - **Pass** → tag the wave, `/clean_gone` merged worktree branches, `/kickoff` the next wave.
   - **Fail** → each finding becomes a PR chain in the responsible worktree, that session
     pinned with `/goal all W<N> gate findings dispositioned and CI green`; re-run `/gate-check`.
