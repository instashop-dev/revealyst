import { Badge } from "@/components/ui/badge";
import { MISSION_COPY } from "@/lib/capability-glossary";
import { MissionStartButton } from "./mission-start-button";

/**
 * One mission's row markup — the SHARED renderer for all three honest states
 * (U1.3 dedup), used by BOTH the Today active-strip (MissionCard) and the Growth
 * board (MissionBoard) so the two can't drift onto near-identical hand-rolled
 * markup. Completion is a MEASURED capability crossing detected server-side;
 * nothing here lets a user check a step off, and there is NO points/streak/
 * league/badge mechanic (Spec V4 §8.4). Server-safe, pure props.
 */
export type MissionCardRow = {
  slug: string;
  title: string;
  summary: string;
  /** "not-started" | "in-progress" | "complete" — derived server-side. */
  status: "not-started" | "in-progress" | "complete";
  /** Steps the person's measured mastery has reached (in-progress only). */
  stepsReached: number;
  totalSteps: number;
};

export type MissionBoardRow = MissionCardRow & {
  /** Completion date (ISO), rendered on the completed timeline only. */
  completedAt?: string | null;
};

/** Plain-English completion date, e.g. "Jul 10, 2026". UTC-pinned (house
 * convention) so a UTC calendar-day ISO string never renders a day early on a
 * west-of-UTC host. Returns null when the row carries no date — never invents
 * one. */
export function completedOn(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return null;
  return when.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function MissionRow({ mission }: { mission: MissionBoardRow }) {
  const on = mission.status === "complete" ? completedOn(mission.completedAt) : null;
  return (
    <li className="rounded-lg bg-muted/50 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium">{mission.title}</p>
        {mission.status === "complete" ? (
          <Badge variant="secondary" className="font-normal">
            {MISSION_COPY.doneBadge}
          </Badge>
        ) : null}
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{mission.summary}</p>
      {mission.status === "complete" ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {on ? `${MISSION_COPY.completedOnLead} ${on}` : MISSION_COPY.completeLine}
        </p>
      ) : mission.status === "in-progress" ? (
        <p className="mt-2 text-xs font-medium text-muted-foreground">
          {MISSION_COPY.stepProgress(mission.stepsReached, mission.totalSteps)}
        </p>
      ) : (
        <MissionStartButton missionSlug={mission.slug} />
      )}
    </li>
  );
}
