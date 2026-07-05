import { UsersRound } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
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
  const teams = await ctx.scope.teams.list();
  const withCounts = await Promise.all(
    teams.map(async (team) => ({
      ...team,
      memberCount: (await ctx.scope.teams.members(team.id)).length,
    })),
  );

  return (
    <>
      <PageHeader
        title="Teams"
        description="Group tracked people into teams — scores and dashboards aggregate at team level by default."
      />
      {withCounts.length === 0 ? (
        <EmptyState
          icon={UsersRound}
          title="No teams yet"
          description={
            ctx.org.kind === "personal"
              ? "Personal workspaces track just you, so teams are optional. Team workspaces group people here for team-level scores."
              : "Create a team to group tracked people for team-level scores. Team creation lands with the members flow."
          }
        />
      ) : (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Team</TableHead>
                <TableHead className="text-right">Members</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {withCounts.map((team) => (
                <TableRow key={team.id}>
                  <TableCell className="font-medium">{team.name}</TableCell>
                  <TableCell className="text-right">
                    {team.memberCount}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}
