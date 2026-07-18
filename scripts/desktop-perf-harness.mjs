// Desktop-agent performance harness (Desktop Agent plan T7.1; spec section 21).
//
// Prints every spec section 21 budget from the single source of truth
// (desktop-agent/perf-budgets.json) and reports what can be measured now vs
// what still needs a human on real hardware.
//
// What this script measures automatically:
//   - Installed size: the produced installer file sizes (reuses the same logic
//     as the CI gate, scripts/desktop-artifact-size-gate.mjs). Pass a bundle
//     directory to measure it; omit it to just print the budgets + procedures.
//
// What this script does NOT measure (and deliberately does NOT fake): idle
// RAM/CPU, active CPU, startup-to-tray, warm-window open, and idle network can
// only be captured on a real macOS/Windows machine running the built app. For
// each, this prints the documented procedure a human runs on hardware, and the
// result stays "not yet measured on hardware" in
// docs/desktop-agent-release-evidence.md until someone captures it.
//
// Usage: node scripts/desktop-perf-harness.mjs [bundleDir]
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { measureInstallers } from "./desktop-artifact-size-gate.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUDGETS_PATH = path.join(ROOT, "desktop-agent", "perf-budgets.json");
const MB = 1024 * 1024;

// Scripted on-hardware procedures. These are instructions for a human, NOT
// measurements — the harness prints them so the procedure lives next to the
// budgets and can't drift from the doc.
const PROCEDURES = {
  idleMemory:
    "Launch the agent, leave it idle (no window, no sync) for 10 minutes, then read the tray process resident memory: macOS Activity Monitor (Real Memory) or `ps -o rss= -p <pid>`; Windows Task Manager (Memory) or `Get-Process Revealyst | Select WorkingSet64`.",
  idleCpu:
    "With the agent idle, sample CPU every few seconds for 10 minutes and average it: macOS `top -pid <pid>` or Instruments; Windows `Get-Counter '\\Process(Revealyst)\\% Processor Time'` in a loop, divided by core count.",
  activeCpu:
    "Trigger a sync, then sample CPU every few seconds for 1 minute and average it, using the same tools as idle CPU.",
  startupToTray:
    "Cold-start the app (quit first, or fresh boot) and time from launch to the tray icon responding to a click. Repeat 5 times and take the median.",
  warmWindowOpen:
    "With the agent already resident, open the status window, close it, then time a second open until the window is painted. Repeat 5 times and take the median.",
  idleNetwork:
    "Leave the agent idle for 24 hours with update checks disabled (or subtract measured update traffic), and read total bytes sent+received for the process: macOS `nettop -p <pid>` or Little Snitch; Windows Resource Monitor per-process network, or a per-process counter.",
};

function loadBudgets() {
  return JSON.parse(readFileSync(BUDGETS_PATH, "utf8"));
}

function main() {
  const bundleDir = process.argv[2];
  const { budgets } = loadBudgets();

  console.log("Desktop-agent performance harness — spec section 21 budgets\n");
  console.log("Source of truth: desktop-agent/perf-budgets.json\n");

  // Measured now: installer sizes (if a bundle dir was given).
  let installers = [];
  if (bundleDir) {
    installers = measureInstallers(bundleDir);
  }

  for (const [key, b] of Object.entries(budgets)) {
    console.log(`${b.label}`);
    console.log(`  budget:     under ${b.budget} ${b.unit}`);
    if (b.measuredBy === "ci-artifact-size") {
      console.log(`  measured:   automatically, on every desktop PR (artifact-size gate)`);
      if (bundleDir && installers.length > 0) {
        for (const m of installers) {
          console.log(
            `    - ${path.basename(m.file)}: ${(m.bytes / MB).toFixed(1)} ${b.unit}`,
          );
        }
      } else if (bundleDir) {
        console.log(`    - no installer files found under ${bundleDir}`);
      } else {
        console.log(`    (pass a bundle directory to measure installer sizes locally)`);
      }
    } else {
      console.log(`  measured:   NOT YET on hardware — needs a human to run the procedure`);
      console.log(`  procedure:  ${PROCEDURES[key] ?? "(see docs/desktop-agent-release-evidence.md)"}`);
    }
    console.log("");
  }

  console.log(
    "Record captured on-hardware values in docs/desktop-agent-release-evidence.md.\n" +
      "Do not invent runtime numbers — an unmeasured row stays 'not yet measured'.",
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
