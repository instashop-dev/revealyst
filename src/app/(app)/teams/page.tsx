import { UsersRound } from "lucide-react";
import { CreateTeamDialog } from "@/components/create-team-dialog";
import { EmptyState } from "@/components/empty-state";
import { ManageTeamMembersDialog } from "@/components/manage-team-members-dialog";
import { PageHeader } from "@/components/page-header";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requireAppContext } from "@/lib/api-context";

export const dynamic = "force-dynamic";

export default async function TeamsPage() {
  const ctx = await requireAppContext();
  const isAdmin = ctx.role === "admin";
  const teams = await ctx.scope.teams.list();
  const withMembers = await Promise.all(
    teams.map(async (team) => ({
      ...team,
      memberIds: (await ctx.scope.teams.members(team.id)).map(
        (m) => m.personId,
      ),
    })),
  );
  // Same §7 gating as the frozen personRef shape: names only leave the
  // server when the org's visibility mode permits.
  const showNames = ctx.org.visibilityMode !== "private";
  const people = (await ctx.scope.people.list()).map((person) => ({
    id: person.id,
    pseudonym: person.pseudonym,
    displayName: showNames ? (person.displayName ?? null) : null,
  }));

  return (
    <>
      <PageHeader
        title="Teams"
        description="Group tracked people into teams — scores and dashboards aggregate at team level by default."
      >
        {isAdmin ? <CreateTeamDialog /> : null}
      </PageHeader>
      {withMembers.length === 0 ? (
        <EmptyState
          icon={UsersRound}
          title="No teams yet"
          description={
            ctx.org.kind === "personal"
              ? "Personal workspaces track just you, so teams are optional. Team workspaces group people here for team-level scores."
              : "Create a team to group tracked people for team-level scores."
          }
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
              {withMembers.map((team) => (
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
    </>
  );
}
