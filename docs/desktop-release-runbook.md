# Desktop Agent — release runbook

How to cut, sign, publish, promote, and halt a Revealyst Desktop Agent release.
The pipeline is [`.github/workflows/release-desktop.yml`](../.github/workflows/release-desktop.yml)
(Desktop Agent plan T6.2; spec §25.2). This doc is the operator's companion.

> **Status:** the pipeline is authored complete, but a **real signed release is
> gated on D-DA-7** — the Apple Developer ID cert, Windows EV cert, the
> `desktop-release` GitHub Environment, and the Tauri updater keypair do not
> exist yet (see [`approvals.md`](approvals.md) T0.4 rows, founder action). Until
> they land, only the **unsigned dry run** works. Nothing in this repo contains a
> signing secret (spec §29).

## Signing-secret safety (spec §25.2 / §29)

Enforced structurally, not by convention:

1. `release-desktop.yml` has **no `pull_request` trigger** — it runs only on a
   `desktop-v*` tag push or a manual `workflow_dispatch`. A PR can never start it.
2. Every job that references a signing secret (`sign`, `verify`, `publish`,
   `promote`) declares `environment: desktop-release`. GitHub injects Environment
   secrets **only** into jobs that name that environment, and the environment
   carries a **required-reviewer** rule. The `test` and `build` jobs name no
   environment and reference no secret, so the unsigned path proves the whole
   wiring with zero secret access.
3. If a `sign` run starts without the secrets configured, the first step
   (`Require signing secrets`) fails loudly pointing here — it never silently
   ships an unsigned build as if it were signed.

## One-time founder setup (unblocks D-DA-7)

1. **Apple:** enroll in the Apple Developer Program; create a **Developer ID
   Application** cert; export it as a base64 `.p12`. Create an app-specific
   password for notarization.
2. **Windows:** buy an **EV** code-signing cert (avoids SmartScreen reputation
   lag); export base64 + password.
3. **Tauri updater keypair:** `npm run tauri signer generate` (offline). Put the
   **public** key in `desktop-agent/src-tauri/tauri.conf.json`
   `plugins.updater.pubkey` (replacing the placeholder — this is the key T6.1's
   endpoint's manifests are verified against). Keep the **private** key + its
   password out of the repo.
4. **GitHub Environment `desktop-release`** (repo → Settings → Environments):
   add a **required reviewer**, then add secrets:
   `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`,
   `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`, `WINDOWS_CERT_BASE64`,
   `WINDOWS_CERT_PASSWORD`, `TAURI_SIGNING_PRIVATE_KEY`,
   `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.

## Cutting a release

- **Unsigned internal test build (works today):** Actions → *Release Desktop* →
  *Run workflow* → `dry_run: true`. Runs test → build → checksums, then the
  `publish-unsigned` job (NO protected environment — it references no signing
  secret, only `github.token`, so §25.2 secret-safety is preserved) publishes a
  clearly-marked **UNSIGNED prerelease** to the FIXED, clobbered tag
  **`desktop-internal-latest`**, so the internal test build always has one
  stable Release URL. That URL is surfaced ONLY on the signed-in
  Settings → Devices page (`INTERNAL_TEST_BUILD_URL`), clearly labeled unsigned;
  the public `/download` page stays "coming soon". These artifacts are unsigned
  (Gatekeeper / SmartScreen will warn) — for internal testing only, do not
  distribute publicly.
- **Real signed release (after D-DA-7):** the `publish-signed` job
  (`environment: desktop-release`, required-reviewer + signing secrets) runs on a
  `desktop-v*` tag push or a non-dry-run dispatch — see below.
- **Real signed release (after D-DA-7):** bump `desktop-agent/package.json` +
  `src-tauri/{Cargo.toml,tauri.conf.json}` versions; tag `git tag desktop-v0.1.0
  && git push --tags`. The tag runs test → build → **sign+notarize** (protected)
  → verify → checksums+manifest → publish to the `internal` channel.

## Channels & staged rollout

Channels: `internal` → `beta` → `stable`. Promote with a `workflow_dispatch`
naming `channel: beta` (or `stable`); the `promote` job republishes that
channel's manifest against the already-signed release.

**The rollout percentage is data-side, not in CI** — set it in the release
record consumed by T6.1's endpoint (`src/lib/desktop-releases.ts` `rolloutPct`;
internal 100 → beta 100 → stable 5 → 25 → 50 → 100). The cohort is a
deterministic `hash32(installationId + releaseId) % 100` (reuses
`src/lib/experiments.ts`), so a given install's eligibility is stable across
checks and monotonic as the percentage climbs.

## Halting a release

Set the release's `rolloutPct: 0` in `src/lib/desktop-releases.ts` (or remove
the record) and deploy the Worker. The T6.1 endpoint then serves `204 No
Content` to every cohort — no desktop rebuild or re-release required. A
mandatory release additionally blocks sync on unsafe versions via the agent's
`update_required` state until the client updates.

## Update manifest shape (T6.1 contract)

`scripts/desktop-updater-manifest.mjs` emits `<channel>.json`, the Tauri v2
updater shape T6.1's `/api/desktop/updates/...` endpoint serves unchanged:

```json
{
  "version": "0.1.0",
  "notes": "...",
  "pub_date": "2026-07-17T00:00:00Z",
  "platforms": {
    "darwin-aarch64": { "signature": "<base64 .sig>", "url": "https://…/Revealyst_aarch64.app.tar.gz" },
    "darwin-x86_64":  { "signature": "…", "url": "…" },
    "windows-x86_64": { "signature": "…", "url": "…/Revealyst_x64-setup.nsis.zip" }
  }
}
```

On the unsigned dry-run path the `.sig` files are absent, so signatures are
empty and the manifest is marked `unsigned: true` — a real `tauri-plugin-updater`
rejects a manifest whose signature does not verify, so a dry-run manifest can
never install.

## Key rotation

- **Updater key:** generate a new keypair; bake the new **public** key in
  `tauri.conf.json` and ship it in a normal release **before** signing releases
  with the new private key (clients must have the new pubkey to verify). Keep the
  old key valid for one release cycle. Versioned like the config-signing KEK
  pattern but a distinct key.
- **Certs:** replace the Environment secrets; no code change (the workflow reads
  them by name).
