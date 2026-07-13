// W5-H deliverable 4: board-ready CSV export of the eight maturity board
// numbers (+ their confidence tiers). A PURE serializer over an
// already-computed `MaturityView` (readMaturityView, zero new queries) — no
// React, no I/O. The route (src/app/api/maturity/export/route.ts) wraps this in
// a text/csv Response through handleApi (402 applies like every data route).
//
// Honesty posture carries into the export (invariant b): a not-yet-measurable
// number serializes as its honest empty state ("Not enough data", "Withheld —
// …"), never a fabricated 0, and every row keeps its confidence tier so a
// board reading the spreadsheet sees measured vs modeled vs directional exactly
// as the in-app grid shows it. The value strings mirror MaturityNumberGrid so
// the CSV can never tell a different story than the screen.

import { formatCents } from "./format";
import type { MaturityView } from "./maturity";
import {
  MATURITY_LEVEL_COPY,
  MATURITY_NUMBER_COPY,
  type MaturityNumberKey,
} from "./maturity-glossary";

/** RFC-4180 field escaping: quote when the field holds a comma, quote, CR or
 * LF, doubling any embedded quote. Deterministic — the golden-file test pins
 * the exact bytes. */
function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function csvRow(fields: readonly string[]): string {
  return fields.map(csvField).join(",");
}

type Row = { value: string; confidence: string; detail: string };

/** The eight board numbers, in the same order as the team grid. */
const EXPORT_ORDER: MaturityNumberKey[] = [
  "activation",
  "adoptionVsBenchmark",
  "maturity",
  "plateau",
  "concentration",
  "costPerActiveUser",
  "toolSprawl",
  "agenticShare",
];

function rowFor(key: MaturityNumberKey, view: MaturityView): Row {
  const n = view.numbers;
  switch (key) {
    case "activation": {
      const a = n.activation;
      return {
        value: a.activationPct === null ? "Not enough data" : `${Math.round(a.activationPct)}%`,
        confidence: a.confidence,
        detail:
          a.activationPct === null
            ? "No people resolved yet; idle paid seats not measured"
            : `${a.activePeople} of ${a.knownPeople} identified people active; idle paid seats not measured`,
      };
    }
    case "adoptionVsBenchmark": {
      const b = n.adoptionVsBenchmark.benchmark;
      if (!b || b.orgValue === null) {
        return {
          value: "—",
          confidence: n.adoptionVsBenchmark.confidence,
          detail: "No adoption score computed yet",
        };
      }
      return {
        value: String(Math.round(b.orgValue)),
        confidence: n.adoptionVsBenchmark.confidence,
        detail: `Modeled peer reference ${Math.round(b.peerMedian)} (${b.source})`,
      };
    }
    case "maturity": {
      const m = n.maturity;
      if (m.stale) {
        return {
          value: "Withheld",
          confidence: m.confidence,
          detail: "No tool has synced inside this window",
        };
      }
      if (m.level === null) {
        return { value: "Not enough data", confidence: m.confidence, detail: "" };
      }
      const t = m.trajectory;
      let detail = "";
      if (t.kind === "notComparable") {
        detail =
          t.reason === "partialPrior"
            ? "Trajectory not comparable — the prior quarter predates most of your data"
            : "Not enough prior history for a trajectory yet";
      } else if (t.levelDelta !== null && t.levelDelta !== 0) {
        detail = `${t.levelDelta > 0 ? "Up" : "Down"} ${Math.abs(t.levelDelta)} level(s) vs the prior quarter`;
      } else {
        detail = "Steady level vs the prior quarter";
      }
      return {
        value: `${MATURITY_LEVEL_COPY[m.level].name} (L${m.level})`,
        confidence: m.confidence,
        detail,
      };
    }
    case "plateau": {
      const p = n.plateau;
      if (p.kind === "insufficient") {
        return {
          value: "—",
          confidence: p.confidence,
          detail: `Needs more weekly history (${p.weeks} so far)`,
        };
      }
      if (p.kind === "stale") {
        return {
          value: "Withheld",
          confidence: p.confidence,
          detail: "The last sync predates the recent weeks being judged",
        };
      }
      return {
        value: p.plateaued ? "Flattening" : "Growing",
        confidence: p.confidence,
        detail: `Recent weeks ${p.changePct >= 0 ? "+" : ""}${p.changePct}% vs the earlier half of the window`,
      };
    }
    case "concentration": {
      const c = n.concentration.concentration;
      if (!c.available) {
        return {
          value: "Not enough data",
          confidence: n.concentration.confidence,
          detail:
            c.resolvedPeople < 4
              ? "Too few identity-resolved people to show a concentration"
              : "No attributed prompt volume yet",
        };
      }
      return {
        value: `Top 10% = ${Math.round(c.top10SharePct)}%`,
        confidence: n.concentration.confidence,
        detail: `${Math.round(c.top10SharePct)}% of attributed prompts from the top ${c.top10Count} of ${c.resolvedPeople} people`,
      };
    }
    case "costPerActiveUser": {
      const cpu = n.costPerActiveUser;
      if (!cpu.cost) {
        return {
          value: "—",
          confidence: cpu.confidence,
          detail:
            cpu.activePeople === 0
              ? "No active people in the window"
              : "No vendor-reported spend in the window",
        };
      }
      return {
        value: formatCents(cpu.cost.centsPerUnit),
        confidence: cpu.confidence,
        detail: `${formatCents(cpu.cost.reportedCents)} reported spend / ${cpu.activePeople} active people`,
      };
    }
    case "toolSprawl": {
      const t = n.toolSprawl;
      return {
        value: `${t.activeTools} of ${t.connectedTools}`,
        confidence: t.confidence,
        detail:
          t.connectedTools === 0
            ? "No tools connected yet"
            : `${t.activeTools} tools producing usage; ${t.idleTools} connected but idle`,
      };
    }
    case "agenticShare": {
      const a = n.agenticShare.agentic;
      if (a.kind !== "measured") {
        return {
          value: "—",
          confidence: n.agenticShare.confidence,
          detail:
            a.kind === "noAgenticData"
              ? "No agent-capable telemetry yet (not a measured zero)"
              : "No activity linked to people yet",
        };
      }
      return {
        value: `${Math.round(a.ratePct)}%`,
        confidence: n.agenticShare.confidence,
        detail: `${a.agenticDays} of ${a.activeDays} AI-active person-days used an agent`,
      };
    }
  }
}

/**
 * Serialize the eight board numbers of a {@link MaturityView} to a CSV string.
 * A short metadata preamble (window + data-as-of) precedes the table so the
 * download is self-describing when opened in a spreadsheet. Deterministic:
 * same view in → identical bytes out (golden-file tested).
 */
export function maturityViewToCsv(view: MaturityView): string {
  const lines: string[] = [];
  lines.push(csvRow(["Revealyst AI Maturity export"]));
  lines.push(
    csvRow(["Report window", `${view.currentWindow.from} to ${view.currentWindow.to}`]),
  );
  lines.push(
    csvRow([
      "Data as of",
      view.dataAsOf ? view.dataAsOf : "No successful sync yet",
    ]),
  );
  lines.push("");
  lines.push(csvRow(["Number", "Value", "Confidence", "Detail"]));
  for (const key of EXPORT_ORDER) {
    const row = rowFor(key, view);
    lines.push(
      csvRow([MATURITY_NUMBER_COPY[key].label, row.value, row.confidence, row.detail]),
    );
  }
  // Trailing newline so the file ends cleanly (POSIX text convention).
  return lines.join("\r\n") + "\r\n";
}

/** A stable, safe download filename for the export. */
export function maturityCsvFilename(view: MaturityView): string {
  return `revealyst-maturity-${view.currentWindow.to}.csv`;
}
