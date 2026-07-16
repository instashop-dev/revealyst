import Link from "next/link";
import { AdminOnlyNotice } from "@/components/settings/admin-only-notice";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireAppContext } from "@/lib/api-context";

export const dynamic = "force-dynamic";

// Advanced tab (U3) — admin-only. Home for the demoted Custom Index Builder
// (OQ-002) and the legal / data-processing links footer.
export default async function SettingsAdvancedPage() {
  const ctx = await requireAppContext("/settings/advanced");
  if (ctx.role !== "admin") {
    return <AdminOnlyNotice />;
  }

  const isPersonal = ctx.org.kind === "personal";

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      {/* Custom Index Builder stays demoted out of nav prominence (W5-H): a
       * custom index is a team/company-wide measure, so it has no meaning in a
       * personal org-of-one — same gating as the visibility/roster cards. */}
      {!isPersonal && (
        <Card>
          <CardHeader>
            <CardTitle>Custom indexes</CardTitle>
            <CardDescription>
              Build your own AI-adoption measure from your usage data — team and
              company-wide only. Private to your workspace: never shown on the
              benchmark panel or shareable score cards.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={<Link href="/indexes" />}
            >
              Open custom indexes
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Legal &amp; data</CardTitle>
          <CardDescription>
            How we handle your data, our terms, and what each connected tool
            sends.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col gap-2 text-sm">
            <li>
              <Link href="/legal/privacy" className="underline">
                Privacy policy
              </Link>
            </li>
            <li>
              <Link href="/legal/terms" className="underline">
                Terms of service
              </Link>
            </li>
            <li>
              <Link href="/legal/what-we-collect" className="underline">
                What we collect
              </Link>
            </li>
            <li>
              <Link href="/compliance" className="underline">
                Compliance &amp; rollout guidance
              </Link>
            </li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
