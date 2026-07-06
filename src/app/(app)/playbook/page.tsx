import Link from "next/link";
import { KeyRound, ScanFace, ShieldCheck, Users } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// Static guided content (Product Spec §6.3) — the visibility-readiness
// playbook. No data reads, no interactivity: guidance, not a feature (the
// "zero new software" tripwire). Auth + shell come from the (app) layout.

export const metadata = {
  title: "Visibility-readiness playbook · Revealyst",
};

const BENEFITS = [
  {
    icon: Users,
    title: "Accurate adoption & fluency",
    body: "Usage attributes to real people, so scores and team benchmarks reflect reality instead of a blurred average.",
  },
  {
    icon: ShieldCheck,
    title: "ToS compliance",
    body: "Most vendors prohibit credential sharing; per-user access keeps you inside the terms you agreed to.",
  },
  {
    icon: KeyRound,
    title: "Security & governance",
    body: "A shared key or login is an unrevocable, unattributable secret. Per-user access means clean offboarding and an audit trail.",
  },
];

function Step({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-3 text-base">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
            {n}
          </span>
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground [&_a]:font-medium [&_a]:text-foreground [&_a]:underline [&_strong]:text-foreground">
        {children}
      </CardContent>
    </Card>
  );
}

export default function PlaybookPage() {
  return (
    <>
      <PageHeader
        title="Visibility-readiness playbook"
        description="When an account is flagged as likely shared, adoption is undercounted — several people collapse into one seat. Moving to per-user access fixes your data quality, compliance, and security at once."
      >
        <Button variant="outline" nativeButton={false} render={<Link href="/reconcile" />}>
          <ScanFace data-icon="inline-start" />
          Back to Reconcile
        </Button>
      </PageHeader>

      <div className="mb-8 grid gap-4 sm:grid-cols-3">
        {BENEFITS.map((b) => (
          <Card key={b.title}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <b.icon className="size-4 text-primary" />
                {b.title}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {b.body}
            </CardContent>
          </Card>
        ))}
      </div>

      <p className="mb-6 text-sm text-muted-foreground">
        You don&apos;t have to do all of this at once. Each step independently
        improves data quality — do the ones that fit the tools you run.
      </p>

      <div className="flex flex-col gap-4">
        <Step n={1} title="Issue per-user API keys">
          <p className="mb-3">
            Replace shared admin/organization API keys with one key per person.
            Usage then carries a real owner instead of landing at the account
            level.
          </p>
          <ul className="ml-4 list-disc space-y-2">
            <li>
              <strong>Anthropic (API / Console)</strong> — create a workspace
              member per person and issue each their own API key; the Console&apos;s
              usage &amp; cost reports break down by key owner. (OAuth-only users
              can be missing from Console breakdowns — a known vendor gap
              Revealyst surfaces honestly rather than papering over.)
            </li>
            <li>
              <strong>OpenAI</strong> — issue per-user (or per-person project)
              keys. OpenAI usage is person-level <strong>only</strong> when the
              customer issues per-user keys; a shared org key stays
              account-level, and Revealyst shows it as such.
            </li>
            <li>
              <strong>Rotate out the shared key</strong> once per-user keys are
              live, so new usage stops accumulating on the unattributable
              credential.
            </li>
          </ul>
        </Step>

        <Step n={2} title="Migrate shared consumer logins to Team/Business plans">
          <p className="mb-3">
            A shared ChatGPT Plus or Claude Pro login is the hardest case: one
            seat, many people, no admin visibility, and usually against the
            vendor&apos;s terms.
          </p>
          <ul className="ml-4 list-disc space-y-2">
            <li>
              <strong>ChatGPT</strong> — move shared Plus logins to{" "}
              <strong>ChatGPT Team / Enterprise</strong> for per-member seats and
              an admin console.
            </li>
            <li>
              <strong>Claude</strong> — move shared Pro logins to{" "}
              <strong>Claude Team / Enterprise</strong> for per-member seats and
              workspace administration.
            </li>
            <li>Give each person their own seat and retire the shared login.</li>
          </ul>
        </Step>

        <Step n={3} title="Reconcile the new identities in Revealyst">
          <p className="mb-3">
            Once per-user keys and seats exist, the connectors discover
            per-person subjects. Finish the job on the{" "}
            <Link href="/reconcile">Reconcile</Link> page:
          </p>
          <ul className="ml-4 list-disc space-y-2">
            <li>
              Map each vendor account to a real person — email matches are
              proposed automatically; the rest are one click.
            </li>
            <li>
              Leave genuinely shared or service accounts unresolved — Revealyst
              keeps them at account level rather than inventing per-user numbers.
            </li>
            <li>
              Assign people to teams so team-level scores and the
              privacy-default views populate.
            </li>
          </ul>
        </Step>
      </div>

      <Card className="mt-6 border-primary/30">
        <CardHeader>
          <CardTitle className="text-base">What you gain</CardTitle>
          <CardDescription>
            After a pass through this playbook the shared-account flags clear on
            their own: usage attributes to people, adoption reflects your real
            headcount, and your spend and fluency numbers are trustworthy enough
            to act on.
          </CardDescription>
        </CardHeader>
      </Card>
    </>
  );
}
