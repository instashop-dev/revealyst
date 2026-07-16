import { Flag } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { MISSION_COPY } from "@/lib/capability-glossary";
import { MissionStartButton } from "./mission-start-button";
import type { MissionCardRow } from "./mission-card";

/**
 * The Growth-surface missions board (U1.3), self-view only. The same honest,
 * un-gamified missions as the Today active-strip, but GROUPED so a person can
 * see everything at once: what's in progress, what's available to start, and
 * what they've already completed (with the date). Completion is still a MEASURED
 * capability crossing detected server-side — nothing here lets a user check a
 * step off, and there is NO points/streak/league/badge mechanic (Spec V4 §8.4;
 * the banned-phrasing sweep covers this route's rendered copy). Server-safe,
 * pure props.
 */
export type MissionBoardRow = MissionCardRow & {
  /** Completion date (ISO), rendered on the completed timeline only. */
  completedAt?: string | null;
};

function completedOn(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return null;
  return when.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function MissionBoard({ missions }: { missions: readonly MissionBoardRow[] }) {
  const active = missions.filter((m) => m.status === "in-progress");
  const available = missions.filter((m) => m.status === "not-started");
  const completed = missions.filter((m) => m.status === "complete");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Flag className="size-4 text-primary" aria-hidden="true" />
          {MISSION_COPY.title}
        </CardTitle>
        <CardDescription>{MISSION_COPY.subtitle}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {missions.length === 0 ? (
          <EmptyState
            variant="inline"
            title={MISSION_COPY.title}
            description={MISSION_COPY.empty}
          />
        ) : (
          <>
            {active.length > 0 ? (
              <Group heading={MISSION_COPY.groups.active}>
                {active.map((m) => (
                  <li key={m.slug} className="rounded-lg bg-muted/50 p-4">
                    <p className="text-sm font-medium">{m.title}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{m.summary}</p>
                    <p className="mt-2 text-xs font-medium text-muted-foreground">
                      {MISSION_COPY.stepProgress(m.stepsReached, m.totalSteps)}
                    </p>
                  </li>
                ))}
              </Group>
            ) : null}

            {available.length > 0 ? (
              <Group heading={MISSION_COPY.groups.available}>
                {available.map((m) => (
                  <li key={m.slug} className="rounded-lg bg-muted/50 p-4">
                    <p className="text-sm font-medium">{m.title}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{m.summary}</p>
                    <MissionStartButton missionSlug={m.slug} />
                  </li>
                ))}
              </Group>
            ) : null}

            {completed.length > 0 ? (
              <Group heading={MISSION_COPY.groups.completed}>
                {completed.map((m) => {
                  const on = completedOn(m.completedAt);
                  return (
                    <li key={m.slug} className="rounded-lg bg-muted/50 p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium">{m.title}</p>
                        <Badge variant="secondary" className="font-normal">
                          {MISSION_COPY.doneBadge}
                        </Badge>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">{m.summary}</p>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {on
                          ? `${MISSION_COPY.completedOnLead} ${on}`
                          : MISSION_COPY.completeLine}
                      </p>
                    </li>
                  );
                })}
              </Group>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Group({
  heading,
  children,
}: {
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {heading}
      </h3>
      <ul className="flex flex-col gap-3">{children}</ul>
    </section>
  );
}
