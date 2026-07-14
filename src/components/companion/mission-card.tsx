import { Flag } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { MISSION_COPY } from "@/lib/capability-glossary";
import { MissionStartButton } from "./mission-start-button";

/**
 * The missions card (W7-5), self-view only. Opt-in, finish-lined challenges.
 * Each mission renders one of three honest states: not-started (a "Start"
 * button), in-progress ("N of M steps reached" — plain words, NOT a game-style
 * meter), or complete (a grounded celebration). Completion is a MEASURED
 * capability crossing detected server-side; nothing here lets a user mark a step
 * done. NO points/streak/league/badge-collection mechanics (Spec V4 §8.4).
 * Server-safe, pure props. Renders null when there are no missions.
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

export function MissionCard({ missions }: { missions: readonly MissionCardRow[] }) {
  if (missions.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Flag className="size-4 text-primary" aria-hidden="true" />
          {MISSION_COPY.title}
        </CardTitle>
        <CardDescription>{MISSION_COPY.subtitle}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-3">
          {missions.map((m) => (
            <li key={m.slug} className="rounded-lg bg-muted/50 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium">{m.title}</p>
                {m.status === "complete" ? (
                  <Badge variant="secondary" className="font-normal">
                    {MISSION_COPY.doneBadge}
                  </Badge>
                ) : null}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{m.summary}</p>
              {m.status === "complete" ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  {MISSION_COPY.completeLine}
                </p>
              ) : m.status === "in-progress" ? (
                <p className="mt-2 text-xs font-medium text-muted-foreground">
                  {MISSION_COPY.stepProgress(m.stepsReached, m.totalSteps)}
                </p>
              ) : (
                <MissionStartButton missionSlug={m.slug} />
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
