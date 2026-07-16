import { Flag } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { MISSION_COPY } from "@/lib/capability-glossary";
import { MissionRow, type MissionBoardRow } from "./mission-row";

export type { MissionBoardRow };

/**
 * The Growth-surface missions board (U1.3), self-view only. The same honest,
 * un-gamified missions as the Today active-strip, but GROUPED so a person can
 * see everything at once: what's in progress, what's available to start, and
 * what they've already completed (with the date). Completion is still a MEASURED
 * capability crossing detected server-side — nothing here lets a user check a
 * step off, and there is NO points/streak/league/badge mechanic (Spec V4 §8.4;
 * the banned-phrasing sweep covers this route's rendered copy). Rows render via
 * the SHARED `MissionRow` renderer. Server-safe, pure props.
 */
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
                  <MissionRow key={m.slug} mission={m} />
                ))}
              </Group>
            ) : null}

            {available.length > 0 ? (
              <Group heading={MISSION_COPY.groups.available}>
                {available.map((m) => (
                  <MissionRow key={m.slug} mission={m} />
                ))}
              </Group>
            ) : null}

            {completed.length > 0 ? (
              <Group heading={MISSION_COPY.groups.completed}>
                {completed.map((m) => (
                  <MissionRow key={m.slug} mission={m} />
                ))}
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
