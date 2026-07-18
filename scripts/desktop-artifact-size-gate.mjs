// Desktop-agent artifact-size gate (Desktop Agent plan T7.1; spec section 21).
//
// After the Tauri bundler produces the unsigned installers on each build
// runner, this checks every installer file against the "Installed size" budget
// in desktop-agent/perf-budgets.json (the single source of truth). If any
// installer is over budget the gate FAILS with a plain-English message naming
// the file, its size, and the budget.
//
// This is the ONE spec section 21 target that a CI runner can measure
// deterministically. The runtime targets (idle RAM/CPU, startup time, warm
// window, idle network) can only be captured on real hardware — see
// scripts/desktop-perf-harness.mjs and docs/desktop-agent-release-evidence.md.
// This script does NOT fake those; it only measures installer file sizes.
//
// Honesty note: installers are compressed, so an installer OVER 40 MB proves
// the unpacked installed app is also over budget (a true failure), while an
// installer UNDER 40 MB is a necessary-but-not-sufficient signal. The gate is
// therefore a conservative lower-bound check; final installed-size confirmation
// is the on-hardware step in the evidence doc.
//
// Usage: node scripts/desktop-artifact-size-gate.mjs [bundleDir]
//   bundleDir defaults to the desktop-ci.yml build output:
//   desktop-agent/src-tauri/target/release/bundle
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUDGETS_PATH = path.join(ROOT, "desktop-agent", "perf-budgets.json");

// Installer artifacts we size-gate. Deliberately NOT the Tauri updater bundles
// (.app.tar.gz / .nsis.zip / .msi.zip) — those are update payloads, not the
// thing a user installs.
const INSTALLER_EXTENSIONS = [".dmg", ".msi", ".exe"];

const MB = 1024 * 1024;

export function loadInstalledSizeBudget() {
  const budgets = JSON.parse(readFileSync(BUDGETS_PATH, "utf8"));
  const entry = budgets.budgets?.installedSize;
  if (!entry || typeof entry.budget !== "number" || entry.unit !== "MB") {
    throw new Error(
      `perf-budgets.json: budgets.installedSize is missing or not in MB — cannot run the size gate`,
    );
  }
  return entry;
}

// Recursively collect installer files under dir. Returns [] if dir is missing
// (the caller decides whether an empty result is an error).
export function findInstallers(dir) {
  const found = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...findInstallers(full));
    } else if (
      entry.isFile() &&
      INSTALLER_EXTENSIONS.includes(path.extname(entry.name).toLowerCase())
    ) {
      found.push(full);
    }
  }
  return found;
}

export function measureInstallers(bundleDir) {
  return findInstallers(bundleDir).map((file) => ({
    file,
    bytes: statSync(file).size,
  }));
}

function mb(bytes) {
  return bytes / MB;
}

// Run the gate. Returns { ok, over, measured, budget }. Never throws on
// over-budget — the CLI wrapper below decides the exit code.
export function runGate(bundleDir) {
  const budget = loadInstalledSizeBudget();
  const measured = measureInstallers(bundleDir);
  const over = measured.filter((m) => mb(m.bytes) > budget.budget);
  return { ok: over.length === 0, over, measured, budget };
}

function main() {
  const bundleDir =
    process.argv[2] ||
    path.join(ROOT, "desktop-agent", "src-tauri", "target", "release", "bundle");

  const { ok, over, measured, budget } = runGate(bundleDir);

  console.log(`Artifact-size gate — budget: ${budget.budget} ${budget.unit} per installer`);
  console.log(`Scanning: ${bundleDir}`);

  if (measured.length === 0) {
    console.error(
      `\nFAILED: no installer files (.dmg / .msi / .exe) found under the bundle directory.\n` +
        `The Tauri build step must run before this gate. If the build produced bundles\n` +
        `in a different directory, pass it as the first argument.`,
    );
    process.exit(1);
  }

  for (const m of measured) {
    const size = mb(m.bytes).toFixed(1);
    const flag = mb(m.bytes) > budget.budget ? "OVER BUDGET" : "ok";
    console.log(` - ${path.basename(m.file)}: ${size} ${budget.unit} (${flag})`);
  }

  if (!ok) {
    console.error(`\nFAILED: ${over.length} installer(s) exceed the ${budget.budget} ${budget.unit} budget:`);
    for (const m of over) {
      console.error(
        ` - ${path.basename(m.file)} is ${mb(m.bytes).toFixed(1)} ${budget.unit}, ` +
          `over the ${budget.budget} ${budget.unit} budget`,
      );
    }
    console.error(
      `\nEither shrink the bundle (trim dependencies/assets) or, if the increase is\n` +
        `justified, raise the budget in desktop-agent/perf-budgets.json in a reviewed change.`,
    );
    process.exit(1);
  }

  console.log(`\nPASSED: all ${measured.length} installer(s) are within the ${budget.budget} ${budget.unit} budget.`);
}

// Run only when invoked directly, so the harness can import the helpers above.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
