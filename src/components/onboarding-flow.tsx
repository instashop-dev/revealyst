"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowRight, ShieldCheck, UsersRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { OnboardingCompanionPitch } from "@/components/onboarding-companion-pitch";
import { OnboardingWizard } from "@/components/onboarding-wizard";
import { SetupStepper } from "@/components/setup-stepper";
import { InviteMemberDialog } from "@/components/invite-member-dialog";
import { VisibilityModeControl } from "@/components/settings/visibility-mode-control";
import type { VisibilityMode } from "@/lib/visibility";
import { VISIBILITY_MODE_INFO } from "@/lib/visibility-playbook";
import {
  deriveInitialStepIndex,
  type OrgKindFlavor,
  PITCH_STEP_COPY,
  PRIVACY_STEP_COPY,
  REVIEW_STEP_COPY,
  stepsForOrgKind,
} from "@/lib/onboarding-stepper";

type InitialConnection = {
  id: string;
  vendor: string;
  status: "pending" | "active" | "paused" | "error";
};

/**
 * U4.2 — the workspace-setup stepper flow. Wraps the shipped pitch + connect
 * wizard in a minimal, resumable stepper and adds the team-only "Privacy &
 * people" step. Storage-free: the starting step is DERIVED on the server from
 * existing connection/invite/visibility state (`initialStepIndex`); from there
 * the user can move forward via each step's CTA or back via the nav.
 *
 * The honest "when you'll see scores" interim messaging stays on the connect
 * step (OnboardingWizard's end-state) and, post-connect, on the dashboard
 * (OnboardingInterim) — this flow never duplicates it.
 */
export function OnboardingFlow({
  orgKind,
  isAdmin,
  visibilityMode,
  copilotAvailable,
  initialConnections,
  initialStepIndex,
  privacyResolved,
}: {
  orgKind: OrgKindFlavor;
  isAdmin: boolean;
  visibilityMode: VisibilityMode;
  copilotAvailable: boolean;
  initialConnections: InitialConnection[];
  initialStepIndex: number;
  privacyResolved: boolean;
}) {
  const steps = useMemo(() => stepsForOrgKind(orgKind), [orgKind]);
  const [index, setIndex] = useState(initialStepIndex);

  const stepKey = steps[index]?.key ?? "review";
  const goNext = () => setIndex((i) => Math.min(i + 1, steps.length - 1));

  const hasUsableConnection = initialConnections.some(
    (c) => c.status !== "error" && c.status !== "paused",
  );

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8">
      <SetupStepper steps={steps} currentIndex={index} onSelect={setIndex} />

      {stepKey === "pitch" ? (
        <div className="flex flex-col gap-6">
          <OnboardingCompanionPitch />
          <div className="mx-auto flex w-full max-w-2xl flex-wrap items-center justify-center gap-2">
            <Button size="lg" onClick={goNext}>
              {PITCH_STEP_COPY.next}
              <ArrowRight data-icon="inline-end" />
            </Button>
            <Button variant="ghost" size="lg" onClick={goNext}>
              {PITCH_STEP_COPY.skip}
            </Button>
          </div>
        </div>
      ) : null}

      {stepKey === "connect" ? (
        <OnboardingWizard
          initialConnections={initialConnections}
          copilotAvailable={copilotAvailable}
          continueTo={{
            // Team → Privacy & people; personal → What you'll see.
            label:
              orgKind === "team"
                ? "Next: privacy & people"
                : "Next: what you'll see",
            onContinue: goNext,
          }}
        />
      ) : null}

      {stepKey === "privacy" ? (
        <PrivacyStep
          isAdmin={isAdmin}
          visibilityMode={visibilityMode}
          onNext={goNext}
        />
      ) : null}

      {stepKey === "review" ? (
        <ReviewStep orgKind={orgKind} hasUsableConnection={hasUsableConnection} />
      ) : null}
    </div>
  );
}

/** Team-only privacy + invite step. Admin gets the interactive controls; a
 * member sees an honest read-only note (the visibility API is admin-gated). */
function PrivacyStep({
  isAdmin,
  visibilityMode,
  onNext,
}: {
  isAdmin: boolean;
  visibilityMode: VisibilityMode;
  onNext: () => void;
}) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2 text-center">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          {PRIVACY_STEP_COPY.title}
        </h1>
        <p className="text-balance text-muted-foreground">
          {PRIVACY_STEP_COPY.lead}
        </p>
      </div>

      {isAdmin ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ShieldCheck className="size-4 text-primary" aria-hidden="true" />
                {PRIVACY_STEP_COPY.visibilityHeading}
              </CardTitle>
              <CardDescription>
                Private is the default — nothing here identifies an individual.
                You can change this any time in Settings.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <VisibilityModeControl current={visibilityMode} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <UsersRound className="size-4 text-primary" aria-hidden="true" />
                {PRIVACY_STEP_COPY.inviteHeading}
              </CardTitle>
              <CardDescription>{PRIVACY_STEP_COPY.inviteLead}</CardDescription>
            </CardHeader>
            <CardContent>
              <InviteMemberDialog />
            </CardContent>
          </Card>
        </>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {PRIVACY_STEP_COPY.visibilityHeading}
            </CardTitle>
            <CardDescription>{PRIVACY_STEP_COPY.memberNote}</CardDescription>
          </CardHeader>
          <CardContent className="text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Current privacy mode</span>
              <span className="text-right font-medium">
                {VISIBILITY_MODE_INFO[visibilityMode].label}
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button size="lg" onClick={onNext}>
          Next: what you&apos;ll see
          <ArrowRight data-icon="inline-end" />
        </Button>
        <Button variant="ghost" size="lg" onClick={onNext}>
          {PRIVACY_STEP_COPY.skip}
        </Button>
      </div>
    </div>
  );
}

/** Final "What you'll see" orientation + the CTA to Today. */
function ReviewStep({
  orgKind,
  hasUsableConnection,
}: {
  orgKind: OrgKindFlavor;
  hasUsableConnection: boolean;
}) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2 text-center">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          {REVIEW_STEP_COPY.title}
        </h1>
        <p className="text-balance text-muted-foreground">
          {orgKind === "team"
            ? REVIEW_STEP_COPY.teamLead
            : REVIEW_STEP_COPY.personalLead}
        </p>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-2 py-6 text-sm text-muted-foreground">
          <p>{REVIEW_STEP_COPY.timingNote}</p>
          {!hasUsableConnection ? (
            <p>{REVIEW_STEP_COPY.noConnectionNote}</p>
          ) : null}
        </CardContent>
      </Card>

      <div className="flex justify-center">
        <Button size="lg" nativeButton={false} render={<Link href="/dashboard" />}>
          {REVIEW_STEP_COPY.cta}
          <ArrowRight data-icon="inline-end" />
        </Button>
      </div>
    </div>
  );
}
