import { describe, expect, it } from "vitest";
import {
  deriveInitialStepIndex,
  derivePrivacyResolved,
  PITCH_STEP_COPY,
  PRIVACY_STEP_COPY,
  REVIEW_STEP_COPY,
  stepsForOrgKind,
} from "./onboarding-stepper";

// U4.2 — the stepper is storage-free: the starting step is derived from
// existing connection/invite/visibility state. These pin the resume rules and
// the anti-gamification banned-phrasing sweep on the new copy.

describe("stepsForOrgKind", () => {
  it("personal orgs get 3 steps (no privacy step)", () => {
    expect(stepsForOrgKind("personal").map((s) => s.key)).toEqual([
      "pitch",
      "connect",
      "review",
    ]);
  });

  it("team orgs get 4 steps with privacy before review", () => {
    expect(stepsForOrgKind("team").map((s) => s.key)).toEqual([
      "pitch",
      "connect",
      "privacy",
      "review",
    ]);
  });
});

describe("deriveInitialStepIndex — resume", () => {
  it("a newcomer with no connection starts at the pitch (step 1)", () => {
    expect(
      deriveInitialStepIndex({
        kind: "personal",
        hasUsableConnection: false,
        privacyResolved: false,
      }),
    ).toBe(0);
    // Same for a team newcomer.
    expect(
      deriveInitialStepIndex({
        kind: "team",
        hasUsableConnection: false,
        privacyResolved: false,
      }),
    ).toBe(0);
  });

  it("a connected personal org jumps to the review step", () => {
    const steps = stepsForOrgKind("personal");
    const idx = deriveInitialStepIndex({
      kind: "personal",
      hasUsableConnection: true,
      privacyResolved: true,
    });
    expect(steps[idx].key).toBe("review");
    // The review step's label is "What you'll see".
    expect(steps[idx].label).toBe("What you'll see");
  });

  it("a connected team org WITHOUT invites/visibility lands on the privacy step", () => {
    const steps = stepsForOrgKind("team");
    const idx = deriveInitialStepIndex({
      kind: "team",
      hasUsableConnection: true,
      privacyResolved: false,
    });
    expect(steps[idx].key).toBe("privacy");
  });

  it("a connected team org WITH privacy resolved skips past to review", () => {
    const steps = stepsForOrgKind("team");
    const idx = deriveInitialStepIndex({
      kind: "team",
      hasUsableConnection: true,
      privacyResolved: true,
    });
    expect(steps[idx].key).toBe("review");
  });
});

describe("derivePrivacyResolved — Fix 2 (accepted invites count)", () => {
  it("a fresh admin-only org with default visibility is UNRESOLVED", () => {
    expect(
      derivePrivacyResolved({
        otherMemberCount: 0,
        pendingInviteCount: 0,
        visibilityChanged: false,
      }),
    ).toBe(false);
  });

  it("an ACCEPTED invite (another member) + default visibility resolves it", () => {
    // The regression: an accepted invite disappears from listPending, but it
    // becomes an org_members row — so the member count resolves the step even
    // with no pending invites and the default private visibility.
    expect(
      derivePrivacyResolved({
        otherMemberCount: 1,
        pendingInviteCount: 0,
        visibilityChanged: false,
      }),
    ).toBe(true);
  });

  it("an outstanding pending invite resolves it", () => {
    expect(
      derivePrivacyResolved({
        otherMemberCount: 0,
        pendingInviteCount: 1,
        visibilityChanged: false,
      }),
    ).toBe(true);
  });

  it("moving visibility off the default resolves it", () => {
    expect(
      derivePrivacyResolved({
        otherMemberCount: 0,
        pendingInviteCount: 0,
        visibilityChanged: true,
      }),
    ).toBe(true);
  });
});

describe("stepper copy — anti-gamification banned phrasing (R12)", () => {
  it("contains no XP/streak/league/points/badge/level-up language", () => {
    const allCopy = [
      ...Object.values(PITCH_STEP_COPY),
      ...Object.values(PRIVACY_STEP_COPY),
      ...Object.values(REVIEW_STEP_COPY),
      ...stepsForOrgKind("team").map((s) => s.label),
    ]
      .join(" ")
      .toLowerCase();

    for (const word of ["streak", "league", "leaderboard", "badge", "level up", "level-up"]) {
      expect(allCopy.includes(word), `banned word "${word}"`).toBe(false);
    }
    for (const word of ["xp", "points"]) {
      expect(new RegExp(`\\b${word}\\b`, "i").test(allCopy), `banned "${word}"`).toBe(false);
    }
  });
});
