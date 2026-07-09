import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ATTRIBUTION_GLOSSARY,
  CONCEPT_GLOSSARY,
  HONESTY_GAP_GLOSSARY,
  METRIC_REFERENCE,
  SCORE_GLOSSARY,
  SCORE_SLUGS,
  methodologyAnchor,
  type GlossaryEntry,
  type ScoreSlug,
} from "@/lib/metrics-glossary";

// Static reference page (metrics-UX redesign) — "How your scores work". Zero
// data reads: every fact rendered here comes from the plain-English glossary
// module (src/lib/metrics-glossary.ts), which is itself derived from the live
// score-preset definitions and the metric catalog seed — this page never
// invents a claim of its own. Auth + shell come from the (app) layout ("zero
// new software", tripwire rule 7 — guidance, not a feature). Every anchor id
// below comes from methodologyAnchor() so InfoTip popovers elsewhere in the
// app can deep-link straight to a score, component, concept, or metric row.

export const metadata = {
  title: "How your scores work · Revealyst",
};

function SectionHeading({
  id,
  children,
}: {
  id: string;
  children: React.ReactNode;
}) {
  return (
    <h2
      id={id}
      className="scroll-mt-20 font-heading text-xl font-semibold tracking-tight"
    >
      {children}
    </h2>
  );
}

function Misconception({ text }: { text: string }) {
  return (
    <Alert>
      <AlertTitle>Common misunderstanding</AlertTitle>
      <AlertDescription>{text}</AlertDescription>
    </Alert>
  );
}

const DEFINITION_VERSION_NOTE =
  "This describes the current default definition — your dashboard always shows the definition version each score was actually computed with.";

/** Renders the shared shape of a GlossaryEntry — what / why it matters / how
 * it's calculated / included-excluded / how to read it / example /
 * misconception — so every score, component, and concept entry gets the same
 * honest treatment instead of a bespoke layout each. */
function GlossaryBody({
  entry,
  showDefinitionNote = false,
}: {
  entry: GlossaryEntry;
  showDefinitionNote?: boolean;
}) {
  return (
    <div className="max-w-prose space-y-3 text-sm text-muted-foreground">
      <p>{entry.what}</p>
      <p>
        <span className="font-medium text-foreground">Why it matters. </span>
        {entry.whyItMatters}
      </p>
      <div>
        <p>
          <span className="font-medium text-foreground">
            How it&apos;s calculated.{" "}
          </span>
          {entry.howCalculatedSimple}
        </p>
        <p className="mt-1">{entry.howCalculatedDetailed}</p>
        {showDefinitionNote ? (
          <p className="mt-1 text-xs italic">{DEFINITION_VERSION_NOTE}</p>
        ) : null}
      </div>
      {entry.included || entry.excluded ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {entry.included ? (
            <p>
              <span className="font-medium text-foreground">Included. </span>
              {entry.included}
            </p>
          ) : null}
          {entry.excluded ? (
            <p>
              <span className="font-medium text-foreground">Excluded. </span>
              {entry.excluded}
            </p>
          ) : null}
        </div>
      ) : null}
      <p>
        <span className="font-medium text-foreground">How to read it. </span>
        {entry.howToInterpret}
      </p>
      {entry.example ? (
        <p className="border-l-2 border-border pl-3 italic">{entry.example}</p>
      ) : null}
      {entry.misconception ? <Misconception text={entry.misconception} /> : null}
    </div>
  );
}

function ScoreSection({ slug }: { slug: ScoreSlug }) {
  const entry = SCORE_GLOSSARY[slug];
  return (
    <Card>
      <CardHeader>
        <SectionHeading id={methodologyAnchor(slug)}>
          {entry.plainName}
        </SectionHeading>
        <CardDescription>{entry.shortWhat}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <GlossaryBody entry={entry} showDefinitionNote />
        <div className="space-y-6 border-t pt-6">
          {Object.values(entry.components).map((component) => (
            <div key={component.key} className="space-y-3">
              <h3
                id={methodologyAnchor(component.key)}
                className="scroll-mt-20 font-heading text-base font-semibold tracking-tight"
              >
                {component.plainName}
              </h3>
              <GlossaryBody entry={component} showDefinitionNote />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export default function MethodologyPage() {
  return (
    <>
      <PageHeader
        title="How your scores work"
        description="Every number in Revealyst, explained in plain English — what it measures, how it's calculated, and how to read it."
      />

      <div className="mt-6 flex flex-col gap-10">
        <section className="space-y-3">
          <SectionHeading id={methodologyAnchor("honesty")}>
            How to read these scores
          </SectionHeading>
          <GlossaryBody entry={CONCEPT_GLOSSARY.honesty} />
        </section>

        <div className="flex flex-col gap-6">
          {SCORE_SLUGS.map((slug) => (
            <ScoreSection key={slug} slug={slug} />
          ))}
        </div>

        <section className="space-y-4">
          <SectionHeading id={methodologyAnchor("attribution")}>
            Who the numbers are attributed to
          </SectionHeading>
          <GlossaryBody entry={CONCEPT_GLOSSARY.attribution} />
          <dl className="grid gap-4 sm:grid-cols-3">
            {Object.entries(ATTRIBUTION_GLOSSARY).map(([level, info]) => (
              <div
                key={level}
                className="rounded-xl bg-card p-4 text-sm ring-1 ring-foreground/10"
              >
                <dt
                  id={methodologyAnchor(level)}
                  className="scroll-mt-20 font-heading font-semibold text-foreground"
                >
                  {info.label}
                </dt>
                <dd className="mt-2 space-y-2 text-muted-foreground">
                  <p>{info.what}</p>
                  <p className="text-xs">{info.caveat}</p>
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="space-y-3">
          <SectionHeading id={methodologyAnchor("sharedAccounts")}>
            Shared accounts
          </SectionHeading>
          <GlossaryBody entry={CONCEPT_GLOSSARY.sharedAccounts} />
          <Button variant="outline" nativeButton={false} render={<Link href="/playbook" />}>
            Open the visibility-readiness playbook
          </Button>
        </section>

        <section className="space-y-3">
          <SectionHeading id={methodologyAnchor("benchmarks")}>
            Benchmarks
          </SectionHeading>
          <GlossaryBody entry={CONCEPT_GLOSSARY.benchmarks} />
        </section>

        <section className="space-y-3">
          <SectionHeading id={methodologyAnchor("segments")}>
            Segments
          </SectionHeading>
          <GlossaryBody entry={CONCEPT_GLOSSARY.segments} />
        </section>

        <section className="space-y-3">
          <SectionHeading id={methodologyAnchor("estimatedSpend")}>
            Estimated spend
          </SectionHeading>
          <GlossaryBody entry={CONCEPT_GLOSSARY.estimatedSpend} />
        </section>

        <section className="space-y-3">
          <SectionHeading id={methodologyAnchor("honestyGaps")}>
            When data is incomplete
          </SectionHeading>
          <p className="max-w-prose text-sm text-muted-foreground">
            These are documented limitations in what a connected tool can
            report, surfaced honestly instead of quietly guessed at. A given
            connection may hit none, one, or several of these.
          </p>
          <dl className="divide-y divide-border">
            {Object.entries(HONESTY_GAP_GLOSSARY).map(([kind, gap]) => (
              <div key={kind} className="py-3">
                <dt
                  id={methodologyAnchor(kind)}
                  className="scroll-mt-20 text-sm font-medium text-foreground"
                >
                  {gap.label}
                </dt>
                <dd className="mt-1 max-w-prose text-sm text-muted-foreground">
                  {gap.shortWhat}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="space-y-3">
          <SectionHeading id={methodologyAnchor("metricsReference")}>
            Metrics reference
          </SectionHeading>
          <p className="max-w-prose text-sm text-muted-foreground">
            These are the raw signals Revealyst collects from your connected
            tools. Every score above is built only from these — nothing else
            feeds them.
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Metric</TableHead>
                <TableHead>What it is</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Object.entries(METRIC_REFERENCE).map(([key, metric]) => (
                <TableRow
                  key={key}
                  id={methodologyAnchor(key)}
                  className="scroll-mt-20"
                >
                  <TableCell className="align-top font-medium whitespace-normal">
                    {metric.name}
                  </TableCell>
                  <TableCell className="whitespace-normal text-muted-foreground">
                    {metric.description}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      </div>
    </>
  );
}
