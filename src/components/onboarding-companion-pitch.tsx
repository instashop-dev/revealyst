import { ShieldCheck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { ONBOARDING_PITCH_COPY } from "@/lib/companion-glossary";

/**
 * The onboarding INVERSION (W5-C deliverable 5 / errata §1.2(2)): a
 * companion-pitch screen that comes BEFORE the connect cards. Instead of
 * opening on "Connect your AI tools" (a demand), the flow now opens on what the
 * companion is and why it's safe — then the connect cards follow below. The
 * three privacy points are real, code-backed ENFORCEMENT controls (verified
 * against src/lib/agent-ingest.ts's 128-char dim bound and
 * docs/connector-facts.md's on-device allowlist), stated honestly and without
 * hyperbole (W3-N content rule). Server-safe, pure copy.
 */
export function OnboardingCompanionPitch() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <div className="flex flex-col gap-3 text-center">
        <h1 className="font-heading text-2xl font-semibold tracking-tight text-balance">
          {ONBOARDING_PITCH_COPY.headline}
        </h1>
        <p className="text-balance text-muted-foreground">
          {ONBOARDING_PITCH_COPY.subhead}
        </p>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-4 py-6">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-primary" aria-hidden="true" />
            <span className="text-sm font-medium">
              {ONBOARDING_PITCH_COPY.privacyHeading}
            </span>
          </div>
          <ul className="flex flex-col gap-4">
            {ONBOARDING_PITCH_COPY.privacyPoints.map((point) => (
              <li key={point.title} className="flex flex-col gap-1">
                <p className="text-sm font-medium">{point.title}</p>
                <p className="text-sm text-muted-foreground">{point.body}</p>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
