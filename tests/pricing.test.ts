import { describe, expect, it } from "vitest";
import {
  FOUNDER_DISCOUNT_PCT,
  FOUNDER_PROMO_EXPIRES,
  LIST_PRICE_CENTS,
  founderPricingFootnote,
  founderPromoPriceCents,
  listPriceDisplay,
} from "../src/lib/pricing";

// T0.6: the landing-page founder-pricing footnote must derive from these
// constants (docs/approvals.md Paddle config), never be hardcoded separately.

describe("pricing constants", () => {
  it("pins the recorded Paddle config", () => {
    expect(LIST_PRICE_CENTS).toBe(200);
    expect(FOUNDER_DISCOUNT_PCT).toBe(50);
    expect(FOUNDER_PROMO_EXPIRES).toBe("2026-08-31");
  });
});

describe("founderPromoPriceCents", () => {
  it("is $2 list x 50% off = $1 (100 cents)", () => {
    expect(founderPromoPriceCents()).toBe(100);
  });
});

describe("listPriceDisplay", () => {
  it("formats the list price as a whole dollar amount", () => {
    expect(listPriceDisplay()).toBe("$2");
  });
});

describe("founderPricingFootnote", () => {
  it("renders the exact landing-page copy", () => {
    expect(founderPricingFootnote()).toBe(
      "Founder pricing: 50% off — $1 per tracked user — through Aug 31, 2026.",
    );
  });
});
