import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { ManagerCapabilityProfile } from "@/components/manager/manager-capability-profile";
import {
  ManagerNotesSection,
  type ManagerNoteVM,
} from "@/components/manager/manager-notes-section";
import { ManagerSpendSection } from "@/components/manager/manager-spend-section";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { orgMembersList } from "@/db/invites";
import { requireAppContext } from "@/lib/api-context";
import {
  MANAGER_DRILL_IN_COPY,
  MANAGER_ROSTER_COPY,
} from "@/lib/manager-capability-copy";
import { loadManagerCapabilityDrillIn } from "@/lib/manager-capability-view";
import { loadManagerNotes } from "@/lib/manager-notes-view";
import { loadManagerSpendDrillIn } from "@/lib/manager-spend-view";
import { todayUtc } from "@/lib/spend-governance";
import { timeStage } from "@/lib/request-timing";

export const dynamic = "force-dynamic";

/**
 * Manager per-person capability drill-in (P3-A, ADR 0045). A manager reads one
 * member of a team they manage: capability bands, confidence tiers, evidence
 * counts, recency — and NOTHING else (no recommendations, coaching, or
 * interaction state; those stay self-view-only forever). Every access rule is
 * enforced in `loadManagerCapabilityDrillIn`; the page only maps the outcome:
 *   - `unavailable` (private mode) and `forbidden` (not a manager of this
 *     person's team, incl. an admin without a grant, or a cross-org/unknown
 *     person) BOTH map to notFound() — a 404 never confirms the person exists.
 *   - signed-out → requireAppContext redirects to /sign-in.
 */
export default async function ManagerCapabilityDrillInPage({
  params,
}: {
  params: Promise<{ personId: string }>;
}) {
  const { personId } = await params;
  const ctx = await requireAppContext();
  // Capability drill-in owns the 404 semantics (a person the caller can't manage
  // is notFound). The spend read is loaded alongside it and rendered only when
  // the per-team admin toggle authorizes it (status "ok"); every other status
  // (private mode, not managed, or toggle off) simply omits the section — never
  // a teaser.
  const [result, spendResult, notesResult, members] = await timeStage(
    "pageData",
    () =>
      Promise.all([
        loadManagerCapabilityDrillIn(ctx.scope, {
          callerUserId: ctx.user.id,
          personId,
          visibilityMode: ctx.org.visibilityMode,
        }),
        loadManagerSpendDrillIn(ctx.scope, {
          callerUserId: ctx.user.id,
          personId,
          visibilityMode: ctx.org.visibilityMode,
          today: todayUtc(),
        }),
        loadManagerNotes(ctx.scope, {
          callerUserId: ctx.user.id,
          personId,
          visibilityMode: ctx.org.visibilityMode,
        }),
        // Resolves note-author bylines (auth users, org members) — never a
        // tracked-person identity.
        orgMembersList(ctx.db, ctx.org.id),
      ]),
  );
  if (result.status !== "ok") {
    notFound();
  }

  const { subject } = result;
  const name = subject.displayName ?? subject.pseudonym;
  const memberNames = new Map(members.map((m) => [m.userId, m.name]));
  const notes: ManagerNoteVM[] =
    notesResult.status === "ok"
      ? notesResult.notes.map((n) => ({
          id: n.id,
          authorUserId: n.authorUserId,
          authorName: memberNames.get(n.authorUserId) ?? "A former manager",
          body: n.body,
          followUpOn: n.followUpOn,
          createdAt: n.createdAt.toISOString(),
        }))
      : [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2 w-fit"
          nativeButton={false}
          render={<Link href="/team" />}
        >
          <ArrowLeft data-icon="inline-start" />
          {MANAGER_ROSTER_COPY.title}
        </Button>
        <PageHeader title={name} description={MANAGER_DRILL_IN_COPY.eyebrow} />
      </div>

      <ManagerCapabilityProfile rows={subject.capabilities} />
      {spendResult.status === "ok" ? (
        <ManagerSpendSection spend={spendResult.spend} />
      ) : null}
      {notesResult.status === "ok" ? (
        <ManagerNotesSection
          personId={personId}
          currentUserId={ctx.user.id}
          notes={notes}
        />
      ) : null}
    </div>
  );
}
