import { and, eq, gte, inArray, lte } from "drizzle-orm";
import type { Db } from "../client";
import { identities, metricRecords, people, teamMembers } from "../schema";

// P3-B manager per-person SPEND read (ADR 0045, spend half — the D-TCI-2
// founder-signed reversal, behind the per-team admin toggle). ORG-SCOPED. The
// "spend equivalent" of `mastery.forManagedPerson`: a manager reads one managed-
// team member's spend, aggregated to the person, derived from `metric_records`
// spend facts. A DEDICATED namespace (not folded into `metrics`, whose concern is
// ingestion + the frozen records reader) because this surface couples three
// concerns the metrics namespace deliberately does not — team membership
// (authorization), identity resolution (person → subjects), and the §6.1
// exclusive-subject honesty rule — into one purpose-built read that mirrors
// mastery.forManagedPerson.
//
// AUTHORIZATION, fail-closed, enforced HERE (the caller/loader adds the visibility
// mode + the toggle policy on top):
//   1. `managedTeamIds` are the SIGNED-IN caller's OWN managed teams (ADR 0044,
//      resolved from `teamManagers.managedTeamIds(callerUserId)`, never a caller-
//      supplied list). The person must be a member of one of them, else the read
//      is `{ managed: false }` — indistinguishable from a missing person.
//   2. `costVisibleTeamIds` is the subset of the caller's managed teams whose
//      admin toggle `managersSeeIndividualCost` is ON (computed by the loader
//      from `teamSettings`). Spend is returned ONLY when the person is a member of
//      one of THOSE teams — the RESTRICTIVE multi-team reading (ADR 0045 §"Consent
//      / visibility machinery": the toggle must be on for the managed team through
//      which access is derived). A person on two managed teams with the toggle on
//      for only one is still cost-visible (access legitimately derives through the
//      toggle-on grant); a person whose only managed team has the toggle off is
//      `{ managed: true, costVisible: false }` → the drill-in shows capability but
//      no spend (absent, never a teaser).
//
// HONESTY (invariant b, §6.1 — the same rule the scoring engine's per-person path
// uses in recompute.ts `loadPersonSubjects`): a person's spend is summed ONLY over
// their EXCLUSIVE subjects (linked to exactly one person). A SHARED account's spend
// is NEVER redistributed to an individual — it is DISCLOSED as a coverage count
// (how many shared subjects the person is linked to, and how many carried spend in
// the window), never a fabricated per-person split. Vendor-reported (`spend_cents`)
// and derived (`spend_cents_estimated`) are kept in SEPARATE fields and never
// summed (they can overlap — see spend-governance.ts). Per-MODEL data is TOKEN
// volume only (raw rows returned for the loader to summarize), never a dollar split.

/** Raw per-person spend facts, pre-summed to the person over their exclusive
 * subjects. Reported and estimated are structurally separate — there is NO
 * blended-cents field by construction (invariant b). */
export type ManagedPersonSpendFacts = {
  /** Vendor-reported spend (`spend_cents`), month-to-date and prior full month. */
  reported: { mtdCents: number; priorCents: number };
  /** Derived/estimated spend (`spend_cents_estimated`), kept separate — NEVER
   * summed with reported (they can double-count). */
  estimated: { mtdCents: number; priorCents: number };
  /** Per-model TOKEN volume rows (month-to-date, exclusive subjects) — `dim` is
   * "model=<id>", `value` is token count. TOKEN volume, NOT a dollar split; the
   * loader summarizes these with the shared `summarizeModelVolume` honesty helper. */
  modelTokenRows: { dim: string; value: number }[];
  /** Allocation-confidence disclosure, as honest COUNTS (never a fabricated
   * percentage): how the person's linked subjects split into attributable vs
   * shared, and how much shared-but-unattributed spend exists. */
  coverage: {
    /** Exclusive subjects (owned by exactly this person) whose spend IS summed
     * into the figures above. */
    attributableSubjectCount: number;
    /** Subjects this person is linked to that are SHARED with others — their
     * spend is deliberately excluded from the person's figure (§6.1). */
    sharedSubjectCount: number;
    /** How many of those shared subjects actually carried spend in the observed
     * window — so a manager knows unshown, unattributable spend exists rather
     * than assuming the person's number is the whole picture. */
    sharedSubjectsWithSpendCount: number;
  };
};

/** Discriminated result of the manager spend read. `managed: false` collapses
 * "person not on a managed team", "unknown person", and "caller manages nothing"
 * into one indistinguishable outcome (never confirms existence). */
export type ManagedPersonSpendRead =
  | { managed: false }
  | { managed: true; costVisible: false }
  | {
      managed: true;
      costVisible: true;
      person: { id: string; displayName: string | null; pseudonym: string };
      facts: ManagedPersonSpendFacts;
    };

const SPEND_METRIC_KEYS = ["spend_cents", "spend_cents_estimated"] as const;

export function memberSpendNamespace(db: Db, orgId: string) {
  return {
    /**
     * One managed-team member's spend (ADR 0045 spend half). See the module doc
     * for the full authorization + honesty contract. Cold drill-in path (never a
     * hot path): a handful of small round trips, query count independent of how
     * much spend the person has.
     *
     * @param personId          the person being read
     * @param managedTeamIds    the caller's OWN managed teams (ADR 0044)
     * @param costVisibleTeamIds the subset of managedTeamIds whose toggle is ON
     * @param windows           the MTD + prior-month day windows (caller-derived
     *                          from `today` via spend-governance, so the read is
     *                          deterministic and testable)
     */
    async forManagedPerson(
      personId: string,
      managedTeamIds: readonly string[],
      costVisibleTeamIds: readonly string[],
      windows: {
        mtd: { from: string; to: string };
        prior: { from: string; to: string };
      },
    ): Promise<ManagedPersonSpendRead> {
      if (managedTeamIds.length === 0) return { managed: false };

      // (1) Authorize + resolve identity in one query: the person's memberships
      // that fall inside the caller's managed set, joined to their person row.
      const memberships = await db
        .select({
          teamId: teamMembers.teamId,
          id: people.id,
          displayName: people.displayName,
          pseudonym: people.pseudonym,
        })
        .from(teamMembers)
        .innerJoin(
          people,
          and(
            eq(people.orgId, teamMembers.orgId),
            eq(people.id, teamMembers.personId),
          ),
        )
        .where(
          and(
            eq(teamMembers.orgId, orgId),
            eq(teamMembers.personId, personId),
            inArray(teamMembers.teamId, [...managedTeamIds]),
          ),
        );
      if (memberships.length === 0) return { managed: false };

      const person = {
        id: memberships[0].id,
        displayName: memberships[0].displayName,
        pseudonym: memberships[0].pseudonym,
      };
      const costVisibleSet = new Set(costVisibleTeamIds);
      const costVisible = memberships.some((m) => costVisibleSet.has(m.teamId));
      if (!costVisible) return { managed: true, costVisible: false };

      // (2) The person's linked subjects.
      const linkRows = await db
        .select({ subjectId: identities.subjectId })
        .from(identities)
        .where(
          and(eq(identities.orgId, orgId), eq(identities.personId, personId)),
        );
      const linkedSubjectIds = [...new Set(linkRows.map((r) => r.subjectId))];

      const empty: ManagedPersonSpendFacts = {
        reported: { mtdCents: 0, priorCents: 0 },
        estimated: { mtdCents: 0, priorCents: 0 },
        modelTokenRows: [],
        coverage: {
          attributableSubjectCount: 0,
          sharedSubjectCount: 0,
          sharedSubjectsWithSpendCount: 0,
        },
      };
      if (linkedSubjectIds.length === 0) {
        return { managed: true, costVisible: true, person, facts: empty };
      }

      // (3) Owners per subject → split exclusive vs shared (§6.1). A subject
      // owned by exactly one person is attributable; >1 owner is a shared
      // account whose spend must never be credited to an individual.
      const ownerRows = await db
        .select({
          subjectId: identities.subjectId,
          personId: identities.personId,
        })
        .from(identities)
        .where(
          and(
            eq(identities.orgId, orgId),
            inArray(identities.subjectId, linkedSubjectIds),
          ),
        );
      const ownersBySubject = new Map<string, Set<string>>();
      for (const r of ownerRows) {
        const set = ownersBySubject.get(r.subjectId) ?? new Set<string>();
        set.add(r.personId);
        ownersBySubject.set(r.subjectId, set);
      }
      const exclusiveSet = new Set(
        linkedSubjectIds.filter(
          (s) => (ownersBySubject.get(s)?.size ?? 1) <= 1,
        ),
      );
      const sharedSet = new Set(
        linkedSubjectIds.filter((s) => (ownersBySubject.get(s)?.size ?? 1) > 1),
      );

      // (4) Spend + token rows for ALL linked subjects across the contiguous
      // [prior.from, mtd.to] range, then classify in JS. One query.
      const rows = await db
        .select({
          subjectId: metricRecords.subjectId,
          metricKey: metricRecords.metricKey,
          day: metricRecords.day,
          dim: metricRecords.dim,
          value: metricRecords.value,
        })
        .from(metricRecords)
        .where(
          and(
            eq(metricRecords.orgId, orgId),
            inArray(metricRecords.subjectId, linkedSubjectIds),
            inArray(metricRecords.metricKey, [
              ...SPEND_METRIC_KEYS,
              "model_tokens",
            ]),
            gte(metricRecords.day, windows.prior.from),
            lte(metricRecords.day, windows.mtd.to),
          ),
        );

      const inMtd = (day: string) =>
        day >= windows.mtd.from && day <= windows.mtd.to;
      const inPrior = (day: string) =>
        day >= windows.prior.from && day <= windows.prior.to;

      const facts: ManagedPersonSpendFacts = {
        reported: { mtdCents: 0, priorCents: 0 },
        estimated: { mtdCents: 0, priorCents: 0 },
        modelTokenRows: [],
        coverage: {
          attributableSubjectCount: exclusiveSet.size,
          sharedSubjectCount: sharedSet.size,
          sharedSubjectsWithSpendCount: 0,
        },
      };
      const sharedWithSpend = new Set<string>();

      for (const row of rows) {
        const isExclusive = exclusiveSet.has(row.subjectId);
        const isShared = sharedSet.has(row.subjectId);
        if (row.metricKey === "spend_cents" || row.metricKey === "spend_cents_estimated") {
          // A shared subject's spend is NEVER attributed — only disclosed.
          if (isShared) {
            sharedWithSpend.add(row.subjectId);
            continue;
          }
          if (!isExclusive) continue;
          const bucket =
            row.metricKey === "spend_cents" ? facts.reported : facts.estimated;
          if (inMtd(row.day)) bucket.mtdCents += row.value;
          else if (inPrior(row.day)) bucket.priorCents += row.value;
        } else if (row.metricKey === "model_tokens") {
          // Model TOKEN volume: exclusive subjects, month-to-date only.
          if (isExclusive && inMtd(row.day)) {
            facts.modelTokenRows.push({ dim: row.dim, value: row.value });
          }
        }
      }
      facts.coverage.sharedSubjectsWithSpendCount = sharedWithSpend.size;

      return { managed: true, costVisible: true, person, facts };
    },
  };
}
