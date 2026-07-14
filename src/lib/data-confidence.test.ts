import { describe, expect, it } from "vitest";
import type { CollectedGap } from "@/lib/honesty-gaps";
import {
  aggregateDisclosures,
  buildDataConfidence,
  classifyDisclosure,
  computeConfidenceState,
  DISCLOSURE_DEFINITIONS,
  type DisclosureGroup,
} from "@/lib/data-confidence";

// Real producer detail strings (packages/revealyst-agent) — kept verbatim so
// this test also guards the free-text prefixes the classifier depends on.
const PARSE_DRIFT = (skipped: number, unknown: number): CollectedGap => ({
  kind: "other",
  detail: `log parse drift: ${skipped} lines skipped, ${unknown} unknown record types`,
});
const ESTIMATED_PRICING: CollectedGap = {
  kind: "other",
  detail: "spend_cents_estimated uses public list prices, not invoices",
};
const UNKNOWN_MODEL: CollectedGap = {
  kind: "other",
  detail: "unknown model rates defaulted high: claude-frontier-9, gpt-9o",
};
const OAUTH: CollectedGap = {
  kind: "oauth_actors_missing",
  detail:
    "Anthropic Console claude_code analytics returns only customer_type=api actors in practice (anthropics/claude-code#27780); OAuth/subscription users may be missing from these numbers.",
};

describe("classifyDisclosure", () => {
  it("maps each frozen non-`other` kind to its first-class definition", () => {
    for (const kind of [
      "oauth_actors_missing",
      "telemetry_only_users_in_totals",
      "shared_key_not_person_level",
      "service_accounts_unresolved",
      "sub_daily_unavailable",
      "sync_window_incomplete",
    ]) {
      expect(classifyDisclosure({ kind }).typeKey).toBe(kind);
    }
  });

  it("sub-classifies `other` gaps by their detail prefix", () => {
    expect(classifyDisclosure(PARSE_DRIFT(1, 1)).typeKey).toBe("import_parse_drift");
    expect(classifyDisclosure(ESTIMATED_PRICING).typeKey).toBe("estimated_pricing");
    expect(classifyDisclosure(UNKNOWN_MODEL).typeKey).toBe("unknown_model_pricing");
  });

  it("matches `other` prefixes case-insensitively (producer casing can't drop a disclosure)", () => {
    expect(
      classifyDisclosure({ kind: "other", detail: "LOG PARSE DRIFT: 2 lines skipped, 3 unknown record types" })
        .typeKey,
    ).toBe("import_parse_drift");
  });

  it("falls back to a generic definition for an unrecognised `other` detail", () => {
    const def = classifyDisclosure({ kind: "other", detail: "some brand-new limitation" });
    expect(def.typeKey).toBe("other_generic");
    expect(def.title).toBe("A data limitation was detected");
    expect(def.category).toBe("other");
  });

  it("falls back to a generic definition for a completely unknown future kind", () => {
    const def = classifyDisclosure({ kind: "quantum_flux_gap" });
    expect(def.typeKey).toBe("unknown");
    expect(def.title).toBe("A data limitation was detected");
  });

  it("never surfaces snake_case / raw kind in user-facing copy", () => {
    for (const def of Object.values(DISCLOSURE_DEFINITIONS)) {
      expect(def.title).not.toMatch(/_/);
      expect(def.explanation).not.toMatch(/_/);
      expect(def.impact).not.toMatch(/_/);
    }
  });
});

describe("aggregateDisclosures", () => {
  it("collapses repeated parse-drift syncs into ONE group and sums the counts accurately", () => {
    const groups = aggregateDisclosures([
      PARSE_DRIFT(190, 799),
      PARSE_DRIFT(28, 765),
      PARSE_DRIFT(28, 745),
    ]);
    expect(groups).toHaveLength(1);
    const g = groups[0];
    expect(g.typeKey).toBe("import_parse_drift");
    expect(g.count).toBe(3);
    expect(g.occurrences).toHaveLength(3); // raw occurrences retained for Technical details
    expect(g.aggregateNote).toContain("246 entries skipped");
    expect(g.aggregateNote).toContain("2309 unrecognised types");
    expect(g.aggregateNote).toContain("Across 3 syncs");
  });

  it("groups by disclosure type across mixed kinds and orders by category", () => {
    const groups = aggregateDisclosures([
      OAUTH,
      PARSE_DRIFT(1, 1),
      ESTIMATED_PRICING,
      UNKNOWN_MODEL,
    ]);
    // cost-estimates first (two of them), then coverage, then import-quality.
    expect(groups.map((g) => g.category)).toEqual([
      "cost-estimates",
      "cost-estimates",
      "coverage",
      "import-quality",
    ]);
  });

  it("is order-independent (same input in any order → same grouped output)", () => {
    const a = aggregateDisclosures([OAUTH, ESTIMATED_PRICING, PARSE_DRIFT(2, 2)]);
    const b = aggregateDisclosures([PARSE_DRIFT(2, 2), OAUTH, ESTIMATED_PRICING]);
    expect(a.map((g) => g.typeKey)).toEqual(b.map((g) => g.typeKey));
  });

  it("returns nothing for no gaps (resolved disclosures disappear)", () => {
    expect(aggregateDisclosures([])).toEqual([]);
  });
});

describe("computeConfidenceState (impact-driven, not count-driven)", () => {
  const infoGroup = (): DisclosureGroup => ({
    typeKey: "estimated_pricing",
    definition: DISCLOSURE_DEFINITIONS.estimated_pricing,
    category: "cost-estimates",
    severity: "info",
    count: 1,
    occurrences: [ESTIMATED_PRICING],
  });
  const attentionGroup = (): DisclosureGroup => ({
    ...infoGroup(),
    severity: "attention",
  });

  it("reliable when nothing to disclose", () => {
    expect(
      computeConfidenceState({ groups: [], connectionErrored: false, hasData: true }),
    ).toBe("reliable");
  });

  it("mostly-complete for info-only disclosures — even many of them", () => {
    expect(
      computeConfidenceState({
        groups: [infoGroup(), infoGroup(), infoGroup(), infoGroup()],
        connectionErrored: false,
        hasData: true,
      }),
    ).toBe("mostly-complete");
  });

  it("needs-attention when a disclosure is material, regardless of count", () => {
    expect(
      computeConfidenceState({
        groups: [attentionGroup()],
        connectionErrored: false,
        hasData: true,
      }),
    ).toBe("needs-attention");
  });

  it("needs-attention when a connection errored but data still exists", () => {
    expect(
      computeConfidenceState({ groups: [], connectionErrored: true, hasData: true }),
    ).toBe("needs-attention");
  });

  it("sync-failed only when a connection errored AND no usable data", () => {
    expect(
      computeConfidenceState({ groups: [], connectionErrored: true, hasData: false }),
    ).toBe("sync-failed");
  });
});

describe("buildDataConfidence", () => {
  const now = new Date("2026-07-14T12:08:00Z");

  it("is reliable with no gaps, and reports resolved (no disclosures)", () => {
    const model = buildDataConfidence({
      gaps: [],
      connectionErrored: false,
      hasData: true,
      lastCheckedAt: new Date("2026-07-14T12:00:00Z"),
      now,
    });
    expect(model.state).toBe("reliable");
    expect(model.hasDisclosures).toBe(false);
    expect(model.groups).toEqual([]);
    // Only the freshness line survives when there is nothing else to say —
    // reusing the app's shared "Nm ago" format (src/lib/format.ts).
    expect(model.summaryLines).toEqual(["Last checked 8m ago"]);
  });

  it("builds the mostly-complete story from a realistic mixed gap set", () => {
    const model = buildDataConfidence({
      gaps: [
        OAUTH,
        PARSE_DRIFT(190, 799),
        PARSE_DRIFT(28, 765),
        ESTIMATED_PRICING,
        UNKNOWN_MODEL,
      ],
      connectionErrored: false,
      hasData: true,
      lastCheckedAt: new Date("2026-07-14T12:00:00Z"),
      now,
    });
    expect(model.state).toBe("mostly-complete");
    expect(model.stateLabel).toBe("Mostly complete");
    expect(model.hasDisclosures).toBe(true);
    // cost-estimates (2) grouped as 2 groups; coverage (oauth) + import (parse) = 2 sources.
    expect(model.summaryLines).toContain("2 cost estimates use published pricing");
    expect(model.summaryLines).toContain("2 sources have incomplete data");
    expect(model.summaryLines).toContain("Last checked 8m ago");
  });

  it("escalates to sync-failed when a connection errored and no data was produced", () => {
    const model = buildDataConfidence({
      gaps: [],
      connectionErrored: true,
      hasData: false,
      now,
    });
    expect(model.state).toBe("sync-failed");
    expect(model.stateLabel).toBe("Sync failed");
  });
});
