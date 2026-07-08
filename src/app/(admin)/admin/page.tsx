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
import { platformStats } from "@/db/admin";
import { requireAdminContext } from "@/lib/admin-context";
import { formatRelativeTime } from "@/lib/format";
import { vendorLabel } from "@/lib/vendor-labels";

export const dynamic = "force-dynamic";

function StatCard({
  label,
  value,
  description,
}: {
  label: string;
  value: string | number;
  description?: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="font-heading text-3xl font-semibold tabular-nums">
          {value}
        </CardTitle>
      </CardHeader>
      {description ? (
        <CardContent className="text-sm text-muted-foreground">
          {description}
        </CardContent>
      ) : null}
    </Card>
  );
}

export default async function AdminDashboardPage() {
  const ctx = await requireAdminContext();
  const stats = await platformStats(ctx.db);
  const totalOrgs = Object.values(stats.orgCountsByKind).reduce(
    (a, b) => a + b,
    0,
  );

  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          Platform overview
        </h1>
        <p className="text-sm text-muted-foreground">
          Growth, connector fleet health, and subscription status across every
          org.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Users" value={stats.totalUsers} />
        <StatCard
          label="Orgs"
          value={totalOrgs}
          description={`${stats.orgCountsByKind.personal} personal · ${stats.orgCountsByKind.team} team`}
        />
        <StatCard label="Signups (30d)" value={stats.signupsLast30Days} />
        <StatCard
          label="Connections"
          value={Object.values(stats.connectionsByStatus).reduce(
            (a, b) => a + b,
            0,
          )}
          description={Object.entries(stats.connectionsByStatus)
            .map(([status, count]) => `${count} ${status}`)
            .join(" · ") || "No connections yet"}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Subscriptions</CardTitle>
          <CardDescription>Paddle subscription status rollup.</CardDescription>
        </CardHeader>
        <CardContent>
          {Object.keys(stats.subscriptionsByStatus).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No subscriptions yet.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {Object.entries(stats.subscriptionsByStatus).map(
                ([status, count]) => (
                  <Badge key={status} variant="outline" className="capitalize">
                    {count} {status}
                  </Badge>
                ),
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Recent signups</CardTitle>
            <CardDescription>Newest accounts, platform-wide.</CardDescription>
          </CardHeader>
          {stats.recentSignups.length === 0 ? (
            <CardContent className="text-sm text-muted-foreground">
              No signups yet.
            </CardContent>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead className="text-right">Signed up</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stats.recentSignups.map((signup) => (
                  <TableRow key={signup.id}>
                    <TableCell className="font-medium">
                      {signup.name || "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {signup.email}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {formatRelativeTime(signup.createdAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent connector failures</CardTitle>
            <CardDescription>
              Newest errored connector runs, across all orgs.
            </CardDescription>
          </CardHeader>
          {stats.recentConnectorFailures.length === 0 ? (
            <CardContent className="text-sm text-muted-foreground">
              No connector failures — fleet is healthy.
            </CardContent>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Org</TableHead>
                  <TableHead>Connection</TableHead>
                  <TableHead>Error</TableHead>
                  <TableHead className="text-right">When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stats.recentConnectorFailures.map((failure) => (
                  <TableRow key={failure.id}>
                    <TableCell className="font-medium">
                      {failure.orgName}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {failure.displayName}
                      <span className="text-xs">
                        {" "}
                        · {vendorLabel(failure.vendor)}
                      </span>
                    </TableCell>
                    <TableCell className="max-w-xs truncate text-muted-foreground">
                      {failure.error ?? "—"}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {formatRelativeTime(failure.startedAt)}
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
