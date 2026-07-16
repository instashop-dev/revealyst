import { Info, Wallet } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { TeamCostVisibilityControl } from "@/components/settings/team-cost-visibility-control";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TEAM_COST_VISIBILITY_SETTINGS_COPY as COPY } from "@/lib/manager-capability-copy";

export type TeamCostVisibilityRow = {
  id: string;
  name: string;
  /** Whether this team's managers may currently see individual costs. */
  managersSeeIndividualCost: boolean;
};

/**
 * ADR 0045 spend half (D-TCI-2): the admin control that turns per-person cost
 * visibility ON for a team's managers. A SIBLING card to Team managers (a
 * privacy-sensitive reversal gets its own clearly-labeled section rather than a
 * cramped extra column). Server component — the caller (settings page) supplies
 * the already-fetched per-team settings, so this adds no data access of its own.
 * Admin-only (the whole People tab is). Default OFF.
 */
export function TeamCostVisibilityCard({
  teams,
}: {
  teams: TeamCostVisibilityRow[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{COPY.title}</CardTitle>
        <CardDescription>{COPY.description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {teams.length === 0 ? (
          <EmptyState icon={Wallet} title="No teams yet" description={COPY.empty} />
        ) : (
          <>
            <div className="rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Team</TableHead>
                    <TableHead className="text-right">
                      {COPY.columnLabel}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {teams.map((team) => (
                    <TableRow key={team.id}>
                      <TableCell className="font-medium">{team.name}</TableCell>
                      <TableCell className="text-right">
                        <TeamCostVisibilityControl
                          teamId={team.id}
                          teamName={team.name}
                          initialEnabled={team.managersSeeIndividualCost}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <p className="flex items-start gap-2 text-xs text-muted-foreground">
              <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              <span>{COPY.note}</span>
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
