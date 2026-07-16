// Paths that must stay reachable even when the org is paywall-blocked — the
// page-shell analog of handleApi's `allowOverFreeBand` (src/lib/api-route.ts).
//
// - `/account` is the one route an over-band, un-entitled user needs to reach
//   to stop being blocked at all: deleting their account. Without this
//   exemption they'd see only the paywall and could never delete (ADR 0015).
// - `/settings` is exempt so an admin over the band can always TIGHTEN privacy
//   (switch back to team-only) — a privacy guardrail is never-cut (ADR 0018).
//   Since U3 consolidated account management AND billing under `/settings/*`,
//   this prefix exemption now ALSO keeps `/settings/profile` (delete account)
//   and `/settings/billing` (upgrade / manage subscription) reachable for an
//   over-band org — exactly the paths a blocked user needs to unblock.
//
// Pure + dependency-free so the (app) layout and its tests share one matcher.
// `/billing` is exempt ONLY because it is a 308 stub to /settings/billing
// (U3): the (app) layout renders the paywall INSTEAD of children for a
// blocked org, so without the exemption the stub's permanentRedirect never
// executes and an over-band admin's old bookmark dead-ends on the paywall
// instead of forwarding to the (exempt) billing tab.
export const PAYWALL_EXEMPT_PREFIXES = ["/account", "/settings", "/billing"] as const;

/** True when `pathname` is under a paywall-exempt prefix (boundary match, so
 *  `/settingsology` is NOT exempt). */
export function isPaywallExempt(pathname: string): boolean {
  return PAYWALL_EXEMPT_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
