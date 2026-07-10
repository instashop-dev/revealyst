import type { VisibilityMode } from "./visibility";

// Playbook-at-the-toggle content (Spec V3 §9.1; readiness framing §6.3 / §7).
// Single source of truth for how the three visibility modes are described to
// an admin BEFORE they flip the switch. Grounded in what the code actually
// does (src/lib/visibility.ts `toPersonRef`): `private` nulls every real name;
// `managed` and `full` both pass real display names through where a connector
// provides them. We do NOT claim a technical access difference between managed
// and full that the data layer doesn't enforce (invariant b) — they differ in
// governance posture, not in what Revealyst reveals. The privacy-material line
// is Private vs not-Private.

export const VISIBILITY_MODES: readonly VisibilityMode[] = [
  "private",
  "managed",
  "full",
] as const;

export type VisibilityModeInfo = {
  mode: VisibilityMode;
  /** Short label used in headings and the dashboard "Privacy mode" row. */
  label: string;
  /** One-line summary of the posture. */
  tagline: string;
  /** What flipping to this mode reveals — shown before the switch. */
  reveals: string;
  /** True for the EU-safe default (team-only pseudonymized). */
  euSafe: boolean;
  /** True when this mode surfaces real individual identities. */
  revealsNames: boolean;
};

export const VISIBILITY_MODE_INFO: Record<VisibilityMode, VisibilityModeInfo> = {
  private: {
    mode: "private",
    label: "Private — team-level, pseudonymized",
    tagline: "The EU-safe default. Nothing here identifies an individual.",
    reveals:
      "Scores and activity are shown at the team and segment level only. Every person appears as a stable pseudonym — real names are never displayed to anyone, in any surface.",
    euSafe: true,
    revealsNames: false,
  },
  managed: {
    mode: "managed",
    label: "Managed visibility",
    tagline: "Real names, once you've done the governance groundwork.",
    reveals:
      "Real display names appear across the workspace wherever a connected tool provides them — the same surfaces as Full visibility. Choose this only after meeting your notification and consultation obligations (see the readiness checklist). Scores stay framed as self-coaching — never a manager leaderboard.",
    euSafe: false,
    revealsNames: true,
  },
  full: {
    mode: "full",
    label: "Full visibility",
    tagline: "The most open mode — real names across the workspace.",
    reveals:
      "Real display names appear across the workspace wherever a tool provides them. Appropriate only where every tracked person has been notified. Like Managed, this surfaces real identities; it differs in how open you choose to be, not in additional data Revealyst can access.",
    euSafe: false,
    revealsNames: true,
  },
};

/**
 * Visibility-readiness playbook (§6.3 / §7). Surfaces at the toggle when an
 * admin switches AWAY from team-only (private → managed/full) — the
 * consent / works-council / DPIA framing they must satisfy first. Static
 * guidance, not legal advice; framed as onboarding help (turning the
 * compliance burden into product value, §7).
 */
export const VISIBILITY_READINESS_STEPS: readonly string[] = [
  "Notify the people being measured. In the EU, employee monitoring capability triggers notification duties before any individual data is surfaced — not after.",
  "Where a works council or employee representative body exists (e.g. §87 BetrVG in Germany), complete co-determination consultation. This is triggered by the monitoring capability itself.",
  "Record the basis in a DPIA. Surfacing named individual AI-usage scores is workplace evaluation of employees under the EU AI Act — document purpose, proportionality, and safeguards.",
  "Prefer per-user API keys and Team/Business plans over shared logins, so the names you reveal map to real individuals rather than shared accounts (the visibility-readiness onboarding, §6.3).",
  "Remember it's reversible. You can switch back to Private at any time and real names stop being displayed immediately.",
] as const;

/** True when moving from `from` to `to` loosens privacy (reveals real names) —
 * i.e. leaves team-only. Only this direction needs the readiness confirmation;
 * tightening (→ private) never does. */
export function loosensPrivacy(from: VisibilityMode, to: VisibilityMode): boolean {
  return !VISIBILITY_MODE_INFO[from].revealsNames &&
    VISIBILITY_MODE_INFO[to].revealsNames;
}
