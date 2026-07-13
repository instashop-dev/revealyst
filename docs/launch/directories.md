# Directory submissions (backlink layer)

> **Positioning note (2026-07-13):** the standard descriptions below predate the V4 pivot
> (score-led framing). Re-cut against [Product Spec V4](../Revealyst_Product_Spec_V4.md)
> §1–§2 before submitting anywhere — directory listings are pasted verbatim and live forever.

Do these at T+7 (after launch, so listings carry real screenshots + the PH
badge). An afternoon of form-filling; each entry lists the copy variant to
paste. Base copy: `.agents/product-marketing-context.md` one-liner +
"what it does". Logo/OG assets: the landing `opengraph-image` render.

**Standard short description (≤160 chars):**
> Neutral AI-adoption analytics across Cursor, OpenAI & Claude (Copilot
> soon). Adoption, Fluency & Efficiency scores — team-level, pseudonymized,
> free for individuals.

*(If the Copilot connector ships before submitting, drop "(Copilot soon)"
and add it to the list — re-check `src/connectors/registry.ts` first.)*

**Standard long description:** landing-page hero paragraph + the three scores
+ pricing line (Personal free forever · Team $2/tracked user, free ≤5).

## Tier 1 — do these (dev/SaaS audiences, real referral traffic)
| Directory | Notes |
|---|---|
| Product Hunt | Covered by the launch itself; claim the permanent listing, add topics: Analytics, Developer Tools, SaaS |
| AlternativeTo | List as alternative to: Worklytics, Jellyfish, WakaTime — mirrors the competitive frame; honest "different focus" notes per alternative |
| G2 | Category: Software Analytics / Engineering Analytics. Needed early: G2 profile is what procurement googles; reviews come from dogfooding users (ask, don't incentivize — G2 rules) |
| Capterra / GetApp (Gartner network) | One submission covers the network |
| SaaSHub | Fast, free, decent dev traffic |
| BetaList | Only if submitted BEFORE full launch (they want pre-launch); decide at T-7 |
| Indie Hackers products page | Pairs with the build-in-public post |
| Uneed / Peerlist Launchpad | Lightweight PH-alikes, cheap wins in launch week |

## Tier 2 — nice-to-have (do opportunistically)
| Directory | Notes |
|---|---|
| StackShare | Tool profile; fits the dev-tool identity |
| Slant / ToolFinder | Answer-style listings, long-tail SEO |
| There's An AI For That + AI tool directories | High volume, low intent — worth one batch pass for backlinks only |
| SaaSworthy / Crozdesk / Software Advice | Aggregators; fill from the standard copy |
| EU-startups / EU SaaS lists | Matches the EU-safe positioning; look for German works-council/HR-tech adjacent lists — differentiated audience |

## Explicitly skip
- Paid "featured" slots anywhere (no budget case pre-revenue).
- Employee-monitoring / workforce-analytics directories — being listed next to
  bossware contradicts §2 positioning ("not employee monitoring") even if the
  traffic converts. The category we refuse is part of the product.

## Tracking
Every submission uses the landing URL with `?ref=<directory>`; record
submission date + listing URL in this file as they go live (append a Log
section). Backlink value is the point; referral signups are a bonus read from
launch:metrics/AE.
