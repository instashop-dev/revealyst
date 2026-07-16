import { UserCog } from "lucide-react";
import {
  type ManagerOption,
  TeamManagerControl,
} from "@/components/settings/team-manager-control";
import { EmptyState } from "@/components/empty-state";
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

export type TeamManagersRow = {
  id: string;
  name: string;
  /** User ids that currently manage this team. */
  managerUserIds: string[];
};

/**
 * D-TCI-3 (ADR 0044): choose who manages each team. Server component — the
 * caller (settings page) supplies the already-fetched teams, their current
 * managers, and the workspace-member options, so this adds no data access of
 * its own. Admin-only; managers are org members, not tracked people. Being a
 * manager does not reveal any per-person data yet — it records responsibility
 * and unlocks manager-only team summaries later.
 */
export function TeamManagersCard({
  teams,
  members,
}: {
  teams: TeamManagersRow[];
  members: ManagerOption[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Team managers</CardTitle>
        <CardDescription>
          Choose who manages each team. Managers are workspace members. This
          sets who is responsible for a team — it does not reveal anyone&apos;s
          individual data.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {teams.length === 0 ? (
          <EmptyState
            icon={UserCog}
            title="No teams yet"
            description="Create a team first, then choose who manages it."
          />
        ) : (
          <div className="rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Team</TableHead>
                  <TableHead className="w-72 text-right">Managers</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {teams.map((team) => (
                  <TableRow key={team.id}>
                    <TableCell className="font-medium align-top">
                      {team.name}
                    </TableCell>
                    <TableCell className="text-right">
                      <TeamManagerControl
                        teamId={team.id}
                        teamName={team.name}
                        current={team.managerUserIds}
                        members={members}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
