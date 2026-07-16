import {
  Cable,
  CreditCard,
  Gauge,
  LayoutDashboard,
  ScanFace,
  Settings,
  ShieldCheck,
  UserRoundCog,
  UserRoundPlus,
  Wallet,
  Wrench,
  type LucideIcon,
} from "lucide-react";

// Config-driven navigation IA (U0.1). The item list, labels, and gating live
// here so later UI/UX phases (U1 Growth route, U3 Settings consolidation) edit
// config, not sidebar JSX. `AppSidebar` (a client component) is the sole
// consumer and renders these groups generically. Icons stay as lucide
// components on the config so the renderer stays a dumb `<item.icon />` map.
//
// W5-H dashboard-itis fold (still in force): the roster pages (/teams, /people)
// and "How scores work" (/methodology) are RETIRED from nav — routes still
// resolve, reached in ≤2 clicks from Settings / linked directly from cards.
// U0.1 extends the same "route stays alive, item leaves nav" pattern to
// **AI maturity** (/maturity) for personal orgs: the raw 0–100 diagnostic is
// demoted behind the companion surface, so personal orgs don't get a top-level
// nav slot for it (the /maturity route is untouched). Team orgs keep it.
//
// NO Connections badge (deliberate, plan U0.1 escape hatch): a sync-failure /
// expiring-renewal count would need a `connections` read the shared app-shell
// layout does not already have, i.e. an extra query STAGE on every
// authenticated page. The plan's own escape hatch says ship without the badge
// rather than pay that cost; revisit if the layout ever loads connections for
// another reason.

export type NavItem = {
  title: string;
  href: string;
  icon: LucideIcon;
};

export type NavGroupId = "primary" | "admin" | "platform";

export type NavGroup = {
  id: NavGroupId;
  label: string;
  items: NavItem[];
};

export type OrgKind = "personal" | "team" | "system";
export type OrgRole = "admin" | "member";

// Primary group — personal orgs. "Today" replaces the old "Overview" label;
// the route stays `/dashboard` (R10: bookmarks, digest CTAs, and the §14
// `companion_revisit` metric all point there). No "Growth" item yet — `/growth`
// does not exist until phase U1, which will add exactly one entry here.
const PERSONAL_NAV_ITEMS: NavItem[] = [
  { title: "Today", href: "/dashboard", icon: LayoutDashboard },
  { title: "Connections", href: "/connections", icon: Cable },
  { title: "Account", href: "/account", icon: UserRoundCog },
];

// Primary group — team (and internal `system`) orgs. "Team" replaces "Overview";
// route stays `/dashboard`. AI maturity stays visible for team orgs.
const TEAM_NAV_ITEMS: NavItem[] = [
  { title: "Team", href: "/dashboard", icon: LayoutDashboard },
  { title: "AI maturity", href: "/maturity", icon: Gauge },
  { title: "Connections", href: "/connections", icon: Cable },
  { title: "Account", href: "/account", icon: UserRoundCog },
];

// Admin-only surfaces (ADR 0004): Members/Match accounts/Spend/Billing are also
// role-gated server-side (they read org data). Compliance is grouped here
// because rollout is an admin concern, but it is *static guidance with no data
// reads* (§7), so it needs no server-side gate — unlike its data-reading
// siblings. Settings hosts the org rename + visibility-mode control (ADR 0018),
// admin-only, server-gated. Custom Index Builder (/indexes) stays DEMOTED out
// of nav (W5-H) — reachable from Settings. Unchanged by U0.1.
const ADMIN_NAV_ITEMS: NavItem[] = [
  { title: "Members", href: "/members", icon: UserRoundPlus },
  { title: "Match accounts", href: "/reconcile", icon: ScanFace },
  { title: "Spend", href: "/spend", icon: Wallet },
  { title: "Billing", href: "/billing", icon: CreditCard },
  { title: "Compliance", href: "/compliance", icon: ShieldCheck },
  { title: "Settings", href: "/settings", icon: Settings },
];

// Platform-staff-only discovery link (ADR 0016) — a different axis from the
// admin group (per-org membership role): this is gated on isPlatformAdmin, never
// on org role. The /admin route re-checks via requireAdminContext; this entry is
// discovery only.
const PLATFORM_NAV_ITEMS: NavItem[] = [
  { title: "Platform admin", href: "/admin", icon: Wrench },
];

/**
 * Pure, unit-testable nav resolver. Returns the ordered, gated nav groups for a
 * given org/role/platform-admin combination. No React, no request context —
 * `AppSidebar` maps the result to Base-UI sidebar menus.
 */
export function navFor({
  orgKind,
  role,
  isPlatformAdmin,
}: {
  orgKind: OrgKind;
  role: OrgRole;
  isPlatformAdmin: boolean;
}): NavGroup[] {
  const isPersonal = orgKind === "personal";
  const groups: NavGroup[] = [
    {
      id: "primary",
      // Label preserves the prior copy: personal workspaces read
      // "Personal workspace", team/system read "Workspace".
      label: isPersonal ? "Personal workspace" : "Workspace",
      items: isPersonal ? PERSONAL_NAV_ITEMS : TEAM_NAV_ITEMS,
    },
  ];

  // Admin group gating is UNCHANGED from the pre-U0.1 sidebar: shown whenever the
  // membership role is admin, independent of org kind.
  if (role === "admin") {
    groups.push({ id: "admin", label: "Administration", items: ADMIN_NAV_ITEMS });
  }

  if (isPlatformAdmin) {
    groups.push({ id: "platform", label: "Platform", items: PLATFORM_NAV_ITEMS });
  }

  return groups;
}
