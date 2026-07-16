// U4.2 Workspace-setup stepper — pure step model, resume derivation, and copy.
// No React, no server deps, so both the client flow and its unit tests import
// this directly. Copy discipline (G7 / invariant b): every string here is a
// claim surface and plain English; nothing states a behavior the app lacks.
//
// The stepper is deliberately storage-free: which step a returning user lands
// on is DERIVED at render time from existing connection/invite/visibility
// state (no new flag column, per §5.8). Users can always navigate back through
// the completed steps via the nav.

/** A workspace-org "flavor" for the stepper — the only distinction that changes
 * the step list. `team` covers every non-personal org (a team org gets the
 * extra privacy/people step). */
export type OrgKindFlavor = "personal" | "team";

/** Ordered step keys. `privacy` exists only in the team flow. */
export type SetupStepKey = "pitch" | "connect" | "privacy" | "review";

export type SetupStepMeta = {
  key: SetupStepKey;
  /** Short label shown in the stepper nav (plain English). */
  label: string;
};

/** Single source of truth for the per-step nav label. */
export const SETUP_STEP_META: Record<SetupStepKey, SetupStepMeta> = {
  pitch: { key: "pitch", label: "Meet your companion" },
  connect: { key: "connect", label: "Connect a source" },
  privacy: { key: "privacy", label: "Privacy & people" },
  review: { key: "review", label: "What you'll see" },
};

/** The ordered steps for an org flavor. Personal skips the privacy step. */
export function stepsForOrgKind(kind: OrgKindFlavor): SetupStepMeta[] {
  const keys: SetupStepKey[] =
    kind === "personal"
      ? ["pitch", "connect", "review"]
      : ["pitch", "connect", "privacy", "review"];
  return keys.map((k) => SETUP_STEP_META[k]);
}

/** Inputs the resume derivation reads — all from existing state. */
export type ResumeState = {
  kind: OrgKindFlavor;
  /** Whether the org already has a usable (non-errored, non-paused) connection
   * — i.e. the connect step is effectively done. */
  hasUsableConnection: boolean;
  /** Team only: whether the privacy/people step is already resolved — a pending
   * invite exists OR visibility was moved off the default. Members have nothing
   * to do here, so the caller passes `true` for them. Ignored for personal. */
  privacyResolved: boolean;
};

/**
 * The step index a returning user should land on: the FURTHEST incomplete step.
 * A newcomer with nothing connected starts at the top (the pitch) and walks the
 * whole flow. Once a usable connection exists the connect step is done, so we
 * jump ahead — to the privacy step (team, if unresolved) or straight to review.
 * Pure + deterministic; drives the initial render only (nav still allows going
 * back).
 */
export function deriveInitialStepIndex(state: ResumeState): number {
  const steps = stepsForOrgKind(state.kind);
  const indexOf = (key: SetupStepKey) => steps.findIndex((s) => s.key === key);

  // Newcomer: nothing connected yet → run the full flow from the pitch.
  if (!state.hasUsableConnection) return indexOf("pitch");

  // Connect done. Team orgs with an unresolved privacy step land there next.
  if (state.kind === "team" && !state.privacyResolved) return indexOf("privacy");

  // Everything ahead of review is done.
  return indexOf("review");
}

/** "What you'll see" (review) step copy — an orientation for the Today view,
 * NOT a duplicate of the connect step's honest score-timing message. */
export const REVIEW_STEP_COPY = {
  title: "What you'll see",
  personalLead:
    "Today is your home base. It opens with where you are, one clear next step, and a plain-English read on how you're using AI — drawn only from the tools you connected.",
  teamLead:
    "Today opens with a short read on how your team is using AI — aggregate by default, with one safe next action. Individual names stay hidden unless you choose otherwise in Settings.",
  /** Honest interim reminder — scores need data to land first (the detail comes
   * from the score-timing copy on the connect step; this just sets expectation). */
  timingNote:
    "Your first scores appear once a connected source has sent data. Until then, Today shows what's landed so far — never an estimate.",
  cta: "Go to Today",
  /** Shown when the user reaches review without connecting anything. */
  noConnectionNote:
    "You haven't connected a source yet. You can do that any time — Today will stay mostly empty until you do.",
} as const;

/** Privacy & people (team) step copy. */
export const PRIVACY_STEP_COPY = {
  title: "Privacy & people",
  lead:
    "Choose how much your team sees about each other, and optionally invite people. Both are optional here and can be changed any time in Settings.",
  visibilityHeading: "Who can see what",
  inviteHeading: "Invite your team",
  inviteLead:
    "Send an invite link so teammates can join this workspace. Optional — you can invite people later from Settings.",
  /** For a member (no admin controls) — read-only, honest about who decides. */
  memberNote:
    "Your workspace admin controls privacy settings and invites. Nothing for you to set up here.",
  skip: "Skip for now",
} as const;

/** Pitch step nav copy. */
export const PITCH_STEP_COPY = {
  skip: "Skip intro",
  next: "Next: connect a source",
} as const;
