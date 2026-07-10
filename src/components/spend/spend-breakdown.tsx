import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCents } from "@/lib/format";
import type { ModelVolume, ToolSpend } from "@/lib/spend-governance";

// Spend drill-down (W4-V). Two panels, both honesty-labeled (invariant b):
//  - By tool: vendor-reported (spend_cents) and derived/estimated
//    (spend_cents_estimated) shown in SEPARATE columns, never blended.
//  - By model: token volume only. No connected vendor reports per-model spend
//    today, so this is explicitly a token-volume mix, not a dollar split, with
//    the gap stated in copy rather than filled by an estimate.

const tokenFmt = new Intl.NumberFormat("en-US", { notation: "compact" });

export function SpendByTool({
  byTool,
  reportedCents,
  estimatedCents,
}: {
  byTool: ToolSpend[];
  reportedCents: number;
  estimatedCents: number;
}) {
  if (byTool.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No spend recorded this month yet. Numbers appear here once a connected
        tool reports cost.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Tool</TableHead>
            <TableHead className="text-right">Vendor-reported</TableHead>
            <TableHead className="text-right">Derived / estimated</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {byTool.map((row) => (
            <TableRow key={row.connectionId}>
              <TableCell>
                <span className="font-medium">{row.displayName}</span>
                <span className="text-muted-foreground"> · {row.vendorLabel}</span>
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {row.reportedCents > 0 ? formatCents(row.reportedCents) : "—"}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {row.estimatedCents > 0 ? (
                  <span className="text-muted-foreground">
                    {formatCents(row.estimatedCents)}
                  </span>
                ) : (
                  "—"
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell>Total</TableCell>
            <TableCell className="text-right tabular-nums">
              {formatCents(reportedCents)}
            </TableCell>
            <TableCell className="text-right tabular-nums text-muted-foreground">
              {formatCents(estimatedCents)}
            </TableCell>
          </TableRow>
        </TableFooter>
      </Table>
      <p className="text-xs text-muted-foreground">
        <span className="font-medium">Vendor-reported</span> cost comes straight
        from a vendor&apos;s billing/cost API.{" "}
        <span className="font-medium">Derived / estimated</span> cost is computed
        (e.g. tokens × price list, or a vendor per-user estimate) and is never
        presented as billing truth.
      </p>
    </div>
  );
}

export function SpendByModel({ byModel }: { byModel: ModelVolume[] }) {
  if (byModel.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No per-model data this month yet. Model mix appears here once a connected
        tool reports usage by model.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Badge variant="outline">Token volume</Badge>
        <span className="text-xs text-muted-foreground">
          Vendor-reported usage — not a cost split
        </span>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Model</TableHead>
            <TableHead className="text-right">Tokens</TableHead>
            <TableHead className="text-right">Share</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {byModel.map((row) => (
            <TableRow key={row.model}>
              <TableCell className="font-medium">{row.model}</TableCell>
              <TableCell className="text-right tabular-nums">
                {tokenFmt.format(row.tokens)}
              </TableCell>
              <TableCell className="text-right tabular-nums text-muted-foreground">
                {row.sharePct.toFixed(1)}%
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="text-xs text-muted-foreground">
        Per-model spend isn&apos;t reported by any connected vendor today, so
        this breakdown is by token volume, not dollars — we surface the gap
        rather than estimate a per-model cost.
      </p>
    </div>
  );
}
