import type { ScoreComponent } from "../contracts/scores";
import type { forOrg } from "../db/org-scope";
import { evaluateDefinition, type EvaluationResult } from "./evaluate";
import type { Period } from "./periods";
import {
  loadPersonSubjects,
  loadRowsByMetric,
  rowsForSubjects,
  type ParsedDefinition,
} from "./recompute";

// W4-U preview: evaluates a DRAFT custom definition against the org's own
// recent metric rows, READ-ONLY (no score_results written). It runs through
// the exact same subject-resolution + `evaluateDefinition` path the nightly
// recompute uses (imported from recompute.ts, not reimplemented) so a preview
// number can never disagree with what a publish would compute — and the
// engine's honesty rules come along for free: a ratio component with data on
// only one side is OMITTED (never floored to 0), and a subject set with no
// signal at all yields no entry rather than a fabricated zero.

type ScopedRepo = ReturnType<typeof forOrg>;

export type PreviewEntry = {
  /** Stable key: "org" for the org-level entry, or the team id. */
  key: string;
  /** Display label: "Whole organization" or the team name. */
  label: string;
  teamId: string | null;
  result: EvaluationResult;
};

export type DefinitionPreview = {
  subjectLevel: "team" | "org";
  /** One entry per subject that produced a score. Empty when no subject in
   * the window had any signal for the definition's components — the caller
   * renders that as "no recent data", never as a zero score. */
  entries: PreviewEntry[];
};

/**
 * Evaluates a draft definition for its declared subject level over a period,
 * without persisting anything. Org-level yields at most one entry (the whole
 * org); team-level yields one entry per team that had data.
 */
export async function previewDefinition(
  scoped: ScopedRepo,
  def: { subjectLevel: "team" | "org"; components: ScoreComponent[] },
  period: Period,
): Promise<DefinitionPreview> {
  const parsed: ParsedDefinition = {
    id: "preview",
    subjectLevel: def.subjectLevel,
    components: def.components,
  };
  const byMetric = await loadRowsByMetric(scoped, [parsed], period);

  if (def.subjectLevel === "org") {
    const result = evaluateDefinition(
      def.components,
      rowsForSubjects(parsed, byMetric, null),
      period,
    );
    return {
      subjectLevel: "org",
      entries: result
        ? [{ key: "org", label: "Whole organization", teamId: null, result }]
        : [],
    };
  }

  // Team level — resolve each team's subject set exactly as recompute does
  // (a team aggregate unions every linked subject of its members, shared
  // accounts included; that's the frozen oracle semantics).
  const { linked } = await loadPersonSubjects(scoped);
  const entries: PreviewEntry[] = [];
  for (const team of await scoped.teams.list()) {
    const subjectIds = new Set<string>();
    for (const member of await scoped.teams.members(team.id)) {
      for (const subjectId of linked.get(member.personId) ?? []) {
        subjectIds.add(subjectId);
      }
    }
    const result = evaluateDefinition(
      def.components,
      rowsForSubjects(parsed, byMetric, subjectIds),
      period,
    );
    if (result) {
      entries.push({ key: team.id, label: team.name, teamId: team.id, result });
    }
  }
  return { subjectLevel: "team", entries };
}
