"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { AuditTable, type SerializedAuditRow } from "./audit-table";

export type AuditFilters = {
  orgId?: string;
  actorUserId?: string;
  action?: string;
};

// Must match the server page's + route's default/limit so a short page is a
// reliable "no more rows" signal.
const PAGE_SIZE = 50;

function buildQuery(
  filters: AuditFilters,
  cursor: { createdAt: string; id: string },
): string {
  const params = new URLSearchParams();
  if (filters.orgId) params.set("orgId", filters.orgId);
  if (filters.actorUserId) params.set("actorUserId", filters.actorUserId);
  if (filters.action) params.set("action", filters.action);
  params.set("limit", String(PAGE_SIZE));
  params.set("before", cursor.createdAt);
  params.set("beforeId", cursor.id);
  return params.toString();
}

/**
 * Owns the accumulated row list: renders the table (audit-table) and, below
 * it, a "Load more" button that fetches the next page from
 * /api/admin/audit using the last row's (createdAt, id) as an exclusive
 * compound cursor (mirrors org-scope.ts auditLog.list / ADR 0010 paging) and
 * appends. The server page passes the first server-rendered page in as
 * `initialRows` so the first paint needs no client round-trip.
 */
export function AuditLoadMore({
  initialRows,
  filters,
}: {
  initialRows: SerializedAuditRow[];
  filters: AuditFilters;
}) {
  const [rows, setRows] = useState(initialRows);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A short (or empty) page means we've reached the end of the result set.
  const [exhausted, setExhausted] = useState(initialRows.length < PAGE_SIZE);

  async function loadMore() {
    const last = rows[rows.length - 1];
    if (!last) return;
    setBusy(true);
    setError(null);
    try {
      const query = buildQuery(filters, {
        createdAt: last.createdAt,
        id: last.id,
      });
      const res = await fetch(`/api/admin/audit?${query}`);
      let payload: unknown = null;
      try {
        payload = await res.json();
      } catch {
        // no / non-JSON body
      }
      if (!res.ok) {
        const message =
          payload &&
          typeof payload === "object" &&
          typeof (payload as { error?: unknown }).error === "string"
            ? (payload as { error: string }).error
            : `request failed (${res.status})`;
        setError(message);
        return;
      }
      const nextRows = (payload as { rows: SerializedAuditRow[] }).rows;
      setRows((prev) => [...prev, ...nextRows]);
      if (nextRows.length < PAGE_SIZE) {
        setExhausted(true);
      }
    } catch {
      setError("Network error — check your connection and try again");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <AuditTable rows={rows} />
      {!exhausted ? (
        <div className="flex flex-col items-center gap-2">
          <Button variant="outline" disabled={busy} onClick={loadMore}>
            {busy ? <Spinner data-icon="inline-start" /> : null}
            Load more
          </Button>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
