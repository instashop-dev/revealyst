import { permanentRedirect } from "next/navigation";

export const dynamic = "force-dynamic";

// /billing consolidated under /settings/billing (U3). Kept as a 308 so old
// links keep resolving. /billing is paywall-exempt (see paywall-exempt.ts):
// the (app) layout renders the paywall INSTEAD of children for a blocked org,
// so this stub must be exempt or its redirect never executes and an over-band
// admin's old bookmark dead-ends on the paywall instead of the billing tab.
export default function BillingRedirect() {
  permanentRedirect("/settings/billing");
}
