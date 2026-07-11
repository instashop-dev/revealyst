import { notFound } from "next/navigation";
import { ImpersonateButton } from "@/components/admin/impersonate-button";
import { UserBanDialog } from "@/components/admin/user-ban-dialog";
import { UserRoleSelect } from "@/components/admin/user-role-select";
import { PageHeader } from "@/components/page-header";
import { SyncStatusBadge } from "@/components/sync-status-badge";
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
import { userDetailForAdmin } from "@/db/admin";
import { requireAdminContext } from "@/lib/admin-context";
import { SYNC_STALE_AFTER_DAYS } from "@/lib/agent-sync";
import { formatRelativeTime } from "@/lib/format";
import { vendorLabel } from "@/lib/vendor-labels";

export const dynamic = "force-dynamic";

// AdminUserDetail.connections[].status is a plain string in the @/db/admin
// contract (it doesn't re-export the connections status enum) — narrow it
// here so SyncStatusBadge's union type is satisfied without editing either
// shared file. Falls back to "pending" for any unrecognized value, which is
// the least alarming default (never claims an error that isn't there).
const SYNC_STATUSES = ["pending", "active", "paused", "error"] as const;
type SyncStatus = (typeof SYNC_STATUSES)[number];
function toSyncStatus(status: string): SyncStatus {
  return (SYNC_STATUSES as readonly string[]).includes(status)
    ? (status as SyncStatus)
    : "pending";
}

export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await requireAdminContext();
  const { id } = await params;
  // env threaded so detail.platformAdmin covers ADMIN_USER_IDS bootstrap
  // admins too — guardDisabled below must agree with the server's
  // hooks.before target guard (ADR 0016), or Impersonate/Ban/Role render
  // enabled against an admin and every click 403s.
  const detail = await userDetailForAdmin(ctx.db, id, ctx.env);
  if (!detail) {
    notFound();
  }

  // Server-side guards already gate the mutations themselves (ADR 0016) —
  // this only reflects that in the UI: never let an admin act on another
  // admin, or on their own account, from this surface.
  const isSelf = detail.id === ctx.user.id;
  const guardDisabled = isSelf || detail.platformAdmin;
  const guardReason = isSelf
    ? "You can't act on your own account here"
    : "This user is a platform admin";

  return (
    <>
      <PageHeader title={detail.name || detail.email} description={detail.email}>
        <ImpersonateButton
          userId={detail.id}
          disabled={guardDisabled}
          disabledReason={guardReason}
        />
        <UserRoleSelect
          userId={detail.id}
          platformAdmin={detail.platformAdmin}
          disabled={guardDisabled}
          disabledReason={guardReason}
        />
        <UserBanDialog
          userId={detail.id}
          userName={detail.name || detail.email}
          banned={detail.banned}
          banReason={detail.banReason}
          disabled={guardDisabled}
          disabledReason={guardReason}
        />
      </PageHeader>

      <div className="flex max-w-3xl flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
            <CardDescription>Account identity and platform status.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div>
              <div className="text-xs text-muted-foreground">Name</div>
              <div>{detail.name || "—"}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Email</div>
              <div>{detail.email}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Signed up</div>
              <div>{formatRelativeTime(detail.createdAt)}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Status</div>
              <div className="flex flex-wrap gap-1">
                {detail.platformAdmin ? (
                  <Badge variant="outline">Platform admin</Badge>
                ) : null}
                {detail.banned ? (
                  <Badge variant="destructive">
                    Banned
                    {detail.banExpires
                      ? ` until ${new Date(detail.banExpires).toLocaleDateString()}`
                      : ""}
                  </Badge>
                ) : null}
                {!detail.platformAdmin && !detail.banned ? (
                  <span className="text-muted-foreground">—</span>
                ) : null}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Memberships</CardTitle>
            <CardDescription>Orgs this user belongs to.</CardDescription>
          </CardHeader>
          {detail.memberships.length === 0 ? (
            <CardContent className="text-sm text-muted-foreground">
              No org memberships.
            </CardContent>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Org</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead className="text-right">Tracked users</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.memberships.map((m) => (
                  <TableRow key={m.orgId}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{m.orgName}</span>
                        <Badge variant="outline" className="capitalize">
                          {m.orgKind}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="capitalize">
                        {m.role}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="capitalize">
                        {m.plan}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {m.trackedUsers}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Connections</CardTitle>
            <CardDescription>
              Vendor status only — never a credential, even to platform admins.
            </CardDescription>
          </CardHeader>
          {detail.connections.length === 0 ? (
            <CardContent className="text-sm text-muted-foreground">
              No connections.
            </CardContent>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.connections.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <span className="font-medium">{c.displayName}</span>
                      <span className="text-xs text-muted-foreground">
                        {" "}
                        · {vendorLabel(c.vendor)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <SyncStatusBadge
                        status={toSyncStatus(c.status)}
                        lastSuccessAt={c.lastSuccessAt}
                        lastError={c.lastError}
                        // Same staleness treatment the user sees on their own
                        // Connections page/dashboard — an admin investigating
                        // freshness must not get a rosier badge (sibling-guard
                        // rule; push-ingest vendor only, polled rows unchanged).
                        staleAfterDays={
                          c.vendor === "claude_code_local"
                            ? SYNC_STALE_AFTER_DAYS
                            : undefined
                        }
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
            <CardDescription>Latest audited actions involving this user.</CardDescription>
          </CardHeader>
          {detail.recentAudit.length === 0 ? (
            <CardContent className="text-sm text-muted-foreground">
              No recorded activity.
            </CardContent>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Action</TableHead>
                  <TableHead>Target</TableHead>
                  <TableHead className="text-right">When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.recentAudit.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="font-medium">{a.action}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {a.targetKind
                        ? `${a.targetKind}${a.targetId ? ` · ${a.targetId}` : ""}`
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {formatRelativeTime(a.createdAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
