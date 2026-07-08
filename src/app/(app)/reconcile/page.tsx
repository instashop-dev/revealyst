import Link from "next/link";
import { redirect } from "next/navigation";
import { BookOpen, TriangleAlert, UsersRound } from "lucide-react";
import { ReconcileSubjectDialog } from "@/components/reconcile-subject-dialog";
import { UnlinkIdentityButton } from "@/components/unlink-identity-button";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { requireAppContext } from "@/lib/api-context";
import { buildReconcileView, type SubjectResolution } from "@/lib/reconcile";
import type { SharedAccountReason } from "@/lib/shared-account/heuristics";

export const dynamic = "force-dynamic";

const REASON_LABELS: Record<SharedAccountReason, string> = {
  round_the_clock: "Round-the-clock activity",
  concurrent_usage: "Concurrent sessions",
  volume_exceeds_team_median: "Volume ≫ team median",
};

const CONFIDENCE_VARIANT = {
  high: "destructive",
  medium: "default",
  low: "secondary",
} as const;

function subjectLabel(s: SubjectResolution): string {
  return s.displayName ?? s.email ?? s.externalId;
}

function utcDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export default async function ReconcilePage() {
  const ctx = await requireAppContext();
  // Reconciliation is workspace administration — admin-only, like Members.
  if (ctx.role !== "admin") {
    redirect("/dashboard");
  }

  const view = await buildReconcileView(ctx.scope, {
    from: utcDaysAgo(180),
    to: utcDaysAgo(0),
  });
  const showNames = ctx.org.visibilityMode !== "private";
  const flagged = [...view.unresolved, ...view.resolved].filter((s) => s.flag);

  const personLabel = (p: { pseudonym: string; displayName: string | null }) =>
    showNames && p.displayName ? `${p.pseudonym} · ${p.displayName}` : p.pseudonym;

  return (
    <>
      <PageHeader
        title="Reconcile identities"
        description="Map vendor accounts to real people. Unmatched accounts stay at key/account level — adoption is never inflated by fabricating people."
      >
        {view.flaggedCount > 0 ? (
          <Badge variant="outline">
            {view.flaggedCount} shared-account{" "}
            {view.flaggedCount === 1 ? "signal" : "signals"}
          </Badge>
        ) : null}
      </PageHeader>

      {flagged.length > 0 ? (
        <Card className="mb-6 border-amber-500/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <TriangleAlert className="size-4 text-amber-500" />
              Shared-account signals
            </CardTitle>
            <CardDescription>
              Usage patterns suggest these accounts are shared by several people
              — adoption is likely undercounted. Issue per-user access to see the
              real picture.
            </CardDescription>
            <Button
              variant="outline"
              size="sm"
              className="mt-2 w-fit"
              nativeButton={false}
              render={<Link href="/playbook" />}
            >
              <BookOpen data-icon="inline-start" />
              Read the visibility playbook
            </Button>
          </CardHeader>
          <CardContent>
            <div className="rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Account</TableHead>
                    <TableHead>Tool</TableHead>
                    <TableHead>Confidence</TableHead>
                    <TableHead>Signals</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {flagged.map((s) => (
                    <TableRow key={s.subjectId}>
                      <TableCell className="font-medium">
                        {subjectLabel(s)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {s.vendor}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            s.flag ? CONFIDENCE_VARIANT[s.flag.confidence] : "secondary"
                          }
                          className="capitalize"
                        >
                          {s.flag?.confidence}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {s.flag?.reasons.map((r) => REASON_LABELS[r]).join(" · ")}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold text-muted-foreground">
          Needs reconciliation ({view.unresolved.length})
        </h2>
        {view.unresolved.length === 0 ? (
          <EmptyState
            icon={UsersRound}
            title="Everything is resolved"
            description="Every discovered vendor account is mapped to a person, or is a key/account subject that stays unresolved by design."
          />
        ) : (
          <div className="rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Account</TableHead>
                  <TableHead>Tool</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead>Activity</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {view.unresolved.map((s) => (
                  <TableRow key={s.subjectId}>
                    <TableCell className="font-medium">
                      {subjectLabel(s)}
                      {s.flag ? (
                        <Badge variant="outline" className="ml-2">
                          shared?
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {s.vendor}
                    </TableCell>
                    <TableCell className="text-muted-foreground capitalize">
                      {s.kind.replace(/_/g, " ")}
                    </TableCell>
                    <TableCell>
                      {s.hasActivity ? (
                        <Badge variant="default">Has data</Badge>
                      ) : (
                        <span className="text-muted-foreground">No data yet</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <ReconcileSubjectDialog
                        subject={{
                          subjectId: s.subjectId,
                          label: subjectLabel(s),
                          vendor: s.vendor,
                        }}
                        people={view.people}
                        teams={view.teams}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {view.resolved.length > 0 ? (
        <section>
          <h2 className="mb-3 text-sm font-semibold text-muted-foreground">
            Resolved ({view.resolved.length})
          </h2>
          <div className="rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Account</TableHead>
                  <TableHead>Tool</TableHead>
                  <TableHead>Person</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {view.resolved.map((s) => (
                  <TableRow key={s.subjectId}>
                    <TableCell className="font-medium">
                      {subjectLabel(s)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {s.vendor}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {s.persons.map(personLabel).join(", ")}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {s.persons.map((p) => (
                          <UnlinkIdentityButton
                            key={p.id}
                            subjectId={s.subjectId}
                            personId={p.id}
                          />
                        ))}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      ) : null}
    </>
  );
}
