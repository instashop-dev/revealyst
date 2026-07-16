// Desktop-agent Tauri capability + CSP audit (Desktop Agent plan T0.3;
// spec §22.2/§22.3; §29 hard rule: no unrestricted Tauri filesystem or
// shell permissions).
//
// Fails if:
//  1. any capability file under desktop-agent/src-tauri/capabilities/
//     grants a filesystem (`fs:`), shell (`shell:`), or HTTP (`http:`)
//     permission — the frontend must reach everything through narrowly
//     scoped Rust commands, so these permission families are banned
//     outright while no reviewed exception exists;
//  2. any capability grants `remote` origins;
//  3. tauri.conf.json's CSP deviates from the pinned spec §22.3 policy
//     (exact string match — in particular connect-src must stay 'self');
//  4. tauri.conf.json enables `withGlobalTauri` (spec §22.2: no blanket
//     frontend access to the Tauri API surface).
//
// Exact-match based on purpose: loosening any of these is a deliberate,
// reviewed edit to this script in the same PR, never an accident.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const TAURI_DIR = path.join(ROOT, "desktop-agent", "src-tauri");
const CAPABILITIES_DIR = path.join(TAURI_DIR, "capabilities");
const CONF_PATH = path.join(TAURI_DIR, "tauri.conf.json");

// Spec §22.3, verbatim (single line, no trailing semicolon) — must equal
// app.security.csp in tauri.conf.json byte-for-byte.
const PINNED_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'none'";

const BANNED_PERMISSION_PREFIXES = ["fs:", "shell:", "http:"];

const errors = [];

// --- 1+2: capability files ---
let capabilityFiles;
try {
  capabilityFiles = readdirSync(CAPABILITIES_DIR).filter((f) => f.endsWith(".json"));
} catch {
  errors.push(`capabilities directory missing: ${CAPABILITIES_DIR}`);
  capabilityFiles = [];
}
if (capabilityFiles.length === 0 && errors.length === 0) {
  errors.push("no capability files found — the audit would pass vacuously");
}

for (const file of capabilityFiles) {
  const rel = `desktop-agent/src-tauri/capabilities/${file}`;
  const capability = JSON.parse(readFileSync(path.join(CAPABILITIES_DIR, file), "utf8"));
  const permissions = capability.permissions ?? [];
  for (const perm of permissions) {
    // Permissions are either identifier strings or { identifier, ... } objects.
    const identifier = typeof perm === "string" ? perm : perm.identifier;
    if (typeof identifier !== "string") {
      errors.push(`${rel}: unrecognized permission entry ${JSON.stringify(perm)}`);
      continue;
    }
    for (const banned of BANNED_PERMISSION_PREFIXES) {
      if (identifier === banned.slice(0, -1) || identifier.startsWith(banned)) {
        errors.push(`${rel}: banned permission "${identifier}" (spec 22.2 — no ${banned.slice(0, -1)} access from the frontend)`);
      }
    }
  }
  if (capability.remote !== undefined) {
    errors.push(`${rel}: "remote" origins are not allowed in any capability`);
  }
}

// --- 3+4: tauri.conf.json ---
const confRaw = readFileSync(CONF_PATH, "utf8");
const conf = JSON.parse(confRaw);

const csp = conf.app?.security?.csp;
if (csp !== PINNED_CSP) {
  errors.push(
    `desktop-agent/src-tauri/tauri.conf.json: app.security.csp deviates from the pinned spec 22.3 policy.\n  expected: ${PINNED_CSP}\n  actual:   ${csp}`,
  );
}

if (conf.app?.withGlobalTauri === true || /"withGlobalTauri"\s*:\s*true/.test(confRaw)) {
  errors.push("desktop-agent/src-tauri/tauri.conf.json: withGlobalTauri must not be enabled");
}

if (errors.length > 0) {
  console.error("desktop-capability-audit: FAILED\n");
  for (const err of errors) console.error(` - ${err}`);
  process.exit(1);
}

console.log(
  `desktop-capability-audit: ok (${capabilityFiles.length} capability file(s); CSP pinned; withGlobalTauri off)`,
);
