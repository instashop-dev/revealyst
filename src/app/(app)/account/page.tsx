import { permanentRedirect } from "next/navigation";

export const dynamic = "force-dynamic";

// /account consolidated under /settings (U3). Kept as a 308 so bookmarks and
// the account-management email links keep resolving. /account stays in the
// layout's PAYWALL_EXEMPT_PREFIXES, and /settings is exempt too, so an
// over-band user still reaches profile management (and account deletion).
export default function AccountRedirect() {
  permanentRedirect("/settings/profile");
}
