import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { DigestPreferencesForm } from "@/components/settings/digest-preferences-form";
import { ExecReportPreferencesForm } from "@/components/settings/exec-report-preferences-form";
import { RoleManagementCard } from "@/components/settings/role-management-card";
import { TeamManagementCard } from "@/components/settings/team-management-card";
import { VisibilityModeControl } from "@/components/settings/visibility-mode-control";
import { WorkspaceNameForm } from "@/components/settings/workspace-name-form";
import { listDigestRecipients } from "@/db/system";
import { groupBy } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireAppContext } from "@/lib/api-context";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const ctx = await requireAppContext("/settings");
  // Admin-only, same double-gate as /members (ADR 0004): the PATCH route
  // returns 403 to non-admins, and the page bounces them so they never see a
  // control they can't use.
  if (ctx.role !== "admin") {
    redirect("/dashboard");
  }

  // Personal mode = an org of one. There are no other people to pseudonymize,
  // so the visibility control has no meaning — team-only concepts must not leak
  // into personal UX. Show only the workspace rename card there.
  const isPersonal = ctx.org.kind === "personal";

  // Weekly-digest opt-in state. When no preference row exists yet, fall back to
  // the SAME lane default the sender uses (single-member org = on, multi-member
  // = off) — computed from member count, not org.kind, so the toggle can't
  // disagree with what the digest sender actually does.
  const [
    digestPref,
    digestAudience,
    execReportState,
    teams,
    allMembers,
    peopleRows,
    roleList,
    roleAssignments,
  ] = await Promise.all([
    ctx.scope.digestPreferences.getForUser(ctx.user.id),
    listDigestRecipients(ctx.db, ctx.org.id),
    // Monthly exec-memo opt-in — a per-workspace row (absent → on by default,
    // matching the sender's absent-row default).
    ctx.scope.execReportState.get(),
    // People & teams roster (W5-H deliverable 2) — relocated here from the
    // retired /teams nav page. Team orgs only (an org-of-one has no roster).
    isPersonal ? Promise.resolve([]) : ctx.scope.teams.list(),
    isPersonal ? Promise.resolve([]) : ctx.scope.teams.allMembers(),
    isPersonal ? Promise.resolve([]) : ctx.scope.people.list(),
    // Roles (W6-B, ADR 0030): the global role list + this org's assignments,
    // both folded into the existing flat Promise.all (+2 queries, one round-
    // trip). Team orgs only, mirroring the roster card.
    isPersonal ? Promise.resolve([]) : ctx.scope.roles.list(),
    isPersonal ? Promise.resolve([]) : ctx.scope.roles.assignments(),
  ]);
  const digestEnabled = digestPref
    ? digestPref.digestEnabled
    : digestAudience.memberCount <= 1;
  const execReportEnabled = execReportState
    ? execReportState.execReportEnabled
    : true;

  // §7 gating identical to the frozen personRef shape: names only leave the
  // server when the org's visibility mode permits.
  const showNames = ctx.org.visibilityMode !== "private";
  const membersByTeam = groupBy(allMembers, (m) => m.teamId);
  const teamRows = teams.map((team) => ({
    id: team.id,
    name: team.name,
    memberIds: (membersByTeam.get(team.id) ?? []).map((m) => m.personId),
  }));
  const peopleOptions = peopleRows.map((person) => ({
    id: person.id,
    pseudonym: person.pseudonym,
    displayName: showNames ? (person.displayName ?? null) : null,
  }));

  // Roles (W6-B): map each §7-gated person to their current role assignment.
  const roleBySlug = new Map(
    roleAssignments.map((a) => [a.personId, a.roleSlug]),
  );
  const rolePeople = peopleRows.map((person) => ({
    id: person.id,
    label: showNames
      ? (person.displayName ?? person.pseudonym)
      : person.pseudonym,
    roleSlug: roleBySlug.get(person.id) ?? null,
  }));
  const roleOptions = roleList.map((role) => ({
    slug: role.slug,
    label: role.label,
  }));

  return (
    <>
      <PageHeader
        title="Settings"
        description="Manage your workspace name and privacy controls."
      />
      <div className="flex max-w-2xl flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Workspace</CardTitle>
            <CardDescription>
              {isPersonal
                ? "The name of your personal workspace."
                : "The name your team sees across Revealyst."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <WorkspaceNameForm name={ctx.org.name} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Weekly digest</CardTitle>
            <CardDescription>
              A Monday-morning email with your workspace&rsquo;s AI-adoption
              trends versus its own past{isPersonal ? "" : " (aggregate only — no named individuals)"}. Suppressed automatically when your
              connected tools haven&rsquo;t synced recently.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DigestPreferencesForm initialEnabled={digestEnabled} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Monthly executive memo</CardTitle>
            <CardDescription>
              A one-page, plain-English summary of your workspace&rsquo;s AI
              maturity, spend, and attribution coverage, emailed to admins at the
              start of each month{isPersonal ? "" : " (aggregate only — no named individuals)"}. Composed from your measured
              metrics, never estimated.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ExecReportPreferencesForm initialEnabled={execReportEnabled} />
          </CardContent>
        </Card>

        {!isPersonal && (
          <Card>
            <CardHeader>
              <CardTitle>Visibility mode</CardTitle>
              <CardDescription>
                Controls whether individuals appear as pseudonyms or by their
                real names. Private (team-only) is the EU-safe default; changing
                it is deliberate, audited, and reversible. Need help deciding?
                See the{" "}
                <Link href="/compliance" className="underline">
                  compliance &amp; rollout guidance
                </Link>
                .
              </CardDescription>
            </CardHeader>
            <CardContent>
              <VisibilityModeControl current={ctx.org.visibilityMode} />
            </CardContent>
          </Card>
        )}

        {!isPersonal && (
          <TeamManagementCard
            teams={teamRows}
            people={peopleOptions}
            isAdmin
          />
        )}

        {!isPersonal && (
          <RoleManagementCard people={rolePeople} roles={roleOptions} />
        )}
      </div>
    </>
  );
}
