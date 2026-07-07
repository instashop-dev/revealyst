import {
  ClipboardCheck,
  FileText,
  ScrollText,
  ShieldCheck,
  Users,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// Static guided content (Product Spec §7) — the EU-compliance onboarding
// guides. No data reads, no interactivity: turning the compliance burden into
// onboarding help is itself a selling point to EU buyers (§7). Auth + shell
// come from the (app) layout. Full text lives in docs/compliance/*.md; this
// page is the in-app summary + entry point. "Zero new software" (tripwire
// rule 7) — guidance, not a feature.

export const metadata = {
  title: "Compliance guidance · Revealyst",
};

const GUARANTEES = [
  {
    icon: Users,
    title: "Team-level, pseudonymized by default",
    body: "Individual identities are never surfaced unless an admin explicitly changes the visibility mode. Private (team-only) is the default.",
  },
  {
    icon: ShieldCheck,
    title: "No prompt content, ever",
    body: "Only behavioral usage signals the vendor APIs already expose. No content capture, no browser extension, no proxy — a hard architectural guarantee, not a setting.",
  },
  {
    icon: FileText,
    title: "Bounded retention",
    body: "Raw vendor payloads are held ~90 days for normalization replay, then purged automatically. Derived scores never include per-person numbers fabricated from shared accounts.",
  },
];

const GUIDES = [
  {
    icon: ClipboardCheck,
    title: "GDPR DPIA template",
    body: "A Data Protection Impact Assessment (Art. 35) is expected when you evaluate people at work. This pre-filled template describes how Revealyst actually processes data, so your DPO or counsel can finalize it quickly.",
    doc: "docs/compliance/dpia-template.md",
  },
  {
    icon: Users,
    title: "Works-council notification note",
    body: "In Germany, §87 BetrVG co-determination is triggered by a system's monitoring capability — before anyone opts in. This note explains why it applies, covers EU equivalents, and includes a notification template.",
    doc: "docs/compliance/works-council-notification.md",
  },
  {
    icon: ScrollText,
    title: "EU AI Act worker-notification checklist",
    body: "The AI Act treats workplace evaluation as high-risk by purpose, not by where inference runs. This checklist keeps your deployment on the low-risk path and covers the Art. 26(7) worker-notification duty.",
    doc: "docs/compliance/ai-act-worker-notification.md",
  },
];

function Guide({
  icon: Icon,
  title,
  body,
  doc,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
  doc: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="size-4 text-primary" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        <p className="mb-3">{body}</p>
        <p className="text-xs">
          Full template:{" "}
          <span className="font-medium text-foreground">{doc}</span>
        </p>
      </CardContent>
    </Card>
  );
}

export default function CompliancePage() {
  return (
    <>
      <PageHeader
        title="Compliance guidance"
        description="Scoring how people use AI is near the EU AI Act line, so Revealyst is EU-safe by design (Product Spec §7). These guides help you meet your GDPR, works-council, and AI Act obligations — turning the compliance burden into onboarding help."
      />

      <div className="mb-8 grid gap-4 sm:grid-cols-3">
        {GUARANTEES.map((g) => (
          <Card key={g.title}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <g.icon className="size-4 text-primary" />
                {g.title}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {g.body}
            </CardContent>
          </Card>
        ))}
      </div>

      <p className="mb-6 text-sm text-muted-foreground">
        These are guidance, not legal advice — the DPIA, works-council
        consultation, and worker notification are your controller obligations.
        Each guide is a starting point your DPO or counsel should finalize.
      </p>

      <div className="flex flex-col gap-4">
        {GUIDES.map((g) => (
          <Guide key={g.title} {...g} />
        ))}
      </div>

      <Card className="mt-6 border-primary/30">
        <CardHeader>
          <CardTitle className="text-base">Why this is easy with Revealyst</CardTitle>
          <CardDescription>
            The monitoring surface is deliberately narrow: team-level
            pseudonymized reporting, no content capture, no per-user fabrication,
            and individual view as opt-in self-coaching. That lets your DPIA,
            works-council agreement, and worker notice commit to concrete,
            verifiable limits instead of open-ended ones.
          </CardDescription>
        </CardHeader>
      </Card>
    </>
  );
}
