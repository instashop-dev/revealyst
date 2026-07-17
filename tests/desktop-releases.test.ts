import { describe, expect, it, vi } from "vitest";
import {
  compareVersions,
  DESKTOP_RELEASES,
  isInRollout,
  latestStableDownloads,
  selectUpdate,
  updateCohort,
  type DesktopRelease,
  type TauriUpdateManifest,
} from "../src/lib/desktop-releases";

// Desktop Agent T6.1 (spec §18): the update manifest lib — cohort determinism,
// staged rollout, channel routing, version selection, and the mandatory flag.
// The live DESKTOP_RELEASES registry is empty (no signed release exists yet),
// so these build their own release records.

function target(url = "https://cdn.revealyst.com/a.zip", signature = "sig") {
  return { url, signature };
}

function release(over: Partial<DesktopRelease> = {}): DesktopRelease {
  return {
    id: "desktop-v0.2.0-stable",
    channel: "stable",
    version: "0.2.0",
    notes: "Bug fixes.",
    pubDate: "2026-08-01T00:00:00.000Z",
    rolloutPct: 100,
    mandatory: false,
    targets: { "windows-x86_64": target() },
    ...over,
  };
}

describe("compareVersions", () => {
  it("orders semver triples and sorts malformed as smallest", () => {
    expect(compareVersions("0.2.0", "0.1.9")).toBeGreaterThan(0);
    expect(compareVersions("0.1.0", "0.2.0")).toBeLessThan(0);
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
    expect(compareVersions("1.10.0", "1.9.0")).toBeGreaterThan(0);
    // A malformed version is never "newer".
    expect(compareVersions("garbage", "0.0.1")).toBeLessThan(0);
    expect(compareVersions("0.0.1", "garbage")).toBeGreaterThan(0);
  });
});

describe("updateCohort determinism (mirrors the Rust agent)", () => {
  it("same installationId + releaseId → same bucket, reproducibly", () => {
    const a = updateCohort("device-a", "rel-1");
    const b = updateCohort("device-a", "rel-1");
    expect(a).toBe(b);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(100);
  });

  it("matches the shared cross-language vectors (Rust update.rs asserts the same)", () => {
    // These exact values are hardcoded in the Rust `cohort_matches_backend_vectors`
    // test — if either side changes the hash, one of the two suites goes red.
    expect(updateCohort("11111111-2222-3333-4444-555555555555", "desktop-v0.2.0-stable")).toBe(78);
    expect(updateCohort("device-a", "rel-1")).toBe(34);
    expect(updateCohort("device-b", "rel-1")).toBe(31);
    expect(updateCohort("", "desktop-v0.2.0-stable")).toBe(22);
  });

  it("distribution is roughly uniform across the 100 buckets", () => {
    const buckets = new Array(100).fill(0);
    const n = 100_000;
    for (let k = 0; k < n; k++) buckets[updateCohort(`inst-${k}`, "rel-x")]++;
    const min = Math.min(...buckets);
    const max = Math.max(...buckets);
    // Expected ~1000 per bucket; allow generous slack (never a hot/cold bucket).
    expect(min).toBeGreaterThan(700);
    expect(max).toBeLessThan(1300);
  });
});

describe("isInRollout staged gate (spec §18.4)", () => {
  it("0% serves nobody, 100% serves everybody (installationId irrelevant)", () => {
    expect(isInRollout("device-a", "rel", 0)).toBe(false);
    expect(isInRollout(null, "rel", 0)).toBe(false);
    expect(isInRollout("device-a", "rel", 100)).toBe(true);
    expect(isInRollout(null, "rel", 100)).toBe(true);
  });

  it("a partial rollout serves cohorts below the percentage and no one else", () => {
    // device-a/rel-1 → cohort 34.
    expect(isInRollout("device-a", "rel-1", 34)).toBe(false); // 34 < 34 is false
    expect(isInRollout("device-a", "rel-1", 35)).toBe(true);
    expect(isInRollout("device-a", "rel-1", 100)).toBe(true);
    expect(isInRollout("device-a", "rel-1", 5)).toBe(false);
  });

  it("a partial rollout with no installationId is fail-closed (outside)", () => {
    expect(isInRollout(null, "rel-1", 50)).toBe(false);
    expect(isInRollout("", "rel-1", 50)).toBe(false);
  });

  it("a release at X% serves cohorts < X and 'no update' to cohorts >= X", () => {
    // Sample many installations at a 25% rollout and check every decision
    // agrees with its own cohort — the gate is exactly `cohort < pct`.
    const pct = 25;
    for (let k = 0; k < 500; k++) {
      const id = `roll-${k}`;
      const inside = isInRollout(id, "rel-x", pct);
      expect(inside).toBe(updateCohort(id, "rel-x") < pct);
    }
  });
});

describe("selectUpdate", () => {
  const base = {
    channel: "stable" as const,
    platform: "windows",
    arch: "x86_64",
    currentVersion: "0.1.0",
    installationId: "device-a",
  };

  it("returns the Tauri manifest for a newer, in-rollout release on the channel", () => {
    const m = selectUpdate({ ...base, releases: [release()] }) as TauriUpdateManifest;
    expect(m).not.toBeNull();
    expect(m.version).toBe("0.2.0");
    expect(m.url).toBe("https://cdn.revealyst.com/a.zip");
    expect(m.signature).toBe("sig");
    expect(m.pub_date).toBe("2026-08-01T00:00:00.000Z");
    expect(m.mandatory).toBe(false);
  });

  it("surfaces the mandatory flag", () => {
    const m = selectUpdate({
      ...base,
      releases: [release({ mandatory: true })],
    }) as TauriUpdateManifest;
    expect(m.mandatory).toBe(true);
  });

  it("returns null when the only release is not newer than current", () => {
    const m = selectUpdate({
      ...base,
      currentVersion: "0.2.0",
      releases: [release()],
    });
    expect(m).toBeNull();
  });

  it("routes by channel — a beta release is invisible to a stable caller", () => {
    const m = selectUpdate({
      ...base,
      releases: [release({ channel: "beta", id: "desktop-v0.2.0-beta" })],
    });
    expect(m).toBeNull();
    const b = selectUpdate({
      ...base,
      channel: "beta",
      releases: [release({ channel: "beta", id: "desktop-v0.2.0-beta" })],
    });
    expect(b).not.toBeNull();
  });

  it("skips a release with no artifact for the caller's target", () => {
    const macOnly = release({
      targets: { "darwin-aarch64": target("https://cdn/m.tar.gz", "msig") },
    });
    expect(selectUpdate({ ...base, releases: [macOnly] })).toBeNull();
    // ...but a mac caller gets it.
    const m = selectUpdate({
      ...base,
      platform: "darwin",
      arch: "aarch64",
      releases: [macOnly],
    }) as TauriUpdateManifest;
    expect(m.url).toBe("https://cdn/m.tar.gz");
  });

  it("respects the staged rollout — outside the cohort → null", () => {
    // device-a/desktop-v0.2.0-stable cohort:
    const cohort = updateCohort("device-a", "desktop-v0.2.0-stable");
    // A rollout AT the cohort excludes it; ABOVE includes it.
    expect(selectUpdate({ ...base, releases: [release({ rolloutPct: cohort })] })).toBeNull();
    expect(
      selectUpdate({ ...base, releases: [release({ rolloutPct: cohort + 1 })] }),
    ).not.toBeNull();
  });

  it("halt (rolloutPct 0) serves no update to anyone", () => {
    expect(selectUpdate({ ...base, releases: [release({ rolloutPct: 0 })] })).toBeNull();
    expect(
      selectUpdate({ ...base, installationId: null, releases: [release({ rolloutPct: 0 })] }),
    ).toBeNull();
  });

  it("picks the highest applicable version among several", () => {
    const m = selectUpdate({
      ...base,
      releases: [
        release({ id: "r-020", version: "0.2.0" }),
        release({ id: "r-030", version: "0.3.0" }),
        release({ id: "r-025", version: "0.2.5" }),
      ],
    }) as TauriUpdateManifest;
    expect(m.version).toBe("0.3.0");
  });

  it("empty registry → null (the honest pre-release state)", () => {
    expect(selectUpdate({ ...base, releases: [] })).toBeNull();
  });
});

describe("GET /api/desktop/updates route", () => {
  const url =
    "http://localhost/api/desktop/updates/windows/x86_64/stable/0.1.0";
  const params = (over: Record<string, string> = {}) =>
    Promise.resolve({
      platform: "windows",
      arch: "x86_64",
      channel: "stable",
      version: "0.1.0",
      ...over,
    });

  it("204 when the live registry has no applicable release", async () => {
    const { GET } = await import(
      "../src/app/api/desktop/updates/[platform]/[arch]/[channel]/[version]/route"
    );
    const res = await GET(new Request(url), { params: params() });
    expect(res.status).toBe(204);
  });

  it("204 for an unknown channel (never cross-serves)", async () => {
    const { GET } = await import(
      "../src/app/api/desktop/updates/[platform]/[arch]/[channel]/[version]/route"
    );
    const res = await GET(new Request(url), {
      params: params({ channel: "nightly" }),
    });
    expect(res.status).toBe(204);
  });

  it("returns no per-user data on a 204 (empty body)", async () => {
    const { GET } = await import(
      "../src/app/api/desktop/updates/[platform]/[arch]/[channel]/[version]/route"
    );
    const res = await GET(new Request(url), { params: params() });
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
  });
});

describe("GET /api/desktop/updates route — with a published release (mocked registry)", () => {
  it("200 + Tauri manifest when an applicable release is published", async () => {
    vi.resetModules();
    vi.doMock("../src/lib/desktop-releases", async () => {
      const actual = await vi.importActual<
        typeof import("../src/lib/desktop-releases")
      >("../src/lib/desktop-releases");
      return {
        ...actual,
        DESKTOP_RELEASES: [
          release({ rolloutPct: 100, version: "0.2.0", mandatory: true }),
        ],
      };
    });
    const { GET } = await import(
      "../src/app/api/desktop/updates/[platform]/[arch]/[channel]/[version]/route"
    );
    const res = await GET(
      new Request(
        "http://localhost/api/desktop/updates/windows/x86_64/stable/0.1.0",
        { headers: { "x-revealyst-installation-id": "device-a" } },
      ),
      {
        params: Promise.resolve({
          platform: "windows",
          arch: "x86_64",
          channel: "stable",
          version: "0.1.0",
        }),
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as TauriUpdateManifest;
    expect(body.version).toBe("0.2.0");
    expect(body.url).toBe("https://cdn.revealyst.com/a.zip");
    expect(body.signature).toBe("sig");
    expect(body.mandatory).toBe(true);
    vi.doUnmock("../src/lib/desktop-releases");
    vi.resetModules();
  });
});

describe("latestStableDownloads", () => {
  const target = { url: "https://x/a", signature: "sig" };
  const stable = (
    id: string,
    version: string,
    rolloutPct: number,
    targets: Record<string, typeof target> = {
      "darwin-aarch64": target,
      "windows-x86_64": target,
    },
  ): DesktopRelease => ({
    id,
    channel: "stable",
    version,
    notes: "",
    pubDate: "2026-07-17T00:00:00Z",
    rolloutPct,
    mandatory: false,
    targets,
  });

  it("returns null when the registry is empty (no signed release yet)", () => {
    expect(latestStableDownloads([])).toBeNull();
    // The real registry is empty at launch — the /download page shows the
    // honest "coming soon" state.
    expect(latestStableDownloads(DESKTOP_RELEASES)).toBeNull();
  });

  it("picks the newest generally-available stable release, labelled + sorted", () => {
    const set = latestStableDownloads([
      stable("r1", "0.1.0", 100),
      stable("r2", "0.2.0", 100),
    ]);
    expect(set?.version).toBe("0.2.0");
    expect(set?.downloads.map((d) => d.label)).toEqual([
      "macOS (Apple Silicon)",
      "Windows",
    ]);
    expect(set?.downloads.every((d) => d.url === "https://x/a")).toBe(true);
  });

  it("excludes non-stable channels and halted (rolloutPct 0) releases", () => {
    const beta: DesktopRelease = { ...stable("b", "9.9.9", 100), channel: "beta" };
    const set = latestStableDownloads([
      beta,
      stable("halted", "0.3.0", 0),
      stable("live", "0.2.0", 25),
    ]);
    expect(set?.version).toBe("0.2.0");
  });

  it("returns null for a stable release with no targets", () => {
    expect(latestStableDownloads([stable("empty", "1.0.0", 100, {})])).toBeNull();
  });
});
