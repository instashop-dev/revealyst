import type { Db } from "@/db/client";
import { forOrg } from "@/db/org-scope";
import { resolveShareToken } from "@/db/share-links";
import { periodFor } from "@/scoring";

// Resolves a public share token to exactly what the card renders (ADR 0008):
// the user-chosen public label + the featured score's current-month value.
// The token is the capability; we read ONLY that person's featured score via
// forOrg(the token's org) — never org-wide data. Shared by the public page
// and its OG image so both render identical numbers.

const SLUG_LABELS: Record<string, string> = {
  adoption: "AI Adoption",
  fluency: "AI Fluency",
  efficiency: "AI Efficiency",
};

export type ShareCard = {
  publicLabel: string;
  scoreSlug: string;
  scoreLabel: string;
  /** 0..100, or null when the featured score isn't computed yet. */
  value: number | null;
};

export async function resolveShareCard(
  db: Db,
  token: string,
): Promise<ShareCard | null> {
  const link = await resolveShareToken(db, token);
  if (!link) {
    return null;
  }
  const period = periodFor("month", new Date().toISOString().slice(0, 10));
  const scope = forOrg(db, link.orgId);
  const [defs, results] = await Promise.all([
    scope.scores.definitions(),
    scope.scores.results({
      from: period.periodStart,
      to: period.periodEnd,
      subjectLevel: "person",
    }),
  ]);
  // Map this slug's definition ids → version, then pick the HIGHEST-version
  // scored row deterministically. Today only v1 exists, but once W2-I mints a
  // v2 for the same slug, "first match" would be nondeterministic.
  const versionByDefId = new Map(
    defs
      .filter((d) => d.slug === link.scoreSlug)
      .map((d) => [d.id, d.version] as const),
  );
  const result = results
    .filter(
      (r) =>
        r.personId === link.personId &&
        r.periodGrain === "month" &&
        versionByDefId.has(r.definitionId),
    )
    .sort(
      (a, b) =>
        (versionByDefId.get(b.definitionId) ?? 0) -
        (versionByDefId.get(a.definitionId) ?? 0),
    )[0];
  return {
    publicLabel: link.publicLabel,
    scoreSlug: link.scoreSlug,
    scoreLabel: SLUG_LABELS[link.scoreSlug] ?? link.scoreSlug,
    value: result ? Math.round(result.value) : null,
  };
}
