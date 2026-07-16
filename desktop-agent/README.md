# Revealyst Desktop Agent

A Tauri 2 background tray utility (macOS 13+ / Windows 10 22H2+). Wave M1
app foundation: tray lifecycle (spec §19.1 menu from a pure `menu_model`),
window shells (onboarding/status/privacy/about), the spec §20 agent state
machine (`state.rs` + TS mirror `src/lib/state.ts`), structured JSON logging
with a `Redact<T>` newtype and 7-day rotation, single-instance enforcement,
and an opt-in start-at-login toggle — **no data collection, no pairing, no
network calls** (D-DA-1 gated; see
`docs/Revealyst_Desktop_Agent_Execution_Plan.md`). The only outbound action
is opening the Revealyst website in the default browser from the tray,
validated against the two Revealyst origins in `src-tauri/src/lifecycle.rs`.

Window behavior: closing the window hides it (the app keeps running in the
tray; Quit lives in the tray menu). On startup the window is shown only on
the first run (a `first-run-complete` marker in the app data dir) or when
`--show` is passed; otherwise the app starts hidden in the tray. A second
launch shows + focuses the existing instance.

This tree has its **own toolchain**. The repo-root web toolchain excludes it:
root `tsconfig.json` excludes `desktop-agent`, root Vitest include-globs never
match it, and `check-org-scope` only scans `src/**`. Nothing here may import
from the web app's `src/` (shared contracts cross via generated JSON artifacts
checked in under `src-tauri/generated/`, starting in M3).

## Prerequisites (Windows dev machine)

- Node.js 20+ (repo standard is fine)
- Rust stable, `stable-msvc` toolchain (`rustup default stable-msvc`)
- Visual Studio Build Tools with the "Desktop development with C++" workload
- WebView2 Runtime (preinstalled on Windows 11 / recent Windows 10)

macOS additionally needs Xcode Command Line Tools.

## Dev loop

```sh
cd desktop-agent
npm install
npm run tauri dev     # builds the Rust crate + serves the Vite frontend
```

Frontend-only checks (no Rust toolchain needed):

```sh
npm run typecheck     # tsc --noEmit against desktop-agent/tsconfig.json
npm test              # vitest run (jsdom), src/**/*.test.{ts,tsx}
```

Rust checks (need cargo; CI runs these on every PR touching this tree):

```sh
cd src-tauri
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
```

Note: `cargo test`/`clippy` compile `tauri::generate_context!`, which embeds
`../dist` — run `npm run build` first so the frontend bundle exists.

Production build (unsigned):

```sh
npm run tauri build
```

## Allowlist bridge (T3.1)

`src-tauri/generated/allowlist.json` is a **generated, checked-in** projection
of `src/lib/agent-collection-schema.ts` (the repo's single source of truth for
"what leaves the device" — plan law 3). The Rust crate embeds it at compile
time (`src-tauri/src/allowlist.rs` via `include_str!`) and all Rust
collection code must reference fields through that module (`is_allowed` /
`project`, which drops every non-allowlisted key — allowlist, never
blocklist).

Never edit the JSON by hand. After any change to the TS schema, regenerate
from the **repo root**:

```sh
npm run generate:desktop-allowlist
```

CI fails on drift: `tests/desktop-allowlist-drift.test.ts` (root Vitest
suite) re-renders the projection from the TS schema and compares it
byte-for-byte to the checked-in file, so a schema edit without regeneration —
or a hand-edit to the JSON — cannot merge. The artifact is pinned to LF via
`.gitattributes` so `core.autocrlf` checkouts don't break the byte
comparison.

## CI

`.github/workflows/desktop-ci.yml` runs on PRs touching `desktop-agent/**`:
Rust fmt/clippy/test + `cargo audit`, frontend typecheck + tests, unsigned
matrix builds (macOS + Windows), and a Tauri capability/CSP audit
(`scripts/desktop-capability-audit.mjs`). PR workflows never see signing
secrets (spec §25.2); signing lands in M6 behind the protected
`desktop-release` GitHub Environment.

## Known scaffold placeholders (T6 follow-ups)

- **Icons** (`src-tauri/icons/`) are generated solid-color placeholders
  (PNG/ICO/ICNS, structurally valid). Replace with real brand icons via
  `npx tauri icon` before any release.
- **`src-tauri/Cargo.lock` is committed** — builds and `cargo audit` run
  against a pinned dependency resolution. Update it deliberately with
  `cargo update` (its diff is reviewed like any other).
