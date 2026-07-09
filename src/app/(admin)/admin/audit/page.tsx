import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/page-header";
import { AuditLoadMore } from "@/components/admin/audit-load-more";
import type { SerializedAuditRow } from "@/components/admin/audit-table";
import { platformAuditList } from "@/db/admin";
import { requireAdminContext } from "@/lib/admin-context";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

/** First non-empty value from a Next.js searchParams entry (which may be
 * a single string, an array on repeated keys, or undefined). */
function firstString(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireAdminContext();
  const params = await searchParams;

  const orgId = firstString(params.orgId);
  const actorUserId = firstString(params.actorUserId);
  const action = firstString(params.action);
  const hasFilters = Boolean(orgId || actorUserId || action);

  const rows = await platformAuditList(ctx.db, {
    orgId,
    actorUserId,
    action,
    limit: PAGE_SIZE,
  });

  const initialRows: SerializedAuditRow[] = rows.map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
  }));

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Every admin-audited action across the fleet, newest first."
      />

      <Card>
        <CardContent>
          <form method="get" className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="orgId">Org ID</Label>
              <Input
                id="orgId"
                name="orgId"
                defaultValue={orgId ?? ""}
                placeholder="org uuid"
                className="w-56"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="actorUserId">Actor user ID</Label>
              <Input
                id="actorUserId"
                name="actorUserId"
                defaultValue={actorUserId ?? ""}
                placeholder="user id"
                className="w-56"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="action">Action prefix</Label>
              <Input
                id="action"
                name="action"
                defaultValue={action ?? ""}
                placeholder="e.g. connection."
                className="w-56"
              />
            </div>
            <Button type="submit" variant="outline">
              Filter
            </Button>
            {hasFilters ? (
              <Button
                type="button"
                variant="ghost"
                nativeButton={false}
                render={<Link href="/admin/audit" />}
              >
                Clear
              </Button>
            ) : null}
          </form>
        </CardContent>
      </Card>

      <AuditLoadMore
        initialRows={initialRows}
        filters={{ orgId, actorUserId, action }}
      />
    </>
  );
}
