import type { ReactNode } from "react";
import { ConfidencePill } from "@/components/confidence-pill";
import { InfoTip } from "@/components/info-tip";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatCents } from "@/lib/format";
import type { MaturityNumbers } from "@/lib/maturity";
import type { MaturityNumberKey } from "@/lib/maturity-glossary";
import {
  MATURITY_LEVEL_COPY,
  MATURITY_NUMBER_COPY,
} from "@/lib/maturity-glossary";
import type { ConfidenceTier } from "@/lib/maturity";
import { CONFIDENCE_TIER_LABEL } from "@/lib/maturity-glossary";

// The board artifact: the eight CTO numbers, each with its confidence tier and
// an honest empty/insufficient state. EVERY card carries a paired counterweight
// or honesty caveat in its footer (Goodhart guard) — adoption sits next to
// concentration, cost is labeled a cost number not an ROI claim, etc. Team
// surfaces are aggregate-only, so no card names an individual. Personal orgs
// (org of one) drop the numbers that only make sense across people.

/** The order the eight numbers render in. Personal orgs drop `activation` and
 * `concentration` (an org of one has no meaningful activation share or
 * concentration across people). */
const TEAM_ORDER: MaturityNumberKey[] = [
  "activation",
  "adoptionVsBenchmark",
  "maturity",
  "plateau",
  "concentration",
  "costPerActiveUser",
  "toolSprawl",
  "agenticShare",
];
const PERSONAL_ORDER: MaturityNumberKey[] = [
  "adoptionVsBenchmark",
  "maturity",
  "plateau",
  "costPerActiveUser",
  "toolSprawl",
  "agenticShare",
];

export function MaturityNumberGrid({
  numbers,
  orgKind,
}: {
  numbers: MaturityNumbers;
  orgKind: "personal" | "team" | "system";
}) {
  const order = orgKind === "personal" ? PERSONAL_ORDER : TEAM_ORDER;
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {order.map((key) => (
        <NumberCard key={key} numberKey={key}>
          <NumberBody numberKey={key} numbers={numbers} />
        </NumberCard>
      ))}
    </div>
  );
}

function NumberCard({
  numberKey,
  children,
}: {
  numberKey: MaturityNumberKey;
  children: ReactNode;
}) {
  const copy = MATURITY_NUMBER_COPY[numberKey];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5 text-sm text-muted-foreground">
          {copy.label}
          <InfoTip label={copy.label} short={copy.shortWhat} />
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {children}
        <p className="text-xs text-muted-foreground">{copy.caveat}</p>
      </CardContent>
    </Card>
  );
}

/** A big headline number + a sub-line + the confidence badge. */
function Headline({
  value,
  sub,
  tier,
}: {
  value: ReactNode;
  sub?: ReactNode;
  tier: ConfidenceTier;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-heading text-3xl font-semibold tabular-nums">
          {value}
        </span>
        <ConfidencePill tier={tier} label={CONFIDENCE_TIER_LABEL[tier]} />
      </div>
      {sub ? <span className="text-xs text-muted-foreground">{sub}</span> : null}
    </div>
  );
}

function NumberBody({
  numberKey,
  numbers,
}: {
  numberKey: MaturityNumberKey;
  numbers: MaturityNumbers;
}) {
  switch (numberKey) {
    case "activation": {
      const n = numbers.activation;
      return (
        <div className="flex flex-col gap-2">
          <Headline
            tier={n.confidence}
            value={n.activationPct === null ? "—" : `${Math.round(n.activationPct)}%`}
            sub={
              n.activationPct === null
                ? "No people resolved yet"
                : `${n.activePeople} of ${n.knownPeople} known ${n.knownPeople === 1 ? "person" : "people"} active`
            }
          />
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            Dark-seat waste
            <ConfidencePill
              tier={n.darkSeat.confidence}
              label={CONFIDENCE_TIER_LABEL[n.darkSeat.confidence]}
            />
            <InfoTip label="Dark-seat waste" short={n.darkSeat.reason} />
          </p>
        </div>
      );
    }
    case "adoptionVsBenchmark": {
      const b = numbers.adoptionVsBenchmark.benchmark;
      if (!b || b.orgValue === null) {
        return (
          <Headline
            tier={numbers.adoptionVsBenchmark.confidence}
            value="—"
            sub="No adoption score computed yet"
          />
        );
      }
      return (
        <Headline
          tier={numbers.adoptionVsBenchmark.confidence}
          value={Math.round(b.orgValue)}
          sub={`Modeled peer reference ${Math.round(b.peerMedian)} · ${b.source}`}
        />
      );
    }
    case "maturity": {
      const m = numbers.maturity;
      if (m.stale) {
        // F8: the freshest sync predates the entire window — the level is
        // withheld, never rendered as a confident low off unobserved silence.
        return (
          <Headline
            tier={m.confidence}
            value="—"
            sub="Withheld — no tool has synced inside this window"
          />
        );
      }
      const levelName =
        m.level === null ? "Not enough data" : MATURITY_LEVEL_COPY[m.level].name;
      return (
        <div className="flex flex-col gap-2">
          <Headline
            tier={m.confidence}
            value={m.level === null ? "—" : `L${m.level}`}
            sub={levelName}
          />
          <TrajectoryLine trajectory={m.trajectory} />
        </div>
      );
    }
    case "plateau": {
      const p = numbers.plateau;
      if (p.kind === "insufficient") {
        return (
          <Headline
            tier={p.confidence}
            value="—"
            sub={`Needs more weekly history (${p.weeks} so far)`}
          />
        );
      }
      if (p.kind === "stale") {
        // F1: the last sync predates the weeks being judged — those weeks are
        // unobserved, not measured silence, so no growth/plateau verdict.
        return (
          <Headline
            tier={p.confidence}
            value="—"
            sub="Withheld — the last sync predates the recent weeks being judged"
          />
        );
      }
      return (
        <Headline
          tier={p.confidence}
          value={p.plateaued ? "Flattening" : "Growing"}
          sub={`Recent weeks ${p.changePct >= 0 ? "+" : ""}${p.changePct}% vs the earlier half of the window`}
        />
      );
    }
    case "concentration": {
      const c = numbers.concentration.concentration;
      if (!c.available) {
        return (
          <Headline
            tier={numbers.concentration.confidence}
            value="—"
            sub={
              c.resolvedPeople < 4
                ? "Too few identity-resolved people to show a concentration"
                : "No attributed prompt volume yet"
            }
          />
        );
      }
      return (
        <Headline
          tier={numbers.concentration.confidence}
          value={`${Math.round(c.top10SharePct)}%`}
          sub={`of attributed prompts come from the top ${c.top10Count} of ${c.resolvedPeople} people`}
        />
      );
    }
    case "costPerActiveUser": {
      const cpu = numbers.costPerActiveUser;
      if (!cpu.cost) {
        return (
          <Headline
            tier={cpu.confidence}
            value="—"
            sub={
              cpu.activePeople === 0
                ? "No active people in the window"
                : "No vendor-reported spend in the window"
            }
          />
        );
      }
      return (
        <Headline
          tier={cpu.confidence}
          value={formatCents(cpu.cost.centsPerUnit)}
          sub={`${formatCents(cpu.cost.reportedCents)} reported spend ÷ ${cpu.activePeople} active ${cpu.activePeople === 1 ? "person" : "people"}`}
        />
      );
    }
    case "toolSprawl": {
      const t = numbers.toolSprawl;
      return (
        <Headline
          tier={t.confidence}
          value={`${t.activeTools} / ${t.connectedTools}`}
          sub={
            t.connectedTools === 0
              ? "No tools connected yet"
              : `tools producing usage · ${t.idleTools} connected but idle`
          }
        />
      );
    }
    case "agenticShare": {
      const a = numbers.agenticShare.agentic;
      if (a.kind !== "measured") {
        return (
          <Headline
            tier={numbers.agenticShare.confidence}
            value="—"
            sub={
              a.kind === "noAgenticData"
                ? "No agent-capable telemetry yet (not a measured zero)"
                : "No activity linked to people yet"
            }
          />
        );
      }
      return (
        <Headline
          tier={numbers.agenticShare.confidence}
          value={`${Math.round(a.ratePct)}%`}
          sub={`${a.agenticDays} of ${a.activeDays} AI-active person-days used an agent`}
        />
      );
    }
  }
}

function TrajectoryLine({
  trajectory,
}: {
  trajectory: MaturityNumbers["maturity"]["trajectory"];
}) {
  if (trajectory.kind === "notComparable") {
    return (
      <span className="text-xs text-muted-foreground">
        {trajectory.reason === "partialPrior"
          ? "Not comparable — the prior quarter predates most of your data."
          : "Not enough prior history to show a trajectory yet."}
      </span>
    );
  }
  const parts: string[] = [];
  const fmt = (label: string, d: number | null) => {
    if (d === null) return;
    const sign = d > 0 ? "+" : "";
    parts.push(`${label} ${sign}${d}`);
  };
  fmt("Breadth", trajectory.breadthDelta);
  fmt("Depth", trajectory.depthDelta);
  fmt("Consistency", trajectory.consistencyDelta);
  return (
    <span className="text-xs text-muted-foreground">
      {trajectory.levelDelta !== null && trajectory.levelDelta !== 0
        ? `${trajectory.levelDelta > 0 ? "Up" : "Down"} ${Math.abs(trajectory.levelDelta)} level${Math.abs(trajectory.levelDelta) === 1 ? "" : "s"} vs the prior quarter. `
        : "Steady level vs the prior quarter. "}
      {parts.length > 0 ? `Axes: ${parts.join(", ")} pts.` : null}
    </span>
  );
}
