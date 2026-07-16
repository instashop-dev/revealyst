import { Flag } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { MISSION_COPY } from "@/lib/capability-glossary";
import { MissionRow, type MissionCardRow } from "./mission-row";

export type { MissionCardRow };

/**
 * The Today active-mission strip (W7-5), self-view only. A compact card frame
 * over the SHARED `MissionRow` renderer — its only caller now passes in-progress
 * missions exclusively (the full catalog + completed timeline live on /growth),
 * but the row handles every honest state (start / N-of-M / complete). Opt-in;
 * completion is a MEASURED capability crossing detected server-side; nothing here
 * lets a user mark a step done. NO points/streak/league/badge mechanics (Spec V4
 * §8.4). Server-safe, pure props. Renders null when there are no missions.
 */
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
            <MissionRow key={m.slug} mission={m} />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
