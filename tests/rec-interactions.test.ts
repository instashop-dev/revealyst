import { describe, expect, it } from "vitest";
import {
  assembleDigest,
  type DigestConnection,
} from "../src/lib/digest-content";
import type { ScoreTrend } from "../src/lib/dashboard-trends";
import type { RecentMovement } from "../src/lib/recent-movement";
import type { ComponentDetailRow } from "../src/lib/score-insights";
import { LEGACY_CATALOG_RECOMMENDATIONS } from "./fixtures/recommendation-catalog";
import {
  DEFAULT_SNOOZE_DAYS,
  deriveRecInteractionView,
  isRecSuppressed,
  snoozeUntilFrom,
} from "../src/lib/rec-interactions";

// W5-D pure state-transition rules (snooze expiry, dismissed-never-remails) and
// the digest dismiss-filter — no DB, no React.

const NOW = new Date("2026-07-06T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

describe("isRecSuppressed (snooze expiry + dismiss)", () => {
  it("dismissed is always suppressed, regardless of any snooze_until", () => {
    expect(isRecSuppressed({ state: "dismissed", snoozeUntil: null }, NOW)).toBe(
      true,
    );
    // A stale snooze_until on a dismissed row never un-suppresses it.
    expect(
      isRecSuppressed(
        { state: "dismissed", snoozeUntil: new Date(NOW.getTime() - DAY) },
        NOW,
      ),
    ).toBe(true);
  });

  it("snoozed is suppressed only while snooze_until is in the future", () => {
    const future = new Date(NOW.getTime() + 3 * DAY);
    const past = new Date(NOW.getTime() - DAY);
    expect(isRecSuppressed({ state: "snoozed", snoozeUntil: future }, NOW)).toBe(
      true,
    );
    // Snooze expiry: once snooze_until has passed, the rec resurfaces.
    expect(isRecSuppressed({ state: "snoozed", snoozeUntil: past }, NOW)).toBe(
      false,
    );
  });

  it("accepts an ISO-string snooze_until (as it comes back from Postgres)", () => {
    const future = new Date(NOW.getTime() + DAY).toISOString();
    expect(isRecSuppressed({ state: "snoozed", snoozeUntil: future }, NOW)).toBe(
      true,
    );
  });

  it("a snoozed row with no snooze_until fails OPEN (never silently buries)", () => {
    expect(isRecSuppressed({ state: "snoozed", snoozeUntil: null }, NOW)).toBe(
      false,
    );
  });

  it("tried is never suppressed (positive feedback keeps the rec visible)", () => {
    expect(isRecSuppressed({ state: "tried", snoozeUntil: null }, NOW)).toBe(
      false,
    );
  });
});

describe("snoozeUntilFrom", () => {
  it("adds whole days to now", () => {
    expect(snoozeUntilFrom(NOW, DEFAULT_SNOOZE_DAYS).getTime()).toBe(
      NOW.getTime() + DEFAULT_SNOOZE_DAYS * DAY,
    );
  });
});

// (W6-C, ADR 0033) VALID_REC_IDS is retired: the recommendation route now
// validates `recId` against the per-org catalog (`forOrg(...).catalog.list()`),
// covered by the catalog seed + isolation tests — no static id mirror to assert.

describe("deriveRecInteractionView", () => {
  it("partitions rows into suppressed (dismissed + live snooze) and tried", () => {
    const view = deriveRecInteractionView(
      [
        { recId: "a", state: "dismissed", snoozeUntil: null },
        { recId: "b", state: "snoozed", snoozeUntil: new Date(NOW.getTime() + DAY) },
        { recId: "c", state: "snoozed", snoozeUntil: new Date(NOW.getTime() - DAY) },
        { recId: "d", state: "tried", snoozeUntil: null },
      ],
      NOW,
    );
    expect([...view.suppressedRecIds].sort()).toEqual(["a", "b"]);
    // The expired snooze (c) is NOT suppressed and NOT tried — it resurfaces.
    expect([...view.triedRecIds]).toEqual(["d"]);
  });
});

// ─── Digest dismiss-filter (dismissed never re-mails) ───

function conn(lastSuccessAt: Date): DigestConnection {
  return { vendor: "openai", status: "active", lastSuccessAt };
}

function emptyMovement(): RecentMovement {
  return {
    periodDays: 28,
    currentFrom: "2026-06-08",
    currentTo: "2026-07-05",
    previousFrom: "2026-05-11",
    previousTo: "2026-06-07",
    metrics: [],
  };
}

function weakComponent(key: string): ComponentDetailRow {
  // A measured, meaningfully-weak component (normalized in the bottom band,
  // non-trivial weight) so deriveAttention emits its coaching recommendation.
  return {
    key,
    label: key,
    kind: "plain",
    omitted: false,
    raw: 1,
    normalized: 10,
    weight: 1,
    contribution: 10,
    calcSimple: "x",
  };
}

describe("assembleDigest dismiss-filter (W5-D)", () => {
  const base = {
    now: NOW,
    connections: [conn(new Date(NOW.getTime() - DAY))],
    movement: emptyMovement(),
    trends: [] as ScoreTrend[],
    // adoption.active_days weak → the "adoption-active-days" recommendation.
    scoreComponents: [
      { slug: "adoption" as const, components: [weakComponent("active_days")] },
    ],
    // W6-C: the catalog rows the digest engine selects from (was the static map).
    recommendations: LEGACY_CATALOG_RECOMMENDATIONS,
  };

  it("surfaces the coaching rec when nothing is dismissed", () => {
    const content = assembleDigest({ ...base, lane: "personal" });
    const ids = content.recommendations.map((r) => r.recId);
    expect(ids).toContain("adoption-active-days");
  });

  it("drops a dismissed rec from the recommendation lane (never re-mails)", () => {
    const content = assembleDigest({
      ...base,
      lane: "personal",
      dismissedRecIds: new Set(["adoption-active-days"]),
    });
    const ids = content.recommendations.map((r) => r.recId);
    expect(ids).not.toContain("adoption-active-days");
  });

  it("an unrelated dismissed id leaves the rec untouched", () => {
    const content = assembleDigest({
      ...base,
      lane: "personal",
      dismissedRecIds: new Set(["some-other-rec"]),
    });
    const ids = content.recommendations.map((r) => r.recId);
    expect(ids).toContain("adoption-active-days");
  });
});
