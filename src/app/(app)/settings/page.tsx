import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { VisibilityModeControl } from "@/components/settings/visibility-mode-control";
import { WorkspaceNameForm } from "@/components/settings/workspace-name-form";
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
      </div>
    </>
  );
}
