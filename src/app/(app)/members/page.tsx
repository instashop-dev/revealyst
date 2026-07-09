import { redirect } from "next/navigation";
import { InviteMemberDialog } from "@/components/invite-member-dialog";
import { PageHeader } from "@/components/page-header";
import { RevokeInviteButton } from "@/components/revoke-invite-button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
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

export const dynamic = "force-dynamic";

export default async function MembersPage() {
  const ctx = await requireAppContext();
  // Role gate: members management is admin-only (ADR 0004); the API
  // routes enforce the same rule server-side.
  if (ctx.role !== "admin") {
    redirect("/dashboard");
  }
  const [members, pending] = await Promise.all([
    orgMembersList(ctx.db, ctx.org.id),
    invitesForOrg(ctx.db, ctx.org.id).listPending(),
  ]);

  return (
    <>
      <PageHeader
        title="Members"
        description="Dashboard accounts in this workspace and their roles."
      >
        <InviteMemberDialog />
      </PageHeader>
      <div className="rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Member</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead className="text-right">Joined</TableHead>
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
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {pending.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Pending invites</CardTitle>
            <CardDescription>
              Links already created but not yet redeemed. Revocation is
              immediate.
            </CardDescription>
          </CardHeader>
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
        </Card>
      ) : null}
    </>
  );
}
