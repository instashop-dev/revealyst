import { describe, expect, it } from "vitest";
import type { ExecReport } from "../src/lib/exec-report";
import {
  execReportEmailSubject,
  renderExecReportDocument,
  renderExecReportEmail,
} from "../src/lib/exec-report-email";
import { MATURITY_NOT_SCORED } from "../src/lib/maturity-glossary";
import { CAUSAL_BANNED_PHRASES } from "../src/lib/narrative-copy";

// Snapshot/structure tests for the monthly executive-memo email + printable
// one-pager renderer (W6-F). The renderer derives nothing — it only lays out a
// composed ExecReport — so these assert layout invariants: every composed line
// and board number is present, prose is HTML-escaped (no XSS from an org name),
// the manage link is present, the printable variant is a full HTML document,
// and no causal phrasing leaks into the markup.

function sampleReport(over: Partial<ExecReport> = {}): ExecReport {
  return {
    monthKey: "2026-06",
    orgName: "Acme Inc",
    summary: [
      "Over the last 4 weeks, 12 people were active on AI tools (up from 9).",
    ],
    maturityLine:
      "Your AI maturity level this month is Adopted (L2). This is a modeled reading of how sophisticated your AI usage is — a leading indicator, not a measure of realized business outcomes.",
    trajectoryLine: "Quarter over quarter, your level held at Adopted.",
    plateauLine: "Recent weekly usage is still growing, not flattening.",
    spendLine:
      "Vendor-reported AI spend so far this month is $1,900 — 38% of your $5,000 monthly budget.",
    honestyLine:
      "Attribution coverage is improving: in the latest measured week, 100% of usage was attributed to a specific person, up from 50% the week of Jun 8.",
    capabilityCoverageLine: "",
    sections: [
      {
        key: "activation",
        label: "Activation",
        value: "48% (12 of 25 people active)",
        confidence: "measured",
        confidenceLabel: "Measured",
        caveat: "Activation counts people we can see in your connected tools.",
      },
      {
        key: "agenticShare",
        label: "Agentic share",
        value: "41% of active days used an agent",
        confidence: "measured",
        confidenceLabel: "Measured",
        caveat: "Not every connected tool reports agent activity.",
      },
    ],
    notMeasured: MATURITY_NOT_SCORED,
    dataAsOf: "2026-06-30T12:00:00.000Z",
    ...over,
  };
}

describe("execReportEmailSubject", () => {
  it("names the reported month, never a private number", () => {
    expect(execReportEmailSubject(sampleReport())).toBe(
      "Your June 2026 AI adoption memo — Revealyst",
    );
  });
});

describe("renderExecReportEmail", () => {
  it("includes every composed line and board number", () => {
    const html = renderExecReportEmail(sampleReport(), {
      manageUrl: "https://app.example/settings",
    });
    expect(html).toContain("Acme Inc");
    expect(html).toContain("Monthly AI adoption memo — June 2026");
    expect(html).toContain("your level held at Adopted");
    expect(html).toContain("Vendor-reported AI spend so far this month");
    expect(html).toContain("Attribution coverage is improving");
    // Board numbers + their confidence tags.
    expect(html).toContain("Activation");
    expect(html).toContain("48% (12 of 25 people active)");
    expect(html).toContain("Measured");
    expect(html).toContain("41% of active days used an agent");
    // "What we don't measure" differentiator content.
    expect(html).toContain("Shadow AI");
    // Manage link + honest data-as-of footer.
    expect(html).toContain("https://app.example/settings");
    expect(html).toContain("Data as of Jun 30");
  });

  it("HTML-escapes prose so an org name can't inject markup", () => {
    const html = renderExecReportEmail(
      sampleReport({ orgName: "<script>alert(1)</script>Evil" }),
      { manageUrl: "/settings" },
    );
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("renders an honest empty 'In brief' when nothing is measurable", () => {
    const html = renderExecReportEmail(sampleReport({ summary: [] }), {
      manageUrl: "/settings",
    });
    expect(html).toContain("isn't enough measured activity yet");
  });

  it("renders the honest no-sync footer when nothing has synced", () => {
    const html = renderExecReportEmail(sampleReport({ dataAsOf: null }), {
      manageUrl: "/settings",
    });
    expect(html).toContain("No connected tool has synced successfully yet");
  });

  it("never renders a causal phrase in the composed claim prose", () => {
    // Sweep the memo's CLAIM prose (summary + the composed metric lines + board
    // values) — the surfaces the honesty invariant governs — not the email's
    // boilerplate footer (whose "…because you're an admin" is a non-causal
    // house-style phrasing, as in budget-alert-copy.ts).
    const report = sampleReport();
    const claimProse = [
      ...report.summary,
      report.maturityLine,
      report.trajectoryLine,
      report.plateauLine,
      report.spendLine,
      report.honestyLine,
      ...report.sections.map((s) => s.value),
    ]
      .join(" ")
      .toLowerCase();
    for (const phrase of CAUSAL_BANNED_PHRASES) {
      expect(claimProse).not.toContain(phrase);
    }
  });
});

describe("renderExecReportDocument", () => {
  it("wraps the same body in a self-contained printable HTML document", () => {
    const doc = renderExecReportDocument(sampleReport(), {
      manageUrl: "/settings",
    });
    expect(doc.startsWith("<!doctype html>")).toBe(true);
    expect(doc).toContain("<title>");
    expect(doc).toContain("@media print");
    // Same composed content as the email body.
    expect(doc).toContain("48% (12 of 25 people active)");
    expect(doc).toContain("your level held at Adopted");
  });
});
