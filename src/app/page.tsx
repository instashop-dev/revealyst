import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  EyeOff,
  FileSearch,
  KeyRound,
  Scale,
  ShieldCheck,
  Unplug,
} from "lucide-react";
import "@/connectors";
import { registeredVendors } from "@/connectors/registry";
import type { VendorId } from "@/contracts/attribution";
import { FREE_TRACKED_USER_LIMIT } from "@/lib/entitlements";
import { BrandMark } from "@/components/brand-mark";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ScoreCardMock } from "@/components/marketing/score-card-mock";
import { Section } from "@/components/marketing/section";
import { trackLaunchEvent } from "@/lib/launch-events";
import { NLV_PENDING_VENDORS } from "@/lib/vendor-connect-meta";
import { VENDOR_LABELS, vendorLabel } from "@/lib/vendor-labels";

// Request-rendered so the landing_view event fires per visit (§15). The page
// itself reads no data — the only per-request work is the event write.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Revealyst — see who's actually adopting AI, and how well",
  description:
    "Neutral, cross-tool AI adoption analytics. Revealyst turns the admin APIs of Cursor, OpenAI, and Anthropic — plus Claude Code — into Adoption, Fluency, and Efficiency scores your board will believe. Team-level, pseudonymized, no prompt content.",
  openGraph: {
    title: "Revealyst — see who's actually adopting AI, and how well",
    description:
      `Neutral, cross-tool AI adoption analytics with versioned, inspectable scoring. Free for individuals and teams up to ${FREE_TRACKED_USER_LIMIT} tracked users.`,
  },
  twitter: {
    card: "summary_large_image",
    title: "Revealyst — see who's actually adopting AI, and how well",
  },
};

// The "Connects" strip derives from the live connector registry so marketing
// can never advertise a connector that doesn't exist (plus the Claude Code
// local agent, which ingests via the desktop companion, not polling).
// Everything else in the frozen vendor enum is shown honestly as "soon" —
// including NLV_PENDING_VENDORS: connectors that are code-complete and
// registered but whose live integration is still founder-gated (NLV run +
// deploy secrets). Statically held in "Soon" here — the marketing page stays
// statically renderable, so no runtime env check; the founder flip after NLV
// is one line in src/lib/vendor-connect-meta.ts (ADR 0022).
const CONNECTED_TOOLS = [
  ...registeredVendors()
    .filter((v) => !NLV_PENDING_VENDORS.includes(v))
    .map(vendorLabel),
  VENDOR_LABELS.claude_code_local,
];
const COMING_TOOLS = (Object.keys(VENDOR_LABELS) as VendorId[])
  .filter(
    (v) =>
      v !== "claude_code_local" &&
      (!registeredVendors().includes(v) || NLV_PENDING_VENDORS.includes(v)),
  )
  .map(vendorLabel);

const SCORES = [
  {
    name: "Adoption",
    question: "Who's actually using AI — and who isn't?",
    detail:
      "Active days and tool coverage across everything you've connected, segmented from Skeptics to AI Natives. The people quietly not using the seats you pay for show up here.",
    components: ["active days", "tool coverage"],
    flagship: false,
  },
  {
    name: "Fluency",
    question: "How well are they using it?",
    detail:
      "The flagship. Breadth of features used, depth of engagement, and effectiveness — measured from behavioral signals like acceptance rates, never from prompt content.",
    components: ["breadth", "depth", "effectiveness"],
    flagship: true,
  },
  {
    name: "Efficiency",
    question: "Are we getting our money's worth?",
    detail:
      "Value signals per unit of spend — the one place cost data does real work. Consolidated across every tool, so the answer is one number, not four dashboards.",
    components: ["output / spend", "engagement / spend"],
    flagship: false,
  },
];

const ATTRIBUTION_LADDER = [
  {
    level: "Person-level",
    sources: "Cursor · Claude Code",
    note: "Full per-person truth: the vendor reports real individuals.",
  },
  {
    level: "Key / project-level",
    sources: "OpenAI · Anthropic API",
    note: "Truth per key or project. Per-person only when you issue per-user keys — and we tell you so.",
  },
  {
    level: "Account-level",
    sources: "Shared logins",
    note: "Individuals genuinely indistinguishable. Reported as an account, flagged — and never billed as people.",
  },
];

const PRIVACY_POINTS = [
  {
    icon: EyeOff,
    title: "Pseudonymized, team-level by default",
    detail:
      "Individual identities appear only if an org admin explicitly changes the visibility mode — never silently. Individual self-view is the free Personal mode, where you are your own data subject.",
  },
  {
    icon: ShieldCheck,
    title: "No prompt content. Ever.",
    detail:
      "Scores use only behavioral signals the vendor APIs already expose — acceptance rates, engaged days, feature breadth. Nothing your people type is read.",
  },
  {
    icon: Unplug,
    title: "No extension, no proxy",
    detail:
      "Ingestion is admin APIs and keys you control. We rejected browser extensions outright — that's monitoring, and it's not the product.",
  },
  {
    icon: FileSearch,
    title: "Compliance guidance included",
    detail:
      "DPIA template, works-council notification note, and AI Act checklist ship inside the product. Built for EU buyers, not retrofitted.",
  },
];

const TIERS: {
  name: string;
  tagline: string;
  price: string;
  priceSuffix?: string;
  badge?: string;
  highlight?: boolean;
  features: string[];
  footnote?: string;
}[] = [
  {
    name: "Personal",
    tagline: "The free individual on-ramp — forever.",
    price: "$0",
    priceSuffix: "forever",
    features: [
      "Connect your own tools",
      "Your own Adoption + Fluency scores",
      "Shareable score card",
      "Anonymized-benchmark opt-in",
    ],
  },
  {
    name: "Team",
    tagline: "For engineering-led companies, self-serve end to end.",
    price: "$2",
    priceSuffix: "/ tracked user / mo",
    badge: `Free ≤ ${FREE_TRACKED_USER_LIMIT} tracked users`,
    highlight: true,
    features: [
      "All connectors, full history",
      "All three scores + team benchmarks",
      "Shared-account detection",
      "Privacy modes, pseudonymized default",
    ],
    footnote:
      "Founder pricing: 50% off — $1 per tracked user — through Aug 31, 2026.",
  },
  {
    name: "Enterprise",
    tagline: "For when you need the paperwork — talk to us.",
    price: "Custom",
    features: [
      "Custom DPA",
      "SSO and audit (roadmap)",
      "Org-wide connectors (roadmap)",
    ],
  },
];

export default async function Home() {
  await trackLaunchEvent("landing_view");
  return (
    <main className="flex min-h-dvh flex-col">
      {/* Hero — dark, echoing the share-card artifact. Arbitrary-value CSS
          must use the raw tokens (--background, --muted-foreground): the
          @theme-inline --color-* vars resolve at :root and ignore the
          section-level .dark override. */}
      <section className="dark relative overflow-hidden bg-background text-foreground">
        <div
          aria-hidden
          className="absolute inset-0 bg-[radial-gradient(circle_at_center,var(--muted-foreground)_1px,transparent_1px)] [background-size:28px_28px] opacity-[0.13]"
        />
        <div
          aria-hidden
          className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,transparent_30%,var(--background)_85%)]"
        />
        <div className="relative mx-auto flex w-full max-w-5xl flex-col gap-14 px-6 pt-20 pb-24 md:pt-28">
          <nav className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <BrandMark />
              <span className="font-heading text-lg font-semibold">
                Revealyst
              </span>
            </div>
            {/* All /sign-in links here are plain <a>, not <Link>: this page
                is the marketing surface (revealyst.com) and /sign-in lives on
                app.revealyst.com, so a client-side RSC navigation gets 308'd
                cross-origin and CORS-blocked. A hard navigation follows the
                worker's host redirect cleanly. Same-surface links (/legal/*)
                stay <Link>. */}
            <Button
              variant="ghost"
              nativeButton={false}
              render={<a href="/sign-in" />}
            >
              Sign in
            </Button>
          </nav>

          <div className="grid items-center gap-12 md:grid-cols-[1fr_auto]">
            <div className="flex max-w-xl flex-col gap-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
              <span className="font-mono text-xs tracking-widest text-muted-foreground uppercase">
                Neutral, cross-tool AI adoption analytics
              </span>
              <h1 className="font-heading text-4xl font-semibold tracking-tight text-balance md:text-5xl">
                See who&apos;s actually adopting AI — and how well — across all
                your AI tools.
              </h1>
              <p className="text-lg text-muted-foreground text-pretty">
                Revealyst reads the admin APIs of the AI tools you already pay
                for and turns them into Adoption, Fluency, and Efficiency
                scores you can defend. Team-level and pseudonymized by default.
                No prompt content, ever.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  size="lg"
                  nativeButton={false}
                  render={<a href="/sign-in" />}
                >
                  Get your first score — free
                  <ArrowRight data-icon="inline-end" />
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  nativeButton={false}
                  render={<Link href="#scores" />}
                >
                  How scoring works
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">
                Free for individuals — and for teams up to{" "}
                {FREE_TRACKED_USER_LIMIT} tracked users. Sign up, connect a key,
                see your first insight in minutes. No sales call.
              </p>
            </div>

            <div className="relative hidden justify-self-center md:block">
              <ScoreCardMock
                aria-hidden
                label="Team Platform"
                scoreLabel="AI Efficiency"
                value={65}
                className="absolute -top-6 -left-10 -rotate-6 opacity-50"
              />
              <ScoreCardMock
                label="taylor.codes"
                scoreLabel="AI Fluency"
                value={78}
                className="relative rotate-2 animate-in fade-in slide-in-from-bottom-6 duration-700"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t pt-6 text-sm text-muted-foreground">
            <span className="font-mono text-xs tracking-widest uppercase">
              Connects
            </span>
            {CONNECTED_TOOLS.map((tool) => (
              <span key={tool}>{tool}</span>
            ))}
            <span className="font-mono text-xs tracking-widest uppercase opacity-70">
              Soon
            </span>
            {COMING_TOOLS.map((tool) => (
              <span key={tool} className="opacity-70">
                {tool}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Problem */}
      <Section
        index="01"
        eyebrow="The dashboard problem"
        title="Every vendor gives you a dashboard. None of them answers the question."
        lead="Somebody is going to ask what the company gets for its AI spend. Per-tool dashboards can't answer it — and they were never going to."
      >
        <div className="grid gap-6 md:grid-cols-3">
          {[
            {
              title: "Four tools, four truths",
              detail:
                "Copilot, Cursor, OpenAI, and Claude each report different numbers at different granularities. Adding them up in a spreadsheet is a quarterly ritual that's stale by Tuesday.",
            },
            {
              title: "Seat ≠ person",
              detail:
                "Teams share logins and API keys. Vendor dashboards assume one seat is one human, so shared accounts silently undercount your real adoption.",
            },
            {
              title: "Graded homework",
              detail:
                "Every vendor measuring its own product's impact has the same credibility problem. No vendor will ever tell you a competitor's tool is used better.",
            },
          ].map((item) => (
            <div key={item.title} className="flex flex-col gap-2">
              <h3 className="font-heading text-lg font-semibold">
                {item.title}
              </h3>
              <p className="text-sm text-muted-foreground">{item.detail}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* How it works */}
      <Section
        index="02"
        eyebrow="How it works"
        title="Connect. Backfill. Score."
        lead="Self-serve from the first click: no call, no pilot, no CSV wrangling."
      >
        <ol className="grid gap-6 md:grid-cols-3">
          {[
            {
              step: "Connect",
              icon: KeyRound,
              detail:
                "Point Revealyst at the admin APIs and keys you already control — we only ever read, and credentials are envelope-encrypted at rest. Individuals connect their own keys or Claude Code logs.",
            },
            {
              step: "Backfill",
              icon: FileSearch,
              detail:
                "History is pulled and normalized onto one metrics model, with an attribution-confidence tag on every record telling you exactly what the data supports.",
            },
            {
              step: "Score",
              icon: Scale,
              detail:
                "Adoption, Fluency, and Efficiency compute from versioned definitions you can inspect — with benchmarks, so a 78 means something.",
            },
          ].map((item, i) => (
            <li key={item.step} className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <span className="font-mono text-xs text-muted-foreground">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <item.icon className="size-4 text-muted-foreground" />
                <h3 className="font-heading text-lg font-semibold">
                  {item.step}
                </h3>
              </div>
              <p className="text-sm text-muted-foreground">{item.detail}</p>
            </li>
          ))}
        </ol>
      </Section>

      {/* The three scores */}
      <Section
        id="scores"
        index="03"
        eyebrow="The three scores"
        title="Three numbers that answer the board's question."
        lead="Every score is computed from a versioned definition you can inspect. You can see which formula produced which number — and history recomputes when definitions improve."
      >
        <div className="grid gap-6 md:grid-cols-3">
          {SCORES.map((score) => (
            <Card
              key={score.name}
              className={score.flagship ? "ring-foreground/30" : undefined}
            >
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="font-heading text-xl">
                    {score.name}
                  </CardTitle>
                  {score.flagship ? <Badge>Flagship</Badge> : null}
                </div>
                <CardDescription>{score.question}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <p className="text-sm text-muted-foreground">{score.detail}</p>
                <div className="flex flex-wrap gap-2">
                  {score.components.map((component) => (
                    <Badge key={component} variant="outline">
                      {component}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </Section>

      {/* Attribution honesty */}
      <Section
        index="04"
        eyebrow="Attribution honesty"
        title="Numbers you can defend, because we refuse to invent them."
        lead="Every metric carries an attribution-confidence tag: the granularity the data honestly supports. When it only supports key-level truth, that's what you see. Revealyst never fabricates per-user numbers — a gap is shown as a gap, not a guess."
      >
        <div className="flex flex-col overflow-hidden rounded-xl border">
          {ATTRIBUTION_LADDER.map((rung) => (
            <div
              key={rung.level}
              className="grid gap-2 border-b bg-card p-5 last:border-b-0 md:grid-cols-[10rem_14rem_1fr] md:items-baseline md:gap-6"
            >
              <span className="font-mono text-sm font-medium">
                {rung.level}
              </span>
              <span className="text-sm text-muted-foreground">
                {rung.sources}
              </span>
              <span className="text-sm text-muted-foreground">{rung.note}</span>
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-2 rounded-xl border bg-muted/50 p-6 md:flex-row md:items-center md:justify-between md:gap-6">
          <blockquote className="font-heading text-xl font-medium text-balance">
            “You think 12 people use AI. The pattern says it&apos;s more.”
          </blockquote>
          <p className="max-w-md text-sm text-muted-foreground">
            Shared-account detection flags round-the-clock seats and outlier
            volume — so you learn adoption is undercounted, sharing is
            violating vendor ToS, and shared credentials are an exposure.
          </p>
        </div>
      </Section>

      {/* Privacy */}
      <Section
        index="05"
        eyebrow="Privacy model"
        title="Built to pass the works-council test."
        lead="Scoring people is near the EU AI Act line even without reading content — so privacy is architecture here, not a settings page."
      >
        <div className="grid gap-6 md:grid-cols-2">
          {PRIVACY_POINTS.map((point) => (
            <div key={point.title} className="flex gap-4">
              <point.icon className="mt-1 size-5 shrink-0 text-muted-foreground" />
              <div className="flex flex-col gap-1">
                <h3 className="font-heading text-base font-semibold">
                  {point.title}
                </h3>
                <p className="text-sm text-muted-foreground">{point.detail}</p>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* Personal mode / share loop */}
      <Section
        index="06"
        eyebrow="Personal mode"
        title="Start with your own score."
        lead="Revealyst is free forever for individuals. Connect your own API keys or Claude Code, get your own Adoption and Fluency scores, and — if you choose — share the card."
      >
        <div className="flex flex-col items-start gap-8 md:flex-row md:items-center md:gap-14">
          <ScoreCardMock
            label="you"
            scoreLabel="AI Fluency"
            value={78}
            className="shrink-0 -rotate-2"
          />
          <div className="flex max-w-md flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              The score card is opt-in and shows exactly one thing: the label
              you chose and your featured score. No email, no employer, no
              history. Revoke the link any time.
            </p>
            <p className="text-sm text-muted-foreground">
              Curious how you compare? Opt into anonymized benchmarks to help
              build the published comparison set — verified industry norms
              appear alongside your scores as they land.
            </p>
            <Button
              variant="outline"
              nativeButton={false}
              render={<a href="/sign-in" />}
              className="self-start"
            >
              Test your AI fluency
              <ArrowRight data-icon="inline-end" />
            </Button>
          </div>
        </div>
      </Section>

      {/* Pricing */}
      <Section
        index="07"
        eyebrow="Pricing"
        title="The cheapest answer in the category, on purpose."
        lead="Value scales with headcount, so pricing is per tracked user — an identity-resolved person with real usage in the period. Unresolved keys and shared accounts are surfaced, never billed."
      >
        <div className="grid gap-6 md:grid-cols-3">
          {TIERS.map((tier) => (
            <Card
              key={tier.name}
              className={tier.highlight ? "ring-foreground/30" : undefined}
            >
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="font-heading text-xl">
                    {tier.name}
                  </CardTitle>
                  {tier.badge ? <Badge>{tier.badge}</Badge> : null}
                </div>
                <CardDescription>{tier.tagline}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="flex items-baseline gap-1">
                  <span className="font-heading text-4xl font-semibold">
                    {tier.price}
                  </span>
                  {tier.priceSuffix ? (
                    <span className="text-sm text-muted-foreground">
                      {tier.priceSuffix}
                    </span>
                  ) : null}
                </div>
                <ul className="flex flex-col gap-2 text-sm text-muted-foreground">
                  {tier.features.map((line) => (
                    <li key={line} className="flex gap-2">
                      <Check className="mt-0.5 size-4 shrink-0" />
                      {line}
                    </li>
                  ))}
                </ul>
                {tier.footnote ? (
                  <p className="rounded-lg border bg-muted/50 p-3 text-xs text-muted-foreground">
                    {tier.footnote}
                  </p>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Billing is handled by Paddle as merchant of record — sales tax and
          VAT are collected and remitted for you, worldwide.
        </p>
      </Section>

      {/* Final CTA — dark, mirroring the hero */}
      <section className="dark border-t bg-background text-foreground">
        <div className="mx-auto flex w-full max-w-5xl flex-col items-center gap-6 px-6 py-24 text-center">
          <h2 className="font-heading text-3xl font-semibold tracking-tight text-balance md:text-4xl">
            The board is going to ask. Answer with numbers.
          </h2>
          <p className="max-w-xl text-muted-foreground text-pretty">
            Who&apos;s using AI, how well, and whether it&apos;s worth the
            spend — measured neutrally across every tool you run, in minutes.
          </p>
          <Button
            size="lg"
            nativeButton={false}
            render={<a href="/sign-in" />}
          >
            Get your first score — free
            <ArrowRight data-icon="inline-end" />
          </Button>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t">
        <div className="mx-auto flex w-full max-w-5xl flex-col items-center justify-between gap-4 px-6 py-10 text-sm text-muted-foreground md:flex-row">
          <div className="flex items-center gap-2">
            <BrandMark size="sm" />
            <span>Revealyst</span>
          </div>
          <div className="flex gap-6">
            <Link href="/legal/terms" className="hover:text-foreground">
              Terms
            </Link>
            <Link href="/legal/privacy" className="hover:text-foreground">
              Privacy
            </Link>
            <a href="/sign-in" className="hover:text-foreground">
              Sign in
            </a>
          </div>
        </div>
      </footer>
    </main>
  );
}
