import { DigestPreferencesForm } from "@/components/settings/digest-preferences-form";
import { ExecReportPreferencesForm } from "@/components/settings/exec-report-preferences-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { listDigestRecipients } from "@/db/system";
import { requireAppContext } from "@/lib/api-context";

export const dynamic = "force-dynamic";

// Notifications tab (U3). Everyone controls their own weekly digest; the
// monthly executive memo is an admin-only, workspace-level control.
export default async function SettingsNotificationsPage() {
  const ctx = await requireAppContext("/settings/notifications");
  const isAdmin = ctx.role === "admin";
  const isPersonal = ctx.org.kind === "personal";

  // One flat Promise.all (depth 1). The exec-memo state is only read for
  // admins, who alone see its control.
  const [digestPref, digestAudience, execReportState] = await Promise.all([
    // Weekly-digest opt-in. When no preference row exists yet, fall back to the
    // SAME lane default the sender uses (single-member org = on, multi-member =
    // off) — computed from member count, so the toggle can't disagree with what
    // the digest sender actually does.
    ctx.scope.digestPreferences.getForUser(ctx.user.id),
    listDigestRecipients(ctx.db, ctx.org.id),
    isAdmin ? ctx.scope.execReportState.get() : Promise.resolve(null),
  ]);
  const digestEnabled = digestPref
    ? digestPref.digestEnabled
    : digestAudience.memberCount <= 1;
  const execReportEnabled = execReportState
    ? execReportState.execReportEnabled
    : true;

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Weekly digest</CardTitle>
          <CardDescription>
            A Monday-morning email with your workspace&rsquo;s AI-adoption trends
            versus its own past
            {isPersonal ? "" : " (aggregate only — no named individuals)"}.
            Suppressed automatically when your connected tools haven&rsquo;t
            synced recently.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DigestPreferencesForm initialEnabled={digestEnabled} />
        </CardContent>
      </Card>

      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle>Monthly executive memo</CardTitle>
            <CardDescription>
              A one-page, plain-English summary of your workspace&rsquo;s AI
              maturity, spend, and attribution coverage, emailed to admins at the
              start of each month
              {isPersonal ? "" : " (aggregate only — no named individuals)"}.
              Composed from your measured metrics, never estimated.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ExecReportPreferencesForm initialEnabled={execReportEnabled} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
