# Desktop Agent — release evidence

Honest record of the spec section 21 performance targets: where the budgets
live, what the CI gate enforces automatically, and what still needs a human to
measure on real hardware. Written for Desktop Agent plan M7 / T7.1.

**Rule for this doc:** an unmeasured row stays "not yet measured on hardware".
We never invent runtime numbers (CLAUDE.md invariant b / the W3-N written-claim
rule). When someone captures a value on hardware, they fill in the row and note
the machine and date.

## Where the budgets live

All seven spec section 21 numbers live in ONE file:
[`desktop-agent/perf-budgets.json`](../desktop-agent/perf-budgets.json).

The CI gate, the harness script, and this doc all read that file, so the numbers
cannot drift apart. Change a budget there (in a reviewed change) and every reader
updates together.

## What the CI gate enforces (automatic, every desktop PR)

`.github/workflows/desktop-ci.yml` → the `build` matrix builds unsigned Tauri
installers on macOS and Windows. A step then runs
[`scripts/desktop-artifact-size-gate.mjs`](../scripts/desktop-artifact-size-gate.mjs),
which measures each produced installer (`.dmg` on macOS, `.msi` and `.exe` on
Windows) against the **Installed size** budget (40 MB) and fails the job if any
installer is over budget, naming the file, its size, and the budget.

This is the only spec section 21 target a CI runner can measure
deterministically. The gate runs on both release operating systems, so it covers
both shipped architectures' installers.

**Honest limit of the gate.** Installers are compressed, so this is a
conservative (lower-bound) check on installed size:

- An installer **over** 40 MB proves the unpacked installed app is also over
  budget — a true failure the gate catches.
- An installer **under** 40 MB is necessary but not sufficient: the unpacked app
  could still be larger. Final installed-size confirmation is the on-hardware
  step below (unpack the app / read the installed footprint).

## Results table

Fill measured values in as they are captured. `measuredBy` matches
`perf-budgets.json`.

| Metric | Budget | How measured | Status |
|--------|--------|--------------|--------|
| Installed size (per arch) | under 40 MB | CI artifact-size gate (installer file size) | Enforced in CI on every desktop PR. Actual installer sizes appear in that job's log. Unpacked installed footprint: not yet measured on hardware. |
| Idle memory | under 80 MB | on-hardware | Not yet measured on hardware. |
| Idle CPU (10 min avg) | under 0.5% | on-hardware | Not yet measured on hardware. |
| Active CPU (1 min avg) | under 3% | on-hardware | Not yet measured on hardware. |
| Startup to tray ready | under 3 s | on-hardware | Not yet measured on hardware. |
| Warm status-window open | under 500 ms | on-hardware | Not yet measured on hardware. |
| Idle network use | under 1 MB/day | on-hardware | Not yet measured on hardware. |

## On-hardware procedure (the six runtime rows)

These cannot run in CI — they need the built app running on real macOS and
Windows machines. Run
[`scripts/desktop-perf-harness.mjs`](../scripts/desktop-perf-harness.mjs) to
print the budgets and the exact procedure for each metric, then capture values
by hand and record them above with the machine and date.

Summary of each procedure (the harness prints the full version):

- **Idle memory** — idle 10 minutes, read the tray process resident memory
  (macOS Activity Monitor / `ps -o rss=`; Windows Task Manager / `WorkingSet64`).
- **Idle CPU** — sample CPU over a 10-minute idle window and average it.
- **Active CPU** — sample CPU over a 1-minute window during a sync and average it.
- **Startup to tray** — cold-start and time launch → tray responds; median of 5.
- **Warm window open** — with the app resident, time a second window open until
  painted; median of 5.
- **Idle network** — idle 24 hours with updates excluded, read total bytes
  sent+received for the process.

## Running the harness locally

```
# Print all budgets + on-hardware procedures (no build needed):
node scripts/desktop-perf-harness.mjs

# Also measure local installer sizes after a `tauri build`:
node scripts/desktop-perf-harness.mjs desktop-agent/src-tauri/target/release/bundle

# Run just the CI gate against a bundle directory:
node scripts/desktop-artifact-size-gate.mjs desktop-agent/src-tauri/target/release/bundle
```

## Completion (T7.1)

- Budgets captured in one source of truth: **done**.
- Artifact-size gate wired into desktop CI: **done** (this PR).
- Harness + documented on-hardware procedure: **done**.
- Six runtime rows measured on hardware: **pending** (M7, on real machines);
  any miss is fixed or founder-accepted in `docs/product-signoffs.md`.
