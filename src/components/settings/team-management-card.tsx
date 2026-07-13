import { UsersRound } from "lucide-react";
import { CreateTeamDialog } from "@/components/create-team-dialog";
import { EmptyState } from "@/components/empty-state";
import { ManageTeamMembersDialog } from "@/components/manage-team-members-dialog";
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

/** A person option for the manage-members picker — §7-gated upstream (real
 * names only when visibility permits). */
export type TeamPersonOption = {
  id: string;
  pseudonym: string;
  displayName: string | null;
};

export type TeamManagementRow = {
  id: string;
  name: string;
  memberIds: string[];
};

/**
 * W5-H deliverable 2: the team roster + its create/manage dialogs, RELOCATED
 * out of the retired `/teams` nav page into Settings. Server component — the
 * caller (settings page) supplies the already-fetched, §7-gated rows so this
 * adds no data-access logic of its own.
 */
export function TeamManagementCard({
  teams,
  people,
  isAdmin,
}: {
  teams: TeamManagementRow[];
  people: TeamPersonOption[];
  isAdmin: boolean;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <CardTitle>People &amp; teams</CardTitle>
          <CardDescription>
            Group tracked people into teams — scores and dashboards aggregate at
            team level by default. Moved here from the top nav.
          </CardDescription>
        </div>
        {isAdmin ? <CreateTeamDialog /> : null}
      </CardHeader>
      <CardContent>
        {teams.length === 0 ? (
          <EmptyState
            icon={UsersRound}
            title="No teams yet"
            description="Create a team to group tracked people for team-level scores."
          >
            {isAdmin ? <CreateTeamDialog /> : null}
          </EmptyState>
        ) : (
          <div className="rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Team</TableHead>
                  <TableHead className="text-right">Members</TableHead>
                  {isAdmin ? <TableHead className="w-40" /> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {teams.map((team) => (
                  <TableRow key={team.id}>
                    <TableCell className="font-medium">{team.name}</TableCell>
                    <TableCell className="text-right">
                      {team.memberIds.length}
                    </TableCell>
                    {isAdmin ? (
                      <TableCell className="text-right">
                        <ManageTeamMembersDialog
                          teamId={team.id}
                          teamName={team.name}
                          memberIds={team.memberIds}
                          people={people}
                        />
                      </TableCell>
                    ) : null}
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
