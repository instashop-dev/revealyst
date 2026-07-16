import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, UsersRound } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { SectionHeading } from "@/components/section-heading";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireAppContext } from "@/lib/api-context";
import { MANAGER_ROSTER_COPY } from "@/lib/manager-capability-copy";
import { loadManagedRoster } from "@/lib/manager-capability-view";
import { timeStage } from "@/lib/request-timing";

export const dynamic = "force-dynamic";

/**
 * Manager roster (P3-A, ADR 0045) — the entry point into the per-person
 * capability drill-in. Lists the members of every team the signed-in user
 * MANAGES, by name (names surface only because the loader already gated on
 * managed/full visibility). notFound() when the surface is unavailable in
 * private mode OR the caller manages no team (a plain member, or an admin
 * without a self-assigned grant) — a 404 never confirms who is on a team. The
 * per-person capability data lives on the drill-in, never here.
 */
export default async function ManagerRosterPage() {
  const ctx = await requireAppContext();
  const result = await timeStage("pageData", () =>
    loadManagedRoster(ctx.scope, {
      callerUserId: ctx.user.id,
      visibilityMode: ctx.org.visibilityMode,
    }),
  );
  if (result.status !== "ok") {
    notFound();
  }

  const hasAnyMember = result.teams.some((t) => t.members.length > 0);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={MANAGER_ROSTER_COPY.title}
        description={MANAGER_ROSTER_COPY.description}
      />

      {!hasAnyMember ? (
        <EmptyState
          icon={UsersRound}
          title={MANAGER_ROSTER_COPY.title}
          description={MANAGER_ROSTER_COPY.emptyRoster}
        />
      ) : (
        result.teams.map((team) => (
          <section key={team.teamId} className="flex flex-col gap-3">
            <SectionHeading>{team.teamName}</SectionHeading>
            {team.members.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {MANAGER_ROSTER_COPY.emptyTeam}
              </p>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {team.members.map((member) => (
                  <Card key={member.personId}>
                    <CardHeader>
                      <CardTitle className="text-base">
                        {member.displayName ?? member.pseudonym}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <Button
                        variant="outline"
                        size="sm"
                        nativeButton={false}
                        render={<Link href={`/team/${member.personId}`} />}
                      >
                        {MANAGER_ROSTER_COPY.openProfile}
                        <ArrowRight data-icon="inline-end" />
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </section>
        ))
      )}
    </div>
  );
}
