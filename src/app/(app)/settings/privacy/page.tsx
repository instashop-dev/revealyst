import Link from "next/link";
import { BenchmarkConsentToggle } from "@/components/benchmark-consent-toggle";
import { AdminOnlyNotice } from "@/components/settings/admin-only-notice";
import { VisibilityModeControl } from "@/components/settings/visibility-mode-control";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireAppContext } from "@/lib/api-context";

export const dynamic = "force-dynamic";

// Privacy & visibility tab (U3) — admin-only.
export default async function SettingsPrivacyPage() {
  const ctx = await requireAppContext("/settings/privacy");
  if (ctx.role !== "admin") {
    return <AdminOnlyNotice />;
  }

  // Personal mode = an org of one. There are no other people to pseudonymize,
  // so the visibility control has no meaning — team-only concepts must not leak
  // into personal UX.
  const isPersonal = ctx.org.kind === "personal";

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      {!isPersonal && (
        <Card>
          <CardHeader>
            <CardTitle>Visibility mode</CardTitle>
            <CardDescription>
              Controls whether individuals appear as pseudonyms or by their real
              names. Private (team-only) is the EU-safe default; changing it is
              deliberate, audited, and reversible. Need help deciding? See the{" "}
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

      {/* Benchmark consent moves HERE (D-U5). NOTE: phase U1 still owns
       * personal-self-view.tsx, which also renders BenchmarkConsentToggle — do
       * NOT remove it from the dashboard in this phase. The orchestrator dedupes
       * the two placements at integration; the toggle is self-contained (reads
       * and writes its own consent state), so rendering it in both places is
       * safe in the interim. */}
      <Card>
        <CardHeader>
          <CardTitle>Anonymized benchmarks</CardTitle>
          <CardDescription>
            Choose whether your workspace&rsquo;s scores are included, anonymized
            and aggregated, in published benchmarks. Off by default; change
            anytime.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <BenchmarkConsentToggle />
        </CardContent>
      </Card>
    </div>
  );
}
