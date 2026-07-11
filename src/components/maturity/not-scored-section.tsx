import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { MATURITY_NOT_SCORED, maturityAnchor } from "@/lib/maturity-glossary";

/**
 * "What we deliberately don't measure — and why." The Group C refusals (shadow
 * AI, ROI/time-saved, per-person quality, governance maturity) rendered as
 * first-class content. This is the honesty differentiator, not a disclaimer
 * footnote: naming what we WON'T put a number on is the point (invariant b).
 * Server-safe — pure static content from the glossary.
 */
export function NotScoredSection() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          What we deliberately don&apos;t measure
        </CardTitle>
        <CardDescription>
          These are things a board might ask for that we refuse to put a number
          on, because an honest one can&apos;t be derived from telemetry. Naming
          them is the point.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="divide-y divide-border">
          {MATURITY_NOT_SCORED.map((item) => (
            <div key={item.key} className="py-3 first:pt-0 last:pb-0">
              <dt
                id={maturityAnchor(item.key)}
                className="scroll-mt-20 text-sm font-medium text-foreground"
              >
                {item.label}
              </dt>
              <dd className="mt-1 max-w-prose space-y-1 text-sm text-muted-foreground">
                <p>
                  <span className="font-medium text-foreground/80">
                    What it would claim.{" "}
                  </span>
                  {item.what}
                </p>
                <p>
                  <span className="font-medium text-foreground/80">
                    Why we don&apos;t.{" "}
                  </span>
                  {item.why}
                </p>
              </dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
