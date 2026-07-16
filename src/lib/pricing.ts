// T0.6: the founder-pricing footnote can't silently drift from the enforced
// Paddle price — same pattern as FREE_TRACKED_USER_LIMIT (src/lib/entitlements.ts):
// one constant module, rendered copy composes from it instead of hardcoding
// numbers/dates independently.
//
// Pinned Paddle config (docs/approvals.md, "Paddle — catalog IDs", configured
// 2026-07-07):
//   Production price:    pri_01kwxr7mysf3s37c9tk3mmd5y6
//                         ($2.00/tracked user/mo, 200 cents USD, monthly, qty 1-10,000)
//   Production discount: dsc_01kwxr7n6f46g0dn190zvev43g
//                         (code FOUNDER, 50% off, recurring, expires 2026-08-31T23:59:59Z,
//                          Team-only, enabled_for_checkout: true — live/publicly redeemable)
//   Sandbox price:       pri_01kwxp80bbbgpaaat2501eybpb (same $2.00/mo terms)
//   Sandbox discount:    dsc_01kwxp80eny3jr72zc3qkdhh7z (same FOUNDER/50%/expiry terms)
//
// HONESTY NOTE: these constants are a MANUAL MIRROR of that Paddle dashboard
// state, not a build-time read of the Paddle API — there is no automated
// check that they still match what Paddle will actually charge at checkout.
// If the founder changes the list price, the discount percentage, or the
// promo expiry in Paddle, this file must be updated by hand, or rendered
// copy (landing page, billing page) silently drifts from what checkout
// charges. The dated export name (`FOUNDER_PROMO_EXPIRES`) exists so
// staleness past that date is visible in code/grep, not just in Paddle's
// dashboard.

/** List price, in cents, per tracked user per month (Paddle production price
 * pri_01kwxr7mysf3s37c9tk3mmd5y6 / sandbox pri_01kwxp80bbbgpaaat2501eybpb). */
export const LIST_PRICE_CENTS = 200;

/** Founder discount, as a whole-number percent off the list price (Paddle
 * discount code FOUNDER, dsc_01kwxr7n6f46g0dn190zvev43g / sandbox
 * dsc_01kwxp80eny3jr72zc3qkdhh7z). */
export const FOUNDER_DISCOUNT_PCT = 50;

/** Last day the FOUNDER discount can be redeemed (Paddle `expires_at`
 * 2026-08-31T23:59:59Z), as a YYYY-MM-DD date. */
export const FOUNDER_PROMO_EXPIRES = "2026-08-31";

function formatUsd(cents: number): string {
  const dollars = cents / 100;
  return `$${Number.isInteger(dollars) ? dollars : dollars.toFixed(2)}`;
}

function formatExpiry(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const monthName = new Date(Date.UTC(year, month - 1, day)).toLocaleDateString(
    "en-US",
    { month: "short", timeZone: "UTC" },
  );
  return `${monthName} ${day}, ${year}`;
}

/** The founder-discounted price, in cents, per tracked user per month. */
export function founderPromoPriceCents(): number {
  return Math.round(LIST_PRICE_CENTS * (1 - FOUNDER_DISCOUNT_PCT / 100));
}

/** The list price, formatted for display (e.g. "$2"). Shared by any rendered
 * copy that states the undiscounted per-tracked-user price. */
export function listPriceDisplay(): string {
  return formatUsd(LIST_PRICE_CENTS);
}

/**
 * The landing-page founder-pricing footnote, composed from the constants
 * above so the rendered copy can never drift from them. Shared by
 * `src/app/page.tsx` and `tests/pricing.test.ts` — one source of truth for
 * the string.
 */
export function founderPricingFootnote(): string {
  const promoPrice = formatUsd(founderPromoPriceCents());
  const expiry = formatExpiry(FOUNDER_PROMO_EXPIRES);
  return `Founder pricing: ${FOUNDER_DISCOUNT_PCT}% off — ${promoPrice} per tracked user — through ${expiry}.`;
}
