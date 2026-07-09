import { FileClock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatRelativeTime } from "@/lib/format";

/**
 * Serialized shape of `AdminAuditRow` (src/db/admin.ts) — `createdAt` as an
 * ISO string rather than a `Date`, so one row type crosses the server page
 * -> client audit-load-more boundary (and the /api/admin/audit JSON
 * response) without a Date-serialization question mark.
 */
export type SerializedAuditRow = {
  id: string;
  orgId: string;
  orgName: string | null;
  actorUserId: string | null;
  actorEmail: string | null;
  action: string;
  targetKind: string | null;
  targetId: string | null;
  metadata: unknown;
  createdAt: string;
};

/**
 * Renders `metadata` as inert, escaped text only — never
 * dangerouslySetInnerHTML, never eval. ADR 0010 already keeps metadata free
 * of secrets/payloads, but this stays defensive regardless of what a future
 * write path puts in the column.
 */
function MetadataCell({ metadata }: { metadata: unknown }) {
  const isEmptyObject =
    typeof metadata === "object" &&
    metadata !== null &&
    !Array.isArray(metadata) &&
    Object.keys(metadata as Record<string, unknown>).length === 0;

  if (metadata === null || metadata === undefined || isEmptyObject) {
    return <span className="text-muted-foreground">—</span>;
  }

  return (
    <pre className="max-w-sm overflow-x-auto whitespace-pre-wrap break-words text-xs text-muted-foreground">
      {JSON.stringify(metadata, null, 2)}
    </pre>
  );
}

export function AuditTable({ rows }: { rows: SerializedAuditRow[] }) {
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={FileClock}
        title="No audit entries"
        description="No admin-audited actions have been recorded yet, or none match the current filters."
      />
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>When</TableHead>
          <TableHead>Action</TableHead>
          <TableHead>Actor</TableHead>
          <TableHead>Org</TableHead>
          <TableHead>Target</TableHead>
          <TableHead>Metadata</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell
              className="text-muted-foreground"
              title={new Date(row.createdAt).toLocaleString()}
            >
              {formatRelativeTime(row.createdAt)}
            </TableCell>
            <TableCell>
              <Badge variant="outline">{row.action}</Badge>
            </TableCell>
            <TableCell className="text-muted-foreground">
              {row.actorEmail ?? "—"}
            </TableCell>
            <TableCell className="font-medium">{row.orgName ?? "—"}</TableCell>
            <TableCell className="text-muted-foreground">
              {row.targetKind ?? "—"}
              {row.targetId ? `:${row.targetId}` : ""}
            </TableCell>
            <TableCell className="whitespace-normal">
              <MetadataCell metadata={row.metadata} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
