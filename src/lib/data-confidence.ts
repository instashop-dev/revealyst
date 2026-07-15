// Data Confidence — the read-path framework that turns raw honesty gaps into a
// single, beginner-friendly "can I trust this dashboard?" story.
//
// WHY THIS EXISTS. Revealyst's non-negotiable honesty invariant (Spec V4 §4,
// CLAUDE.md §8 invariant b) means every estimated / partial / missing value is
// disclosed, never papered over. The raw disclosures are `HonestyGap`s collected
// onto `connector_runs.gaps` and surfaced as `CollectedGap[]` (see
// src/lib/honesty-gaps.ts). Rendered one-alert-per-gap they dominated the
// companion homepage, repeated near-identical cards (the parse-drift gap carries
// its counts in free text, so two syncs with different counts never deduped),
// exposed backend terminology, and gave minor and major issues equal weight.
//
// This module preserves 100% of that transparency while making it usable. It is
// PURE (no React, no I/O) so a content fact-check can sweep every user-facing
// string here in one file, and so the classification / aggregation / confidence
// logic is unit-testable in isolation.
//
// HONESTY POSTURE (invariant b), baked in:
//  - It invents no number. Estimated spend stays labelled "estimated"; it is
//    never presented as billing truth (the `spend_cents` vs `spend_cents_estimated`
//    distinction is load-bearing — see CLAUDE.md).
//  - It never floors missing data to zero — a disclosure says "may be lower than
//    actual", never a fabricated exact figure.
//  - Confidence state is derived from user IMPACT, not an issue count, and never
//    expressed as a fabricated percentage or certainty.
//
// EXTENSIBILITY. Adding a new disclosure requires only registering a definition
// in DISCLOSURE_DEFINITIONS (+ a matcher if it rides the `other` kind's free-text
// detail). No homepage/component change is needed: unknown kinds and unrecognised
// `other` details fall back to a safe generic definition, and the raw payload is
// always preserved under Technical details.

import { formatRelativeTime } from "@/lib/format";
import type { CollectedGap } from "@/lib/honesty-gaps";

// ─── Vocabulary ───────────────────────────────────────────────────────────────

/** The five user-facing buckets every disclosure is sorted into. */
export type DisclosureCategory =
  | "coverage"
  | "cost-estimates"
  | "import-quality"
  | "sync-issues"
  | "other";

/** User-facing severity — drives ordering and the confidence state. `info` =
 * estimated/partial but the dashboard stays useful; `attention` = a primary
 * metric is materially affected or the user needs to act. Deliberately NOT a
 * count: three estimated-cost notices are still just "info". */
export type DisclosureSeverity = "info" | "attention";

/** The overall trust state shown on the compact card. Ordered worst-last for
 * readability; derived by `computeConfidenceState`. */
export type ConfidenceState =
  | "reliable"
  | "mostly-complete"
  | "needs-attention"
  | "sync-failed";

/** How an affected metric is qualified inline next to its value. `as-of` is a
 * freshness qualifier ("Data through …"); the others are shown verbatim. */
export type MetricQualifierKind = "estimated" | "partial" | "as-of";

// ─── Copy (single source of truth; sweepable by a content fact-check) ─────────

export const DATA_CONFIDENCE_COPY = {
  cardTitle: "Data confidence",
  /** Opens the details drawer. */
  reviewCta: "Review data quality",
  drawerTitle: "Data quality",
  drawerDescription:
    "Everything Revealyst knows might be missing, estimated, or incomplete on this page — in plain language, with the raw details one tap away.",
  technicalDetailsLabel: "Technical details",
  /** Small lead-in above the raw payload inside Technical details. */
  technicalDetailsLead: "Exact messages from your connected tools:",
  affectedLead: "Affects",
  impactLead: "What this means",
  emptyDrawer:
    "No known limitations right now — everything on this page is measured and complete.",
  /** State chip label + the one-line body under the card title. */
  states: {
    reliable: {
      label: "Reliable",
      body: "Your latest sync looks complete. Nothing here is estimated or missing in a way that changes how to read your numbers.",
    },
    "mostly-complete": {
      label: "Mostly complete",
      body: "Your latest sync completed, but some usage may be missing or estimated.",
    },
    "needs-attention": {
      label: "Needs attention",
      body: "Some of your numbers are affected enough to be worth a closer look.",
    },
    "sync-failed": {
      label: "Sync failed",
      body: "Your last sync didn't complete, so these numbers may be out of date until it runs again.",
    },
  },
  categories: {
    coverage: "Coverage",
    "cost-estimates": "Cost estimates",
    "import-quality": "Import quality",
    "sync-issues": "Sync issues",
    other: "Other",
  },
  /** Inline metric-qualifier chip labels. */
  qualifiers: {
    estimated: "Estimated",
    partial: "Partial",
    "as-of": "As of",
  },
} as const satisfies {
  cardTitle: string;
  reviewCta: string;
  drawerTitle: string;
  drawerDescription: string;
  technicalDetailsLabel: string;
  technicalDetailsLead: string;
  affectedLead: string;
  impactLead: string;
  emptyDrawer: string;
  states: Record<ConfidenceState, { label: string; body: string }>;
  categories: Record<DisclosureCategory, string>;
  qualifiers: Record<MetricQualifierKind, string>;
};

// ─── Disclosure definitions (the registry) ────────────────────────────────────

export type DisclosureDefinition = {
  /** Stable internal key — the classifier resolves each raw gap to one of these. */
  typeKey: string;
  category: DisclosureCategory;
  severity: DisclosureSeverity;
  /** Plain-language title (no jargon, no snake_case). */
  title: string;
  /** One sentence: what happened. */
  explanation: string;
  /** One sentence: what it means for the user's numbers. */
  impact: string;
  /** Which metric this qualifies inline, if any. */
  affected?: { label: string; qualifier: MetricQualifierKind };
  /** A recommended next step, only when one genuinely exists. */
  action?: { label: string; href: string };
};

/** The 6 frozen non-`other` HonestyGap kinds (src/contracts/connector.ts) map
 * 1:1 to a definition by kind. The `other` kind carries its meaning in free-text
 * `detail`, so it is sub-classified by prefix (see OTHER_DETAIL_MATCHERS). */
export const DISCLOSURE_DEFINITIONS: Record<string, DisclosureDefinition> = {
  // — Coverage —
  oauth_actors_missing: {
    typeKey: "oauth_actors_missing",
    category: "coverage",
    severity: "info",
    title: "Some Claude usage may be missing",
    explanation: "Claude currently reports only part of the available usage data.",
    impact: "Your usage totals may be lower than your actual usage.",
    affected: { label: "Usage totals", qualifier: "partial" },
  },
  telemetry_only_users_in_totals: {
    typeKey: "telemetry_only_users_in_totals",
    category: "coverage",
    severity: "info",
    title: "Some usage isn't broken down by person",
    explanation:
      "One of your tools reports overall totals but not a full per-person breakdown.",
    impact: "Per-person figures may be lower than the overall totals.",
    affected: { label: "Per-person figures", qualifier: "partial" },
  },
  shared_key_not_person_level: {
    typeKey: "shared_key_not_person_level",
    category: "coverage",
    severity: "info",
    title: "Some usage can't be linked to a person",
    explanation: "Some activity came through a shared key with no person attached.",
    impact: "It's counted in your totals but not tied to anyone.",
  },
  service_accounts_unresolved: {
    typeKey: "service_accounts_unresolved",
    category: "coverage",
    severity: "info",
    title: "Some activity came from a service account",
    explanation:
      "Activity from an automated service account isn't linked to a person yet.",
    impact: "It stays in your totals but isn't attributed to anyone.",
    action: { label: "Match accounts", href: "/reconcile" },
  },
  sub_daily_unavailable: {
    typeKey: "sub_daily_unavailable",
    category: "coverage",
    severity: "info",
    title: "No hour-by-hour detail for one tool",
    explanation: "One tool reports daily totals only.",
    impact: "Activity for it can't be shown by time of day.",
  },
  // — Sync issues —
  sync_window_incomplete: {
    typeKey: "sync_window_incomplete",
    category: "sync-issues",
    severity: "info",
    title: "Your last sync covered a shorter period",
    explanation:
      "Older local logs had already been cleaned up, so the sync couldn't reach as far back as it tried to.",
    impact: "Days before the covered window were left as they were, not zeroed.",
  },
  // — Import quality (rides the `other` kind) —
  import_parse_drift: {
    typeKey: "import_parse_drift",
    category: "import-quality",
    severity: "info",
    title: "Some imported activity could not be recognised",
    explanation: "Revealyst skipped log entries whose format it didn't recognise.",
    impact: "Some activity may be missing from your numbers.",
    affected: { label: "Activity totals", qualifier: "partial" },
  },
  // — Cost estimates (ride the `other` kind) —
  estimated_pricing: {
    typeKey: "estimated_pricing",
    category: "cost-estimates",
    severity: "info",
    title: "Some costs are estimated",
    explanation: "Revealyst calculates some costs using published model prices.",
    impact:
      "Your invoice may differ because of discounts, taxes, credits, or custom pricing.",
    affected: { label: "AI spend", qualifier: "estimated" },
  },
  unknown_model_pricing: {
    typeKey: "unknown_model_pricing",
    category: "cost-estimates",
    severity: "info",
    title: "A model price could not be confirmed",
    explanation: "Revealyst used a conservative estimate for an unrecognised model.",
    impact: "The estimated cost may be higher than the actual cost.",
    affected: { label: "AI spend", qualifier: "estimated" },
  },
  // — Generic fallbacks (never user-visible jargon) —
  other_generic: {
    typeKey: "other_generic",
    category: "other",
    severity: "info",
    title: "A data limitation was detected",
    explanation: "Some information may be incomplete.",
    impact: "Some numbers on this page may not be exact.",
  },
  unknown: {
    typeKey: "unknown",
    category: "other",
    severity: "info",
    title: "A data limitation was detected",
    explanation: "Some information may be incomplete.",
    impact: "Some numbers on this page may not be exact.",
  },
};

/** Prefix matchers for the free-text `detail` of `{ kind: "other" }` gaps. The
 * producers write stable English prefixes (packages/revealyst-agent:
 * summarize.ts / index.ts) — matched case-insensitively so a producer casing
 * tweak can't silently drop a disclosure into the generic bucket. Order matters
 * only if two prefixes overlap (none do today). */
const OTHER_DETAIL_MATCHERS: ReadonlyArray<{ prefix: string; typeKey: string }> = [
  { prefix: "log parse drift", typeKey: "import_parse_drift" },
  { prefix: "spend_cents_estimated", typeKey: "estimated_pricing" },
  { prefix: "unknown model rates defaulted high", typeKey: "unknown_model_pricing" },
];

/** The frozen non-`other` kinds that have a first-class definition. */
const KNOWN_KINDS: ReadonlySet<string> = new Set([
  "oauth_actors_missing",
  "telemetry_only_users_in_totals",
  "shared_key_not_person_level",
  "service_accounts_unresolved",
  "sub_daily_unavailable",
  "sync_window_incomplete",
]);

/**
 * Resolve a raw gap to its definition typeKey. A first-class kind maps by name;
 * an `other` gap is sub-classified by its detail prefix; anything unrecognised
 * (a future kind, or an `other` with novel detail) falls back to a generic
 * definition — it still renders safely, with its raw payload preserved. Pure.
 */
export function classifyDisclosure(gap: CollectedGap): DisclosureDefinition {
  if (gap.kind === "other") {
    const detail = (gap.detail ?? "").trim().toLowerCase();
    for (const matcher of OTHER_DETAIL_MATCHERS) {
      if (detail.startsWith(matcher.prefix)) {
        return DISCLOSURE_DEFINITIONS[matcher.typeKey];
      }
    }
    return DISCLOSURE_DEFINITIONS.other_generic;
  }
  if (KNOWN_KINDS.has(gap.kind)) {
    return DISCLOSURE_DEFINITIONS[gap.kind];
  }
  return DISCLOSURE_DEFINITIONS.unknown;
}

// ─── Aggregation ──────────────────────────────────────────────────────────────

/** Regex over the parse-drift detail so repeated syncs' counts can be summed
 * accurately (never guessed). Producer format:
 * "log parse drift: N lines skipped, M unknown record types". */
const PARSE_DRIFT_COUNTS =
  /(\d+)\s+lines?\s+skipped,\s+(\d+)\s+unknown\s+record\s+types?/i;

export type DisclosureGroup = {
  typeKey: string;
  definition: DisclosureDefinition;
  category: DisclosureCategory;
  severity: DisclosureSeverity;
  /** How many raw occurrences rolled into this one group. */
  count: number;
  /** The raw gaps, preserved verbatim for the Technical details expander. */
  occurrences: CollectedGap[];
  /** An accurate, aggregated count line where the disclosure carries numbers in
   * its detail (only parse-drift today). Omitted when nothing is countable. */
  aggregateNote?: string;
};

const CATEGORY_ORDER: Record<DisclosureCategory, number> = {
  "cost-estimates": 0,
  coverage: 1,
  "import-quality": 2,
  "sync-issues": 3,
  other: 4,
};

const SEVERITY_RANK: Record<DisclosureSeverity, number> = {
  attention: 0,
  info: 1,
};

/**
 * Collapse raw gaps into one group per disclosure TYPE (never one card per
 * sync/import event). Compatible counts are aggregated where they can be parsed
 * accurately; the raw occurrences are always retained for Technical details.
 * Groups are ordered attention-first, then by category, so the most consequential
 * disclosure leads. Pure — input order does not affect output order.
 */
export function aggregateDisclosures(gaps: CollectedGap[]): DisclosureGroup[] {
  const byType = new Map<string, DisclosureGroup>();
  for (const gap of gaps) {
    const definition = classifyDisclosure(gap);
    const existing = byType.get(definition.typeKey);
    if (existing) {
      existing.count += 1;
      existing.occurrences.push(gap);
    } else {
      byType.set(definition.typeKey, {
        typeKey: definition.typeKey,
        definition,
        category: definition.category,
        severity: definition.severity,
        count: 1,
        occurrences: [gap],
      });
    }
  }

  for (const group of byType.values()) {
    if (group.typeKey === "import_parse_drift") {
      let skipped = 0;
      let unknown = 0;
      let parsed = 0;
      for (const occ of group.occurrences) {
        const m = (occ.detail ?? "").match(PARSE_DRIFT_COUNTS);
        if (m) {
          skipped += Number(m[1]);
          unknown += Number(m[2]);
          parsed += 1;
        }
      }
      if (parsed > 0 && (skipped > 0 || unknown > 0)) {
        const syncs = `${parsed} ${parsed === 1 ? "sync" : "syncs"}`;
        const entries = `${skipped} ${skipped === 1 ? "entry" : "entries"} skipped`;
        const types = `${unknown} unrecognised ${unknown === 1 ? "type" : "types"}`;
        group.aggregateNote = `Across ${syncs}: ${entries}, ${types}.`;
      }
    }
  }

  return [...byType.values()].sort((a, b) => {
    const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (bySeverity !== 0) return bySeverity;
    return CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category];
  });
}

// ─── Confidence state ─────────────────────────────────────────────────────────

/**
 * Derive the overall trust state from user IMPACT, not issue count.
 *  - sync-failed: a connection is erroring AND no usable data was produced
 *    (nothing meaningful could be shown).
 *  - needs-attention: a connection is erroring (data still exists), or any
 *    disclosure is `attention` severity.
 *  - mostly-complete: only `info` disclosures — estimated/partial but usable.
 *  - reliable: nothing to disclose.
 * Never returns a percentage or a fabricated certainty.
 */
export function computeConfidenceState(input: {
  groups: DisclosureGroup[];
  connectionErrored: boolean;
  hasData: boolean;
}): ConfidenceState {
  if (input.connectionErrored && !input.hasData) return "sync-failed";
  const hasMaterial =
    input.connectionErrored || input.groups.some((g) => g.severity === "attention");
  if (hasMaterial) return "needs-attention";
  if (input.groups.length > 0) return "mostly-complete";
  return "reliable";
}

// ─── Top-level model ──────────────────────────────────────────────────────────

export type DataConfidenceModel = {
  state: ConfidenceState;
  stateLabel: string;
  body: string;
  /** The compact summary bullet lines on the card (already user-facing). */
  summaryLines: string[];
  groups: DisclosureGroup[];
  hasDisclosures: boolean;
  /** "8 minutes ago" or null — the card omits the line when null. */
  lastCheckedLabel: string | null;
};

/**
 * The single pure builder the homepage calls. Turns raw `CollectedGap[]` +
 * sync/connection facts into everything the card and drawer render. Deterministic
 * over an explicit `now` (see relativeTimeLabel). Adding a disclosure type never
 * touches this function — it works off the registry.
 */
export function buildDataConfidence(input: {
  gaps: CollectedGap[];
  connectionErrored: boolean;
  hasData: boolean;
  lastCheckedAt?: Date | string | null;
  now: Date;
  /** T1.5 (TEL-016): the person's connected-source count (distinct active
   * vendors), when the caller already has it (self-view only — this is the
   * re-homed replacement for the deleted orphaned SignalCoverageBadge). Omitted
   * entirely when the caller doesn't pass it, so team-view/other callers that
   * don't track per-person sources see no behavior change. */
  sourceCount?: number;
}): DataConfidenceModel {
  const groups = aggregateDisclosures(input.gaps);
  const state = computeConfidenceState({
    groups,
    connectionErrored: input.connectionErrored,
    hasData: input.hasData,
  });
  const stateCopy = DATA_CONFIDENCE_COPY.states[state];
  // Reuse the app's one relative-time format (same "Nm ago" the sync-status
  // surfaces show) — a second format would drift. Omit the line when there's
  // no timestamp rather than guessing a freshness.
  const lastCheckedLabel =
    input.lastCheckedAt != null
      ? formatRelativeTime(input.lastCheckedAt, input.now)
      : null;

  const summaryLines: string[] = [];
  // T1.5 (TEL-016): a 1-source person must be able to see their source
  // coverage on the self-view without a rec being surfaced. This card renders
  // whenever there's something to disclose OR data exists (see
  // `showDataConfidence` at the call site), so it's the always-relevant home
  // for the count — unlike a rec-attached badge, which never appears until a
  // rec does. Singular/plural matches the other count lines below.
  if (input.sourceCount != null) {
    // Zero is a true claim (historical data with everything since
    // disconnected) but the house convention avoids painting a bare "0"
    // numeral — say it in words, like the deleted badge and the coaching
    // confidence note both did.
    summaryLines.push(
      input.sourceCount === 0
        ? "No connected sources"
        : input.sourceCount === 1
          ? "1 connected source"
          : `${input.sourceCount} connected sources`,
    );
  }
  const costCount = groups.filter((g) => g.category === "cost-estimates").length;
  if (costCount > 0) {
    summaryLines.push(
      `${costCount} cost ${costCount === 1 ? "estimate uses" : "estimates use"} published pricing`,
    );
  }
  const incompleteCount = groups.filter(
    (g) =>
      g.category === "coverage" ||
      g.category === "import-quality" ||
      g.category === "sync-issues",
  ).length;
  if (incompleteCount > 0) {
    summaryLines.push(
      `${incompleteCount} ${incompleteCount === 1 ? "source has" : "sources have"} incomplete data`,
    );
  }
  const otherCount = groups.filter((g) => g.category === "other").length;
  if (otherCount > 0) {
    summaryLines.push(
      `${otherCount} other data ${otherCount === 1 ? "limitation" : "limitations"} noted`,
    );
  }
  if (lastCheckedLabel) {
    summaryLines.push(`Last checked ${lastCheckedLabel}`);
  }

  return {
    state,
    stateLabel: stateCopy.label,
    body: stateCopy.body,
    summaryLines,
    groups,
    hasDisclosures: groups.length > 0,
    lastCheckedLabel,
  };
}
