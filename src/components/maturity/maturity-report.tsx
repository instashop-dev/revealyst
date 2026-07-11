import { MaturityAxisMeters } from "@/components/maturity/maturity-axis-meters";
import { MaturityLevelBanner } from "@/components/maturity/maturity-level-banner";
import { MaturityNumberGrid } from "@/components/maturity/maturity-number-grid";
import { NotScoredSection } from "@/components/maturity/not-scored-section";
import type { MaturityView } from "@/lib/maturity";

/**
 * The one-page AI maturity report — the F2.1 board artifact. Composes the level
 * banner, the three measured axis meters, the eight-number board grid, and the
 * "what we don't measure" section into a single server-rendered panel. This is
 * the page's main panel (tested in isolation).
 *
 * Personal orgs (org of one) get the reduced self-version: the level + axes +
 * the numbers that make sense for one person; activation and concentration
 * (both cross-people measures) are dropped by the number grid.
 */
export function MaturityReport({
  view,
  orgKind,
}: {
  view: MaturityView;
  orgKind: "personal" | "team" | "system";
}) {
  return (
    <div className="flex flex-col gap-6">
      <MaturityLevelBanner level={view.level} dataAsOf={view.dataAsOf} />

      <section className="flex flex-col gap-3">
        <SectionHeading>The three axes</SectionHeading>
        <MaturityAxisMeters axes={view.axes} />
      </section>

      <section className="flex flex-col gap-3">
        <SectionHeading>
          {orgKind === "personal" ? "Your numbers" : "The board numbers"}
        </SectionHeading>
        <MaturityNumberGrid numbers={view.numbers} orgKind={orgKind} />
      </section>

      <NotScoredSection />
    </div>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
      {children}
    </h2>
  );
}
