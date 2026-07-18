import Link from "next/link";
import { redirect } from "next/navigation";
import { BookOpen, TriangleAlert, UsersRound } from "lucide-react";
import { IdentityMatchRow } from "@/components/identity-match-row";
import { ReconcileExplainer } from "@/components/reconcile-explainer";
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
import { SHARED_ACCOUNT_REASON_LABELS as REASON_LABELS } from "@/lib/metrics-glossary";
import {
  buildReconcileView,
  deriveReconcileImpact,
  type SubjectResolution,
} from "@/lib/reconcile";

export const dynamic = "force-dynamic";

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
  const isPersonalOrg = ctx.org.kind === "personal";
  const flagged = [...view.unresolved, ...view.resolved].filter((s) => s.flag);

  const personLabel = (p: { pseudonym: string; displayName: string | null }) =>
    showNames && p.displayName ? `${p.pseudonym} · ${p.displayName}` : p.pseudonym;

  // Counts-only impact of finishing the work (invariant b — never a fabricated
  // percentage). N = unresolved accounts that actually carry activity. When
  // N = 0 we render nothing: the all-matched empty state below already says so,
  // and an "everything is matched" line above an empty list would be redundant.
  const impact = deriveReconcileImpact(view);
  const n = impact.accountsWithData;
  const impactLine =
    n === 0
      ? null
      : `${n} account${n === 1 ? "" : "s"} with recent activity ${
          n === 1 ? "isn't" : "aren't"
        } matched to a person yet. Matching ${
          n === 1 ? "it" : "them"
        } links that usage to the right people, so your numbers are more complete.`;

  // Email-match suggestions, keyed by subject. The evidence line is derived
  // ONLY from these (email equality is the one signal we trust) — a subject
  // with no match shows no evidence rather than an invented one.
  const personById = new Map(view.people.map((p) => [p.id, p]));
  const proposedBySubject = new Map(
    view.proposedMatches.map((m) => {
      const person = personById.get(m.personId);
      return [
        m.subjectId,
        {
          personId: m.personId,
          personLabel: person ? personLabel(person) : "this person",
        },
      ];
    }),
  );

  return (
    <>
      <PageHeader
        title="Match accounts"
        description="Match the accounts your connected tools report to the real people behind them. Accounts we can't match yet are kept as-is — we never invent people to inflate adoption."
      >
        {view.flaggedCount > 0 ? (
          <Badge variant="outline">
            {view.flaggedCount} shared-account{" "}
            {view.flaggedCount === 1 ? "signal" : "signals"}
          </Badge>
        ) : null}
      </PageHeader>

      {impactLine ? (
        <p className="mb-6 text-sm text-muted-foreground">{impactLine}</p>
      ) : null}

      <ReconcileExplainer />

      {flagged.length > 0 ? (
        <Card className="mb-6 border-amber-500/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <TriangleAlert className="size-4 text-amber-500 dark:text-amber-400" />
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
              Open the shared-account migration guide
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
          Needs matching ({view.unresolved.length})
        </h2>
        {view.unresolved.length === 0 ? (
          <EmptyState
            icon={UsersRound}
            title="All accounts are matched"
            description={
              isPersonalOrg
                ? "With one connector and one person, there's nothing to match — new work only appears if you add a shared or team account."
                : "Every discovered vendor account is mapped to a person, or is a key/account subject that stays unresolved by design. New work appears when a connector reports an account we can't tie to a person yet."
            }
          />
        ) : (
          <div className="rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Account</TableHead>
                  <TableHead>Tool</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead>Evidence</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {view.unresolved.map((s) => {
                  const proposed = proposedBySubject.get(s.subjectId) ?? null;
                  // Evidence comes ONLY from an email match — the matched
                  // person's email equals this subject's email, so we show it
                  // straight. No match → no evidence line (never fabricated).
                  const evidence =
                    proposed && s.email ? `Email matches ${s.email}` : null;
                  return (
                    <IdentityMatchRow
                      key={s.subjectId}
                      subject={{
                        subjectId: s.subjectId,
                        label: subjectLabel(s),
                        vendor: s.vendor,
                        kind: s.kind,
                        flagged: s.flag !== null,
                        hasActivity: s.hasActivity,
                      }}
                      evidence={evidence}
                      proposedMatch={proposed}
                      people={view.people}
                      teams={view.teams}
                    />
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {view.resolved.length > 0 ? (
        <section>
          <h2 className="mb-3 text-sm font-semibold text-muted-foreground">
            Matched ({view.resolved.length})
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
