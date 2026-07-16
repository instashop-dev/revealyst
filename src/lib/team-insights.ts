import { SEGMENT_MIN_PEOPLE_TO_NAME } from "./segments";

// PURE aggregate manager-insight generator (TCI Phase 2-F, ADR 0050). NO I/O,
// NO LLM (tripwire) — a deterministic function of already-computed org
// aggregates. The poller reducer (src/scoring/recompute-team-insights.ts)
// batches the reads once and hands the aggregates here; this file decides WHICH
// insights exist, their COUNT-ONLY params, and their priority order.
//
// Invariants:
//   - COUNT-ONLY: every params variant carries only numbers + capability slugs.
//     A person id/name/email is structurally unrepresentable (pinned by a test).
//   - MIN_PEOPLE-suppressed: an insight whose evidence cohort is below the floor
//     is NOT generated (never a suppressed-but-implied insight).
//   - Deterministic: same aggregates → same ordered candidate list, so nightly
//     regeneration is idempotent (two runs → identical open feed).

export type TeamInsightCategory =
  | "capability_gap"
  | "plateau"
  | "concentration"
  | "low_adoption"
  | "data_incomplete"
  | "positive_growth";

export type TeamInsightSeverity = "info" | "opportunity" | "attention";

/**
 * COUNT-ONLY insight params. Every variant admits ONLY numbers and capability
 * slugs — never a person id, name, or email. The generator emits these; the
 * glossary renders prose from them at read time. The structural no-person-id
 * test (`tests/team-insights-generator.test.ts`) asserts every key of every
 * emitted params object is in `ALLOWED_PARAM_KEYS` and no value is uuid-shaped.
 */
export type TeamInsightParams =
  // capability_gap, concentration — a capability's coverage counts.
  | { capabilitySlug: string; mastered: number; total: number }
  // plateau, positive_growth — a capability's mastered count now vs the prior
  // period.
  | { capabilitySlug: string; masteredNow: number; masteredBefore: number }
  // low_adoption — org-wide people counts.
  | { active: number; total: number }
  // data_incomplete — connection freshness counts.
  | { stale: number; connected: number };

/** The allowlist the structural test enforces — no person-identifying key can
 * ever appear in a stored/emitted insight params object. */
export const ALLOWED_PARAM_KEYS = [
  "capabilitySlug",
  "mastered",
  "total",
  "masteredNow",
  "masteredBefore",
  "active",
  "connected",
  "stale",
] as const;

export type TeamInsightCandidate = {
  category: TeamInsightCategory;
  severity: TeamInsightSeverity;
  /** Dedup discriminator: a capability slug, or "" for org-wide categories. */
  subject: string;
  params: TeamInsightParams;
  /** Count-only ranking magnitude within a category (people/counts) — bigger =
   * more prominent. Never rendered; used only to order same-category candidates
   * deterministically. */
  magnitude: number;
};

/** At most this many OPEN insights are ever shown (minimal-by-default). The
 * reducer excludes dismissed subjects, then takes the top N of the ranked
 * candidate list, so dismissing one surfaces the next-ranked candidate. */
export const MAX_OPEN_INSIGHTS = 3;

/** A capability is "broadly covered" once more than this many people have
 * reached mastery — above it, it is neither a gap nor a concentration risk. */
export const CONCENTRATION_CEILING = 2;

/** Fixed category priority (index 0 = highest). Documented order (ADR 0050):
 * trust first (a stale connection undermines every other number), then the
 * coaching signals, then good news last (still surfaced when slots remain). */
export const CATEGORY_PRIORITY: readonly TeamInsightCategory[] = [
  "data_incomplete",
  "capability_gap",
  "plateau",
  "low_adoption",
  "concentration",
  "positive_growth",
];

const SEVERITY_BY_CATEGORY: Record<TeamInsightCategory, TeamInsightSeverity> = {
  data_incomplete: "opportunity",
  capability_gap: "attention",
  plateau: "attention",
  low_adoption: "attention",
  concentration: "opportunity",
  positive_growth: "info",
};

/** A capability's current-period coverage (mirrors mastery.coverageCounts). */
export type CapabilityCoverageInput = {
  capabilitySlug: string;
  mastered: number;
  withState: number;
};

/** A capability's mastered count in the immediately-prior period (from
 * team_capability_history), for movement-based categories. */
export type CapabilityPriorInput = {
  capabilitySlug: string;
  masteredBefore: number;
  representedBefore: number;
};

export type DeriveTeamInsightsInput = {
  /** Current-period per-capability coverage counts (count-only). */
  coverage: readonly CapabilityCoverageInput[];
  /** Prior-period mastered counts, keyed by capability slug. */
  prior: ReadonlyMap<string, CapabilityPriorInput>;
  /** Org member denominator (people.list().length). */
  totalPeople: number;
  /** People with ≥1 capability state row (mastery.personIdsWithState().size). */
  peopleWithState: number;
  /** Connection freshness: total connected vs stale/not-recently-synced. */
  connectedCount: number;
  staleConnectionCount: number;
  /** The MIN_PEOPLE floor (defaults to the segment-naming floor). */
  minPeople?: number;
};

/**
 * Derive the FULL ranked candidate list of manager insights from org
 * aggregates. Deterministic and pure. The reducer excludes dismissed subjects
 * and caps to `MAX_OPEN_INSIGHTS`; this function itself applies MIN_PEOPLE
 * suppression and the fixed ranking. Returns candidates ordered most- to
 * least-prominent.
 */
export function deriveTeamInsights(
  input: DeriveTeamInsightsInput,
): TeamInsightCandidate[] {
  const minPeople = input.minPeople ?? SEGMENT_MIN_PEOPLE_TO_NAME;
  const candidates: TeamInsightCandidate[] = [];

  const push = (
    category: TeamInsightCategory,
    subject: string,
    params: TeamInsightParams,
    magnitude: number,
  ) =>
    candidates.push({
      category,
      severity: SEVERITY_BY_CATEGORY[category],
      subject,
      params,
      magnitude,
    });

  // Per-capability categories — each gated on a cohort ≥ MIN_PEOPLE, so no
  // small-group capability yields an insight (never a suppressed-but-implied
  // one). The bands are mutually exclusive by the mastered count, so a single
  // capability never yields both a gap AND a concentration insight.
  for (const c of input.coverage) {
    if (c.withState < minPeople) continue;
    const prior = input.prior.get(c.capabilitySlug);

    if (c.mastered === 0) {
      // capability_gap: no one has reached mastery yet on an established
      // capability.
      push(
        "capability_gap",
        c.capabilitySlug,
        { capabilitySlug: c.capabilitySlug, mastered: 0, total: c.withState },
        c.withState,
      );
    } else if (
      c.mastered <= CONCENTRATION_CEILING &&
      c.withState - c.mastered >= minPeople
    ) {
      // concentration: expertise EXISTS but sits with only 1–2 people while a
      // MIN_PEOPLE-sized group is still developing — knowledge-concentration
      // risk (never resolved to names).
      push(
        "concentration",
        c.capabilitySlug,
        {
          capabilitySlug: c.capabilitySlug,
          mastered: c.mastered,
          total: c.withState,
        },
        c.withState - c.mastered,
      );
    }

    // Movement categories need a comparable prior period AND an established
    // cohort in BOTH periods (≥ MIN_PEOPLE), so a cohort that only just crossed
    // the floor doesn't fabricate a trend.
    if (prior && prior.representedBefore >= minPeople) {
      if (c.mastered > prior.masteredBefore) {
        // positive_growth: more people reached mastery than last period.
        push(
          "positive_growth",
          c.capabilitySlug,
          {
            capabilitySlug: c.capabilitySlug,
            masteredNow: c.mastered,
            masteredBefore: prior.masteredBefore,
          },
          c.mastered - prior.masteredBefore,
        );
      } else if (c.mastered >= 1 && c.mastered <= prior.masteredBefore) {
        // plateau: established mastery that stalled or slipped (only when there
        // IS mastery, so it never overlaps the mastered==0 capability_gap).
        push(
          "plateau",
          c.capabilitySlug,
          {
            capabilitySlug: c.capabilitySlug,
            masteredNow: c.mastered,
            masteredBefore: prior.masteredBefore,
          },
          prior.masteredBefore - c.mastered,
        );
      }
    }
  }

  // Org-wide categories — gated on totalPeople ≥ MIN_PEOPLE so a tiny org (where
  // an org-wide claim effectively describes named individuals) gets none.
  if (input.totalPeople >= minPeople) {
    // low_adoption: fewer than half the team has started building any AI
    // capability. Count-only.
    if (input.peopleWithState * 2 < input.totalPeople) {
      push(
        "low_adoption",
        "",
        { active: input.peopleWithState, total: input.totalPeople },
        input.totalPeople - input.peopleWithState,
      );
    }
    // data_incomplete: a connected tool hasn't synced recently, so some numbers
    // may be behind. Trust signal — ranked first. Only when there IS at least
    // one live connection to contrast against.
    if (input.staleConnectionCount > 0 && input.connectedCount > 0) {
      push(
        "data_incomplete",
        "",
        { stale: input.staleConnectionCount, connected: input.connectedCount },
        input.staleConnectionCount,
      );
    }
  }

  return rankTeamInsights(candidates);
}

/**
 * Stable, deterministic ranking: fixed category priority, then descending
 * magnitude within a category, then ascending subject slug (a total order — no
 * ties left to insertion order). Exported so the priority-order test targets it
 * directly.
 */
export function rankTeamInsights(
  candidates: readonly TeamInsightCandidate[],
): TeamInsightCandidate[] {
  const rankOf = (c: TeamInsightCategory) => CATEGORY_PRIORITY.indexOf(c);
  return [...candidates].sort(
    (a, b) =>
      rankOf(a.category) - rankOf(b.category) ||
      b.magnitude - a.magnitude ||
      a.subject.localeCompare(b.subject),
  );
}
