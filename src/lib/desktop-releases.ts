// Desktop-agent update releases + the staged-rollout cohort gate (Desktop
// Agent plan T6.1, spec §18). The backend half of the signed Tauri updater:
// `GET /api/desktop/updates/[platform]/[arch]/[channel]/[version]` selects the
// applicable release for a caller and returns the Tauri dynamic-update manifest
// (or "no update"). The agent verifies the DOWNLOADED ARTIFACT's signature
// against its baked-in updater public key (spec §29 signed-updates law) — this
// endpoint is a pure directory of published releases and carries no secret.
//
// # Why a config const, not a table
//
// Releases are published by the protected release pipeline (T6.2), not by an
// admin UI. There is nothing per-org and nothing user-writable here, so a
// database table would be dead weight (plan T6.1: "prefer no table"). The
// registry below IS the fleet's published-release list; the pipeline appends a
// record when it signs+publishes a release, and HALT = set that record's
// `rolloutPct` to 0 (or drop it) and redeploy (see the halt note at the foot).
//
// It is EMPTY at launch — honestly, no signed desktop release exists yet
// (T6.2 produces the first, `desktop-v0.1.0-internal`). An empty registry
// serves "no update" to every caller, which is the correct pre-release state:
// we never serve a fabricated or unsigned release. The selection + cohort logic
// is fully exercised by tests that construct their own release records.
//
// # The staged-rollout cohort gate (spec §18.4)
//
// Deterministic cohorts: `internal 100% → beta 100% → stable 5% → 25% → 50% →
// 100%`. A caller is in a release's cohort when a STABLE hash of
// `installationId + releaseId` mod 100 is below the release's rollout
// percentage. The hash is `hash32` (FNV-1a) from `./experiments.ts` — the SAME
// deterministic-bucketing discipline the recommendation holdout uses, never a
// per-request RNG — so the same (installation, release) always lands in the
// same bucket and the agent can reproduce the decision offline (its Rust mirror
// in `desktop-agent/src-tauri/src/update.rs` reimplements the identical FNV-1a).

import type { DesktopUpdateChannel } from "./desktop-config";
import { hash32 } from "./experiments";

export type { DesktopUpdateChannel } from "./desktop-config";

/** The three update channels (spec §18.2). Re-exported as a runtime array so
 * the route can validate the `[channel]` path segment. */
export const DESKTOP_UPDATE_CHANNELS: readonly DesktopUpdateChannel[] = [
  "internal",
  "beta",
  "stable",
];

/** A per-target download + signature. `signature` is the Tauri updater
 * (minisign) signature of the artifact at `url`, NOT a signature of this
 * manifest — the agent verifies the downloaded artifact against its baked-in
 * updater public key. */
export type DesktopReleaseTarget = {
  /** HTTPS URL of the signed update artifact for this target. */
  url: string;
  /** Base64 Tauri-updater (minisign) signature of the artifact. */
  signature: string;
};

/**
 * Tauri's per-target key: `<platform>-<arch>` where platform is the Tauri
 * `{{target}}` (`windows` | `darwin` | `linux`) and arch is `{{arch}}`
 * (`x86_64` | `aarch64` | ...). Matches the `[platform]/[arch]` route segments.
 */
export type DesktopTargetKey = string;

/** A published, signed desktop release. */
export type DesktopRelease = {
  /** Stable release id — the cohort hash's second input, so it MUST be unique
   * and immutable per release (e.g. `desktop-v0.2.0-stable`). Changing it
   * reshuffles every cohort, so never reuse or mutate one. */
  id: string;
  /** Which channel this release is published to. */
  channel: DesktopUpdateChannel;
  /** SemVer `MAJOR.MINOR.PATCH` of the release. */
  version: string;
  /** Plain-English release notes (shown by the updater). */
  notes: string;
  /** ISO-8601 UTC publish timestamp. */
  pubDate: string;
  /** Staged-rollout percentage in [0, 100]. 0 = halted (served to nobody);
   * 100 = everyone. Between = the deterministic cohort gate applies. */
  rolloutPct: number;
  /** True ONLY for security/privacy/protocol-critical releases (spec §18.3):
   * the agent then enters `update_required` and blocks sync until updated.
   * Today this block is driven SOLELY by this `mandatory` flag on the manifest
   * served by the unauthenticated updates endpoint — the agent reads it and
   * gates collection (`update.rs` → `CollectionControl`). A parallel,
   * signature-backed enforcement path exists in
   * `desktop-agent/src-tauri/src/config.rs` (a signed config's
   * `minimumAgentVersion` resolves to `UpdateRequired`), but that resolution is
   * NOT yet wired into the collection gate — wiring it in as defense-in-depth
   * (so a signed config can also enforce/clear the block, not just the unsigned
   * manifest) is a documented follow-up. Until then, a sustained transport MITM
   * could hold a client in `update_required` (a sync stall, never code
   * execution — the artifact will not install without a valid baked-pubkey
   * signature). */
  mandatory: boolean;
  /** Per-target artifact + signature. A caller whose target is absent is not
   * offered this release. */
  targets: Record<DesktopTargetKey, DesktopReleaseTarget>;
};

/**
 * The published-release registry. EMPTY at launch (no signed release exists
 * yet — T6.2 publishes the first). The release pipeline appends a record here
 * when it signs+publishes; halt = set `rolloutPct: 0` (or remove the record)
 * and redeploy.
 */
export const DESKTOP_RELEASES: readonly DesktopRelease[] = [];

/** Human labels for the known desktop download targets (spec §3.3). */
const DOWNLOAD_TARGET_LABELS: Record<string, string> = {
  "darwin-aarch64": "macOS (Apple Silicon)",
  "darwin-x86_64": "macOS (Intel)",
  "windows-x86_64": "Windows",
};

/** One user-facing installer download. */
export type DesktopDownload = { key: string; label: string; url: string };

/** The latest generally-available stable release's downloads, or null. */
export type DesktopDownloadSet = {
  version: string;
  pubDate: string;
  downloads: DesktopDownload[];
};

/**
 * The download list for the public /download page: the newest generally-
 * available STABLE release's signed per-target artifacts (halted releases —
 * `rolloutPct: 0` — are excluded). Returns `null` until the first signed stable
 * release is published (T6.2 / gated on D-DA-7) so the page renders an honest
 * "coming soon" state instead of a dead link. Derived from `DESKTOP_RELEASES`,
 * so the page can never advertise a download that does not exist (invariant b).
 * `releases` is injectable for tests.
 */
export function latestStableDownloads(
  releases: readonly DesktopRelease[] = DESKTOP_RELEASES,
): DesktopDownloadSet | null {
  const latest = releases
    .filter((r) => r.channel === "stable" && r.rolloutPct > 0)
    .sort((a, b) => compareVersions(b.version, a.version))[0];
  if (!latest) return null;
  const downloads = Object.entries(latest.targets)
    .map(([key, target]) => ({
      key,
      label: DOWNLOAD_TARGET_LABELS[key] ?? key,
      url: target.url,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
  if (downloads.length === 0) return null;
  return { version: latest.version, pubDate: latest.pubDate, downloads };
}

/** The Tauri dynamic-update manifest shape (spec §18.1). The agent's updater
 * consumes exactly this on a 200; a 204 means "no update". */
export type TauriUpdateManifest = {
  version: string;
  notes: string;
  pub_date: string;
  url: string;
  signature: string;
  /** Extra field the agent reads to decide `update_required` (Tauri ignores
   * unknown manifest fields). Present so a mandatory release can block sync. */
  mandatory: boolean;
};

/** Parse a strict `MAJOR.MINOR.PATCH` triple; `null` on anything else. */
function parseSemver(v: string): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** Returns a positive number when `a > b`, negative when `a < b`, 0 when equal.
 * An unparseable version sorts as the smallest (never "newer"), so a malformed
 * record can never be offered as an upgrade. */
export function compareVersions(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa && !pb) return 0;
  if (!pa) return -1;
  if (!pb) return 1;
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

/**
 * The deterministic cohort bucket [0, 99] for a caller against a release —
 * `hash32(installationId + ":" + releaseId) % 100`. Reuses the FNV-1a
 * `hash32` from `experiments.ts` (the same bucketing discipline, never an
 * RNG); the Rust agent mirrors this exact hash so both sides agree offline.
 */
export function updateCohort(installationId: string, releaseId: string): number {
  return hash32(`${installationId}:${releaseId}`) % 100;
}

/**
 * Whether a caller is inside a release's staged rollout.
 *   - `rolloutPct <= 0`  → nobody (halted).
 *   - `rolloutPct >= 100` → everybody (installationId irrelevant).
 *   - otherwise → the deterministic cohort must be below the percentage. A
 *     missing installationId cannot be placed in a partial cohort, so it is
 *     treated as OUTSIDE — a partial rollout never leaks to unidentified
 *     callers (fail-closed).
 */
export function isInRollout(
  installationId: string | null,
  releaseId: string,
  rolloutPct: number,
): boolean {
  if (rolloutPct <= 0) return false;
  if (rolloutPct >= 100) return true;
  if (!installationId) return false;
  return updateCohort(installationId, releaseId) < rolloutPct;
}

/** The inputs a manifest request resolves against. */
export type SelectUpdateInput = {
  channel: DesktopUpdateChannel;
  platform: string;
  arch: string;
  currentVersion: string;
  installationId: string | null;
  /** Injectable for tests; defaults to the live registry at the call site. */
  releases: readonly DesktopRelease[];
};

/**
 * Select the update manifest to serve, or `null` for "no update". Pure — no
 * clock, no I/O. A release qualifies when it is on the requested channel, has
 * an artifact for the caller's `<platform>-<arch>` target, is strictly newer
 * than the caller's current version, AND the caller is inside its staged
 * rollout. When several qualify, the highest version wins (deterministic tie:
 * the later-listed record).
 */
export function selectUpdate(
  input: SelectUpdateInput,
): TauriUpdateManifest | null {
  const targetKey = `${input.platform}-${input.arch}`;
  let best: { release: DesktopRelease; target: DesktopReleaseTarget } | null =
    null;

  for (const release of input.releases) {
    if (release.channel !== input.channel) continue;
    const target = release.targets[targetKey];
    if (!target) continue;
    if (compareVersions(release.version, input.currentVersion) <= 0) continue;
    if (!isInRollout(input.installationId, release.id, release.rolloutPct)) {
      continue;
    }
    if (
      !best ||
      compareVersions(release.version, best.release.version) >= 0
    ) {
      best = { release, target };
    }
  }

  if (!best) return null;
  return {
    version: best.release.version,
    notes: best.release.notes,
    pub_date: best.release.pubDate,
    url: best.target.url,
    signature: best.target.signature,
    mandatory: best.release.mandatory,
  };
}

// ---------------------------------------------------------------------------
// Halt procedure (spec §18.4 "staged rollout can be halted")
// ---------------------------------------------------------------------------
//
// To halt a release that is rolling out badly, do EITHER:
//   1. Set its `rolloutPct` to 0 in `DESKTOP_RELEASES` and deploy — the cohort
//      gate then serves "no update" (204) to every caller, including agents
//      that have not yet updated. Existing installs are unaffected (an update
//      already installed does not roll back), but no NEW agent picks it up.
//   2. Remove the record entirely and deploy — identical effect; use when the
//      release should never be offered again.
// Because the registry is code, a halt is a one-line change + a deploy of the
// web Worker (no desktop release needed) — the fastest lever available.
