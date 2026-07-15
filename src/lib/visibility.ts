import { personRefSchema } from "../contracts/api";

export type VisibilityMode = "private" | "managed" | "full";

/** A person row as read from the org-scoped repository — only the fields the
 * privacy boundary needs. */
export type PersonLike = {
  id: string;
  pseudonym: string;
  displayName?: string | null;
};

/**
 * §7 privacy, enforced by shape. THE one decision point for turning a stored
 * person into a client-facing ref: the real name survives only when the org's
 * visibility mode permits it; in `private` (the default) every person is
 * team-only pseudonymous. `personRefSchema` is strict, so any extra field
 * (email, auth id) throws here rather than leaking downstream.
 *
 * Behaviour matches the original inline rule in api-impl.ts::listPeople:
 * `private` hides the name; `managed`/`full` pass it through.
 */
export function toPersonRef(person: PersonLike, visibilityMode: VisibilityMode) {
  return personRefSchema.parse({
    id: person.id,
    pseudonym: person.pseudonym,
    displayName:
      visibilityMode === "private" ? null : (person.displayName ?? null),
  });
}

export type PersonRef = ReturnType<typeof toPersonRef>;

/** The structural shape the §7 audit predicate inspects — deliberately NOT
 * an import of the concrete `DashboardView` (so this module stays the one
 * decision point and the E2E harness/tests keep compiling against a minimal
 * shape). Every field named here is identity-bearing and must have a matching
 * {@link TEAM_VISIBLE_IDENTITY_SURFACES} entry (enforced by the completeness
 * tripwire in visibility.test.ts against {@link IDENTITY_BEARING_MANIFEST}). */
export type TeamVisibleView = {
  summary: { scores: readonly { person: PersonRef | null }[] };
  segments: { segments: readonly { members: readonly PersonRef[] }[] };
  sharedAccounts: readonly { externalId: string | null }[];
  /** The team dashboard's needs-attention strip (src/lib/score-insights.ts's
   * `AttentionItem`, computed downstream of `readDashboardView` in the page
   * component — not (yet) a field on the composed `DashboardView`). It carries
   * NO identity-bearing field today: every team-level item is built from
   * org-aggregate inputs (score drops, connector gaps, anomalies, catalog
   * recommendations) with no person attached — `person` is never set. It's
   * registered here anyway, OPTIONAL (so today's real view — which never has
   * this field at all — still satisfies this structurally, keeping T2.1's
   * zero-throw proof intact) so a FUTURE per-person item folded into the team
   * strip (the same `person: PersonRef | null` shape `summary.scores[]`
   * already carries) throws instead of silently leaking a real name. */
  attentionItems?: readonly { person?: PersonRef | null }[];
};

/**
 * One identity-bearing surface of the team-visible dashboard view. `extract`
 * pulls the candidate values; `leak` returns a message when a value would
 * expose a real identity (else `null`). `fields` are the dotted manifest
 * paths this surface covers — the completeness tripwire pins the registry to
 * {@link IDENTITY_BEARING_MANIFEST} through them, so a 4th identity-bearing
 * surface added to the view without a registry entry fails a test instead of
 * passing vacuously (the W5-A generalization of the old hand-written check).
 */
export type IdentitySurface = {
  readonly key: string;
  readonly fields: readonly string[];
  /** Leak messages this surface contributes for the given view. */
  readonly collect: (view: TeamVisibleView) => string[];
};

/** Builds an {@link IdentitySurface} from an extract + per-value leak
 * predicate, keeping the two concerns separate while erasing the value type
 * for the heterogeneous registry. */
function defineSurface<T>(def: {
  key: string;
  fields: readonly string[];
  extract: (view: TeamVisibleView) => readonly T[];
  leak: (value: T) => string | null;
}): IdentitySurface {
  return {
    key: def.key,
    fields: def.fields,
    collect: (view) =>
      def
        .extract(view)
        .map((value) => def.leak(value))
        .filter((message): message is string => message !== null),
  };
}

/**
 * THE registry of identity-bearing, team-visible surfaces. `assertTeamOnly-
 * Pseudonymized` iterates this — adding a surface here (with its manifest
 * `fields`) is the ONLY place the privacy audit grows. Leak messages are
 * preserved verbatim from the original hand-written predicate.
 */
export const TEAM_VISIBLE_IDENTITY_SURFACES: readonly IdentitySurface[] = [
  defineSurface<{ person: PersonRef | null }>({
    key: "summary.scores[].person",
    fields: ["summary.scores[].person.displayName"],
    extract: (view) => view.summary.scores,
    leak: (score) =>
      score.person && score.person.displayName !== null
        ? `score exposes a real name for person ${score.person.id}`
        : null,
  }),
  defineSurface<{ members: readonly PersonRef[] }>({
    key: "segments.segments[].members",
    fields: ["segments.segments[].members"],
    extract: (view) => view.segments.segments,
    leak: (segment) =>
      segment.members.length > 0
        ? `segment surfaces ${segment.members.length} individual member(s)`
        : null,
  }),
  defineSurface<{ externalId: string | null }>({
    key: "sharedAccounts[].externalId",
    fields: ["sharedAccounts[].externalId"],
    extract: (view) => view.sharedAccounts,
    leak: (flag) =>
      flag.externalId !== null
        ? `shared-account flag exposes a real account identifier`
        : null,
  }),
  // T2.1: attention items carry no identity-bearing field today (see
  // TeamVisibleView.attentionItems doc comment) — this surface is a live
  // check over an always-undefined `person`, mirroring segments.ts's
  // always-`[]` `members` (a value that happens to be empty by construction
  // today, checked anyway so a future regression throws instead of leaking).
  // HONEST REACH CAVEAT: the team attention strip is computed by
  // `deriveAttention` in the page component AFTER `readDashboardView`
  // returned (the composed DashboardView has no attentionItems field), so at
  // runtime this check sees `undefined` — the protection is live only in the
  // hand-built-view unit tests until attention items are folded into the
  // view itself (the W10/T5.1 widening is when that must happen; whoever
  // folds them in gets this check for free, which is the point).
  defineSurface<{ person?: PersonRef | null }>({
    key: "attentionItems[].person",
    fields: ["attentionItems[].person.displayName"],
    extract: (view) => view.attentionItems ?? [],
    leak: (item) =>
      item.person && item.person.displayName !== null
        ? `attention item exposes a real name for person ${item.person.id}`
        : null,
  }),
];

/**
 * The authoritative manifest of every identity-bearing field on the
 * team-visible view. This is the SOURCE OF TRUTH the completeness tripwire
 * pins {@link TEAM_VISIBLE_IDENTITY_SURFACES} against: adding an identity-
 * bearing field to `TeamVisibleView` means adding it here AND registering a
 * surface for it, or {@link identityManifestGaps} reports a gap and the test
 * fails (mirrors tests/tenant-isolation.test.ts's SCOPED_READS completeness
 * assertion and src/db/account-deletion.ts's PURGE_TABLES tripwire).
 */
export const IDENTITY_BEARING_MANIFEST: readonly string[] = [
  "summary.scores[].person.displayName",
  "segments.segments[].members",
  "sharedAccounts[].externalId",
  "attentionItems[].person.displayName",
];

/**
 * Completeness check between the manifest and the registry (a pure function
 * so a test can drive it directly, like `missingFromPurgeTables`). `missing`
 * = manifest fields no surface covers (an unregistered identity-bearing
 * surface); `extra` = registered fields absent from the manifest (a stale
 * surface). Both non-empty conditions must fail the tripwire.
 */
export function identityManifestGaps(
  manifest: readonly string[],
  surfaces: readonly Pick<IdentitySurface, "fields">[],
): { missing: string[]; extra: string[] } {
  const covered = new Set(surfaces.flatMap((surface) => surface.fields));
  const declared = new Set(manifest);
  return {
    missing: [...declared].filter((field) => !covered.has(field)),
    extra: [...covered].filter((field) => !declared.has(field)),
  };
}

/**
 * The single audit predicate for the §7 privacy default: a dashboard view is
 * "team-only pseudonymized" iff no registered identity-bearing surface leaks —
 * no surfaced person carries a real name, no individual is listed as a segment
 * member, no shared-account flag carries a real vendor account identifier
 * (often an email — same leak class as a person's name), and no attention item
 * carries a named person. Structural on purpose (no import of DashboardView)
 * so it stays the one decision point — the page renders through the
 * visibility gate, and this asserts the gate held. The surface set is the
 * {@link TEAM_VISIBLE_IDENTITY_SURFACES} registry, so a new identity-bearing
 * surface can no longer pass vacuously (W5-A).
 *
 * T2.1: `readDashboardView` (src/lib/dashboard-view.ts) calls this at runtime
 * — but ONLY when `visibilityMode === "private"`. `managed`/`full` are real,
 * admin-opted-into governance postures (src/lib/visibility-playbook.ts) that
 * deliberately surface real names/account identifiers once an org has done
 * the readiness work; asserting team-only-pseudonymized against THOSE modes
 * would 500 every managed/full org on every request — that's the feature
 * working as designed, not a leak. The predicate audits the one invariant
 * that must always hold for `private` (the EU-safe default, and the
 * precondition the gated Wave-10 companion-in-team work needs proven at
 * runtime, not just in tests).
 *
 * A private-mode view passes; a managed/full view (which deliberately surfaces
 * names/members) throws — that asymmetry is what makes the W2 gate item
 * ("privacy default verified as team-only pseudonymized") a real assertion,
 * imported by W1-S's E2E via tests/harness/seams.ts.
 */
export function assertTeamOnlyPseudonymized(view: TeamVisibleView): void {
  const leaks: string[] = [];
  for (const surface of TEAM_VISIBLE_IDENTITY_SURFACES) {
    leaks.push(...surface.collect(view));
  }
  if (leaks.length > 0) {
    throw new Error(
      `dashboard view is not team-only pseudonymized: ${leaks.join("; ")}`,
    );
  }
}
