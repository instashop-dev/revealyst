import { InviteMemberDialog } from "@/components/invite-member-dialog";
import { RevokeInviteButton } from "@/components/revoke-invite-button";
import { AdminOnlyNotice } from "@/components/settings/admin-only-notice";
import { RemoveMemberDialog } from "@/components/settings/remove-member-dialog";
import { RoleManagementCard } from "@/components/settings/role-management-card";
import { TeamCostVisibilityCard } from "@/components/settings/team-cost-visibility-card";
import { TeamManagementCard } from "@/components/settings/team-management-card";
import { TeamManagersCard } from "@/components/settings/team-managers-card";
import { Badge } from "@/components/ui/badge";
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
import { invitesForOrg, orgMembersList } from "@/db/invites";
import { requireAppContext } from "@/lib/api-context";
import { formatRelativeTime } from "@/lib/format";
import { groupBy } from "@/lib/utils";

export const dynamic = "force-dynamic";

// People & roles tab (U3) — admin-only. Absorbs the retired /members page
// (dashboard-account roster + invites) alongside the team + role cards that
// already lived on the old settings page. For ADMINS nothing from /teams or
// /people is lost: TeamManagementCard carries the create/manage-team dialogs,
// and the pseudonymized person list is folded into role management. For
// MEMBERS this is a deliberate access change (recorded in the U3 PR): the old
// /people and /teams pages were member-readable only as an unretired W5-H
// leftover — people management is an admin surface, and members get the
// in-place admins-only explanation instead.
export default async function SettingsPeoplePage() {
  const ctx = await requireAppContext("/settings/people");
  if (ctx.role !== "admin") {
    return <AdminOnlyNotice />;
  }

  const isPersonal = ctx.org.kind === "personal";

  // One flat Promise.all (depth 1). Team/role reads are skipped for a personal
  // org-of-one (they have no meaning), mirroring the old settings page.
  const [
    members,
    pending,
    teams,
    allMembers,
    peopleRows,
    roleList,
    roleAssignments,
    teamManagers,
  ] = await Promise.all([
    orgMembersList(ctx.db, ctx.org.id),
    invitesForOrg(ctx.db, ctx.org.id).listPending(),
    isPersonal ? Promise.resolve([]) : ctx.scope.teams.list(),
    isPersonal ? Promise.resolve([]) : ctx.scope.teams.allMembers(),
    isPersonal ? Promise.resolve([]) : ctx.scope.people.list(),
    isPersonal ? Promise.resolve([]) : ctx.scope.roles.list(),
    isPersonal ? Promise.resolve([]) : ctx.scope.roles.assignments(),
    isPersonal ? Promise.resolve([]) : ctx.scope.teamManagers.list(),
  ]);

  // Per-team cost-visibility settings (ADR 0045 spend half) — one read per team,
  // AFTER teams resolve (settings.get is keyed by team id). A cold admin page, so
  // the extra round trips are acceptable; an absent row IS the default (OFF).
  const teamCostSettings = await Promise.all(
    teams.map(async (team) => ({
      team,
      settings: await ctx.scope.teamSettings.get(team.id),
    })),
  );

  // §7 gating identical to the frozen personRef shape: names only leave the
  // server when the org's visibility mode permits.
  const showNames = ctx.org.visibilityMode !== "private";
  const membersByTeam = groupBy(allMembers, (m) => m.teamId);
  const teamRows = teams.map((team) => ({
    id: team.id,
    name: team.name,
    memberIds: (membersByTeam.get(team.id) ?? []).map((m) => m.personId),
  }));
  const peopleOptions = peopleRows.map((person) => ({
    id: person.id,
    pseudonym: person.pseudonym,
    displayName: showNames ? (person.displayName ?? null) : null,
  }));
  const roleBySlug = new Map(roleAssignments.map((a) => [a.personId, a.roleSlug]));
  const rolePeople = peopleRows.map((person) => ({
    id: person.id,
    label: showNames ? (person.displayName ?? person.pseudonym) : person.pseudonym,
    roleSlug: roleBySlug.get(person.id) ?? null,
  }));
  const roleOptions = roleList.map((role) => ({
    slug: role.slug,
    label: role.label,
  }));

  // Team managers (D-TCI-3) — managers are AUTH USERS (org members), not §7
  // tracked people, so their name/email is shown to their own workspace (as the
  // Members table above already does). Reuses the `members` roster (no extra
  // person read).
  const managersByTeam = groupBy(teamManagers, (m) => m.teamId);
  const teamManagerRows = teams.map((team) => ({
    id: team.id,
    name: team.name,
    managerUserIds: (managersByTeam.get(team.id) ?? []).map((m) => m.userId),
  }));
  const managerOptions = members.map((member) => ({
    userId: member.userId,
    label: member.name || member.email,
  }));

  // Cost-visibility rows (ADR 0045) — count-only per-team booleans, no per-person
  // data. Same order as the teams list.
  const teamCostRows = teamCostSettings.map(({ team, settings }) => ({
    id: team.id,
    name: team.name,
    managersSeeIndividualCost: settings.managersSeeIndividualCost,
  }));

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div className="flex flex-col gap-1.5">
            <CardTitle>Members</CardTitle>
            <CardDescription>
              Dashboard accounts in this workspace and their roles.
            </CardDescription>
          </div>
          <InviteMemberDialog />
        </CardHeader>
        <CardContent>
          <div className="rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead className="text-right">Joined</TableHead>
                  <TableHead className="text-right">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((member) => (
                  <TableRow key={member.userId}>
                    <TableCell className="font-medium">
                      {member.name || "—"}
                      {member.userId === ctx.user.id ? (
                        <span className="text-muted-foreground"> (you)</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {member.email}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="capitalize">
                        {member.role}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {formatRelativeTime(member.createdAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      {/* Remove another member. Never yourself — that's the
                          switcher's "Leave workspace". The server also refuses
                          the sole admin / workspace owner with a clear message. */}
                      {member.userId !== ctx.user.id ? (
                        <RemoveMemberDialog
                          userId={member.userId}
                          label={member.name || member.email}
                        />
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {pending.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Pending invites</CardTitle>
            <CardDescription>
              Links already created but not yet redeemed. Revocation is
              immediate.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Expires</TableHead>
                    <TableHead className="text-right" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pending.map((invite) => (
                    <TableRow key={invite.id}>
                      <TableCell className="font-medium">{invite.email}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize">
                          {invite.role}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {invite.expiresAt.toISOString().slice(0, 10)}
                      </TableCell>
                      <TableCell className="text-right">
                        <RevokeInviteButton
                          inviteId={invite.id}
                          email={invite.email}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Team + role management (team orgs only — an org-of-one has no roster).
       * TeamManagementCard carries the create/manage-team dialogs that used to
       * live on the retired /teams page, so nothing is lost in the redirect. */}
      {!isPersonal && (
        <TeamManagementCard teams={teamRows} people={peopleOptions} isAdmin />
      )}
      {!isPersonal && (
        <RoleManagementCard people={rolePeople} roles={roleOptions} />
      )}
      {!isPersonal && (
        <TeamManagersCard teams={teamManagerRows} members={managerOptions} />
      )}
      {!isPersonal && <TeamCostVisibilityCard teams={teamCostRows} />}
    </div>
  );
}
