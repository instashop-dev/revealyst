import { permanentRedirect } from "next/navigation";

export const dynamic = "force-dynamic";

// /billing consolidated under /settings/billing (U3). Kept as a 308 so old
// links keep resolving. NOTE: unlike /settings, /billing is NOT paywall-exempt
// — an over-band org now reaches billing via /settings/billing (which IS
// exempt), so nothing links here for a blocked org.
export default function BillingRedirect() {
  permanentRedirect("/settings/billing");
}
