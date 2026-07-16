# Revealyst Desktop Agent

A Tauri 2 background tray utility (macOS 13+ / Windows 10 22H2+). Wave M0
scaffold: a single placeholder window and single-instance enforcement — **no
data collection, no pairing, no tray yet** (D-DA-1 gated; see
`docs/Revealyst_Desktop_Agent_Execution_Plan.md`).

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
