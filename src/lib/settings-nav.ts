// Config-driven Settings IA (U3, plan §5.7). One control surface under
// `/settings/*` — the tab list, labels, and role gating live here so the
// SettingsShell layout and each tab page read config, not hard-coded lists.
// This mirrors the top-level nav pattern in `nav-items.ts`: a pure,
// unit-testable resolver with no React/request context.
//
// Tabs are ROUTES, not client tabs (deep-linkable). The rail
// (`settings-tab-rail.tsx`) renders `settingsTabsFor(role)`; each admin tab's
// page keeps its own server-side role check authoritative (renders an in-place
// explanation, never a redirect, for a member who deep-links it).

export type OrgRole = "admin" | "member";

export type SettingsTabKey =
  | "profile"
  | "workspace"
  | "privacy"
  | "notifications"
  | "people"
  | "billing"
  | "advanced";

export type SettingsTab = {
  key: SettingsTabKey;
  title: string;
  href: string;
  /** Admin-only tabs are hidden from the member rail and render an in-place
   *  explanation if a member deep-links them. Profile + Notifications are the
   *  everyone tabs. */
  adminOnly: boolean;
};

export const SETTINGS_TABS: readonly SettingsTab[] = [
  { key: "profile", title: "Profile", href: "/settings/profile", adminOnly: false },
  { key: "workspace", title: "Workspace", href: "/settings/workspace", adminOnly: true },
  { key: "privacy", title: "Privacy", href: "/settings/privacy", adminOnly: true },
  {
    key: "notifications",
    title: "Notifications",
    href: "/settings/notifications",
    adminOnly: false,
  },
  { key: "people", title: "People", href: "/settings/people", adminOnly: true },
  { key: "billing", title: "Billing", href: "/settings/billing", adminOnly: true },
  { key: "advanced", title: "Advanced", href: "/settings/advanced", adminOnly: true },
] as const;

/**
 * Ordered, role-gated tab list for the rail. A member sees Profile +
 * Notifications; an admin sees all seven.
 */
export function settingsTabsFor(role: OrgRole): SettingsTab[] {
  return SETTINGS_TABS.filter((tab) => role === "admin" || !tab.adminOnly);
}

// Copy that only Settings uses, kept here so it has a single source and the
// banned-phrasing sweep can cover it in one place.
export const SETTINGS_COPY = {
  // Shown in place of an admin tab's controls to a member who deep-links it —
  // an explanation, never a hidden route with no trace (plan §5.7 states copy).
  adminOnly: {
    title: "Admins only",
    body: "Only workspace admins can change this. Ask an admin.",
  },
  // Plain-English "tracked user" definition rendered next to the billing usage
  // meter. Sourced from the frozen billing primitive's language
  // (src/contracts/tracked-user.ts): a person with activity in the period;
  // unresolved accounts are surfaced but never billed.
  trackedUserDefinition:
    "A tracked user is a person with AI activity in the period. Accounts we can't match to a person are shown but never counted toward billing.",
} as const;
