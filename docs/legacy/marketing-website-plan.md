# Marketing Website — Implementation Plan

> **Superseded positioning (2026-07-13):** this plan predates the V4 pivot
> ([Product Spec V4](../Revealyst_Product_Spec_V4.md) §1–§2). Its "Fluency (flagship)" score-led
> messaging hierarchy and CTO-buyer persona table are retired — V4 leads with the Personal AI
> Companion and demotes the raw score to a diagnostic. The build/SEO mechanics stand; rework
> every message/persona section against Spec V4 before implementation.

Status: planned, not started. Scope: the public marketing website for Revealyst, built inside this repo as static-prerendered pages on the existing Next.js / OpenNext / Cloudflare Workers deployment. Sibling plan: `docs/documentation-plan.md` (public `/docs`) — this plan owns the shared SEO infrastructure (metadataBase, sitemap, robots, icons) since it lands first; the docs plan's PR 5 shrinks to appending `DOCS_FLAT` to the sitemap.

## 1. Product Analysis

**Product summary.** Revealyst is neutral, cross-tool AI adoption + fluency analytics: it reads the admin APIs of the AI tools a company already pays for (Anthropic Console, OpenAI, Cursor, Claude Code local agent; GitHub Copilot and Claude Enterprise "Soon") and turns usage telemetry into three inspectable, versioned scores — **Adoption**, **Fluency** (flagship: breadth/depth/effectiveness), **Efficiency** — with benchmarks. Category: AI enablement / adoption analytics. Explicitly NOT FinOps, NOT employee monitoring.

**Target audience.**
- Buyer: CTO / VP Eng / technical founder at engineering-led companies, 25–200 employees (V1 beachhead; enterprise 5000+ explicitly out of scope).
- Champion/user: individual developer (free Personal mode — same machinery, org-of-one).
- Technical influencer (EU): works council / DPO — the privacy architecture is the answer to their veto.
- Anti-persona: anyone wanting prompt-content review of employees (refused by design).

**Primary use cases.** (1) Consolidated cross-tool AI spend + adoption view within ~10 minutes of self-serve signup. (2) Team fluency benchmarking. (3) Shared-account detection ("you think 12 people use AI; the pattern suggests ~30"). (4) Individual dev checks own fluency, shares the score card (viral loop).

**Core value proposition.** Every vendor gives you a dashboard; none answers "what is the company getting for its AI spend?" Revealyst is the neutral referee — the one thing vendor-native dashboards structurally cannot copy.

**Key differentiators.** Neutral third party · Fluency Score (nobody else scores proficiency) · attribution honesty (per-record confidence tags; never fabricates per-user numbers) · shared-account detection as a feature · EU-safe by architecture (pseudonymized team default, no prompt content ever, no extension/proxy, DPIA/works-council/AI-Act guidance built in) · published versioned methodology · category price floor ($2/user vs WakaTime $8.25, Jellyfish $35–50/dev, Worklytics ~$2.5K/mo, Larridin $50K+/yr).

**Business & conversion goals** (spec §15, `.agents/product-marketing-context.md`): activation = sign up free → connect a key → first score (<10 min TTFI); secondary = share-card creation; tertiary = Personal→Team upgrade via Paddle with no founder in the loop. North Star: weekly-active-AI-user rate × fluency vs benchmark. Pre-launch: no customer metrics, logos, or testimonials exist — never fabricate any.

## 2. Website Strategy

The site's job is to let a CTO self-qualify and self-serve without a call, and to catch the individual-developer champion loop. Four purposes, in priority order:

1. **Convert** — free signup is the only conversion action (Personal or Team ≤5 free); the product is the lead capture (no email list exists at launch, per `docs/legacy/launch/launch-plan.md`).
2. **De-risk** — the buyer's two anxieties are "is this monitoring?" and "can I trust the numbers?"; `/security` and the attribution-honesty story answer them before the objection is voiced.
3. **Educate** — the scoring model is the product's credibility; marketing explains *why* (value), `/docs` explains *how* (methodology) — a deliberate split.
4. **Capture search intent** — high-intent queries ("cursor usage analytics", "AI adoption dashboard", "copilot analytics alternative") via programmatic connector pages and, later, comparison pages.

Not goals for v1: gated content, newsletter, webinars, sales-led demo funnel (no sales team; anti-pattern for a $2 PLG product).

## 3. Information Architecture

### Sitemap

```
/                        Landing (exists — refactor into (marketing) group)
/product                 Three scores in depth + how it works + attribution ladder
/pricing                 Full tiers + tracked-user semantics + FAQ
/security                Privacy architecture + EU-safe story (the DPO page)
/connectors              Index, registry-derived live/"Soon" table
/connectors/[slug]       6 programmatic vendor pages (cursor, openai, anthropic-console,
                         claude-code, github-copilot, claude-enterprise)
/personal                Free individual mode; share-card loop landing
/docs/**                 (sibling plan — cross-linked, not owned here)
/legal/terms, /legal/privacy   (exist; added to sitemap)
Deferred: /blog, /compare/*, /about
```

### Navigation

- **Header** (new `SiteHeader`, dark, brand-constant across pages): BrandMark · Product · Connectors · Pricing · Security · Docs (when live) · Sign in · primary CTA "Get your first score — free" → `/sign-in`.
- **Footer** (new `SiteFooter`): page links + Terms / Privacy / Sign in; driven by the same nav manifest (`src/lib/marketing/nav.ts`) that feeds `sitemap.ts` — nav, footer, and sitemap can't drift.
- Outside the marketing chrome by design: `/sign-in`, `/s/[token]` (chrome-free viral surface), `/legal/*` (keeps its mini-nav layout), the authenticated `(app)` shell.

### URL conventions
Lowercase kebab-case, unversioned, no trailing slashes, singular nouns for concept pages (`/product`, `/security`), plural for collections (`/connectors`). `/security` not `/privacy` (collides with `/legal/privacy`) and not `/trust` (implies a cert-bearing trust center we don't have).

### User journeys
1. **CTO from HN/PH launch:** `/` → `/security` (monitoring objection) → `/pricing` (tracked-user semantics) → sign-up. Every page ends in the CTA band.
2. **Developer from a shared score card:** `/s/[token]` → "Test your AI fluency" → `/personal` → sign-up → new share card (the loop).
3. **Search-intent visitor:** `/connectors/cursor` → what data / attribution level → `/product` → sign-up.
4. **DPO/works council sent a link:** `/security` → `/legal/privacy` → `/docs/privacy-and-attribution` (when live).

### Content hierarchy
Marketing pages answer *why/what*; `/docs` answers *how*; `/legal` is the contract. Each connector topic exists at three depths with distinct intent: `/connectors/[slug]` (SEO/value), `/docs/connectors/[slug]` (setup how-to), `docs/connector-facts.md` (internal frozen source). Cross-link, self-canonical each.

**Why each page exists:** `/pricing` — highest-intent page; tracked-user billing semantics are a differentiator that needs room (and FAQPage schema). `/product` — the scoring model is the product; the landing page can only gesture at it. `/security` — the EU-safe wedge is the #1 objection and the works-council veto; burying it in a landing section wastes it. `/connectors` + vendor pages — the only scalable SEO surface pre-blog, derived from the registry so it can never overclaim. `/personal` — the viral loop needs a landing target that isn't the CTO-framed homepage. Deferred pages are deferred because: blog is blocked on the benchmark-post data (`docs/launch/benchmark-post-data-needs.md`) and on the docs MDX pipeline; `/compare/*` requires a cite-every-competitor-claim discipline worth its own PR; `/about` has nothing to say pre-launch beyond the manifesto already on `/`.

## 4. Page Plan

| Page | Purpose | Audience | Intent | Primary CTA | Key sections | Components | Depends on |
|---|---|---|---|---|---|---|---|
| `/` | Convert + orient | CTO first, dev second | evaluate | Get your first score — free | see §5 | all shared marketing components | PR 1 refactor |
| `/product` | Explain the three scores + how it works | CTO, eng manager | understand | same | scores in depth (component sub-badges), how-it-works (Connect→Backfill→Score), attribution ladder, segments, benchmarks-today (honest: seeded, not network-scale), methodology pointer → `/docs/scores` | `ScoreCards`, `AttributionLadder`, `Section`, `CtaBand` | PR 1 |
| `/pricing` | Close the highest-intent visitor | CTO | buy | Start free (Team CTA) | tiers (reuse `PricingTiers`), what a tracked user is (glossary-sourced), founder discount w/ sunset date, Paddle MoR note, FAQ from objections table | `PricingTiers`, new `pricing-facts.ts`, FAQ + FAQPage JSON-LD | PR 1, 2 |
| `/security` | Kill the monitoring objection; arm the DPO | CTO + works council/DPO | de-risk | Read the privacy policy / Start free | no-prompt-content-ever (architectural), pseudonymized team default, no extension/proxy (rejected not deferred), envelope-encrypted credentials ("we use keys read-only" — never "read-only keys"), compliance guidance (DPIA/works-council/AI-Act), Paddle MoR/VAT, data retention | `Section`, `CtaBand`; claims fact-checked vs `src/lib/credentials.ts`, privacy page | PR 1 |
| `/connectors` | SEO index + honesty proof | search visitors, evaluators | discover | Connect your first tool | live/"Soon" table derived from `registeredVendors()` + `VENDOR_LABELS`, attribution level per vendor, honesty note (individual Copilot/Cursor plans have no API — "connect when on a Team plan") | `ConnectsStrip` (extended), new `connector-slugs.ts` | PR 1, 2 |
| `/connectors/[slug]` | Capture "‹vendor› usage analytics" queries | search visitors | discover | same | what data we read, attribution rung, what we never read, spend labeled "estimated" where derived, setup pointer → `/docs/connectors/[slug]` | `generateStaticParams` over the frozen vendor enum; per-vendor OG; BreadcrumbList | `/connectors` |
| `/personal` | Land the share-card loop | individual devs | curiosity | Test your AI fluency — free | free-forever, your own scores, share card demo (`ScoreCardMock`), anonymized-benchmark opt-in, "bring it to your CTO" bridge to Team | `ScoreCardMock`, `CtaBand` | PR 1 |
| `/blog` (deferred) | Authority + long-tail SEO | all | learn | contextual | benchmark post first (blocked on data) | docs-plan MDX pipeline + `blog-posts.ts` manifest | docs PR 1, benchmark data |
| `/compare/*` (deferred) | Bottom-funnel competitor intent | CTO | compare | Start free | vs Larridin / Worklytics / vendor dashboards | cite-every-claim rule | after launch |

All pages fully static (build-time imports of registry/constants only; never import `src/lib/api-context.ts`, `headers()`, `cookies()`).

## 5. Homepage Strategy

Keep the shipped W3-P page — it converts and is claim-safe — and evolve rather than rewrite. Messaging hierarchy: (1) the category question — "See who's actually adopting AI — and how well — across all your AI tools"; (2) neutrality — vendors grade their own homework; (3) honesty — attribution ladder, gaps shown as gaps; (4) safety — EU-safe by architecture; (5) price — free to start, $2 ceiling.

Content flow (current 10 sections, retained): dark hero + `ScoreCardMock` pair + registry-derived Connects strip → 01 the dashboard problem → 02 how it works → 03 the three scores → 04 attribution honesty → 05 privacy model → 06 personal mode → 07 pricing tiers → dark final CTA ("The board is going to ask. Answer with numbers.") → footer.

Changes in this plan: extract nav out of the hero into the layout-owned `SiteHeader`; add "details →" links from sections 03/04/05/07 to `/product`, `/security`, `/pricing` (keep the full pricing tiers on `/` — don't cut a converting section to a teaser); add Organization + SoftwareApplication JSON-LD; flip to static prerender in the analytics phase (see §13).

Conversion opportunities: hero CTA, per-section deep links, pricing tiers, final CTA band — one action throughout (free signup); "How scoring works" as the low-commitment secondary. Trust-building without customers: the honesty artifacts ARE the trust elements — registry-derived Connects strip, attribution ladder, published methodology link, privacy architecture, transparent pricing with sunset-dated discount. No fabricated logos/testimonials/metrics (hard rule).

## 6. Design System

Extend, don't invent — the W1-G system is the brand.

- **Visual direction:** "instrument, not brochure." Neutral OKLCH grayscale (chroma-0; the only chromatic token is destructive red), data-forward, spec-document aesthetic (numbered sections, mono eyebrows, `tabular-nums`). Matches the plainspoken/Show-HN brand voice.
- **Layout:** `Section` component pattern (numbered index — eyebrow — H2 — lead); max-width prose columns; generous whitespace; dark sections as bookends (hero + final CTA) with light body — retained on every subpage for rhythm.
- **Typography:** Geist only (`--font-sans`; `--font-heading` aliases it); mono eyebrows via the default mono stack; `text-balance`/`text-pretty` on headings.
- **Color:** stay grayscale. Inside `.dark`-scoped sections, arbitrary-value CSS must use raw tokens (`var(--background)`) — the `@theme inline` `--color-*` vars resolve at `:root` (known W1-G trap). base-nova `Card` outlines use `ring-*`, never `border-*`.
- **Spacing:** Tailwind default scale as used today (`py-24`/`py-32` sections, `gap-6/8` grids); radius scale from `--radius: 0.625rem`.
- **Iconography:** lucide-react only, current sizing conventions.
- **Illustration:** no raster images in v1 (no image optimizer configured on Workers, no `public/` dir). Product visuals are DOM/SVG mocks — `ScoreCardMock` pattern, extended with a `DashboardMock` if needed. Screenshots are a separate later decision (OpenNext static assets + plain `<img>` or Cloudflare Images).
- **Motion:** existing `tw-animate-css` utilities (`animate-in fade-in slide-in-from-bottom`), CSS-only, respect `prefers-reduced-motion`; no motion libraries (bundle + brand).

## 7. Component Architecture

**Reuse as-is:** `ui/*` base-nova primitives (button, card, badge, separator, tooltip…), `BrandMark`, `marketing/Section`, `marketing/ScoreCardMock`.

**Extract from `src/app/page.tsx` into `src/components/marketing/`** (server components unless noted): `site-header.tsx` (nav from manifest; tiny client mobile toggle), `site-footer.tsx`, `cta-band.tsx` (dark CTA section, props for heading/body/CTA), `pricing-tiers.tsx` (TIERS + `FREE_TRACKED_USER_LIMIT` import move with it), `connects-strip.tsx` (registry derivation), `attribution-ladder.tsx`, `score-cards.tsx`. Hero stays page-inline.

**New:** `src/lib/marketing/nav.ts` (nav manifest → header/footer/sitemap), `src/lib/marketing/pricing-facts.ts` (price strings, discount % + sunset `2026-08-31`, Paddle-MoR sentence — single source so the discount can never render without its sunset date), `src/lib/marketing/connector-slugs.ts` (`Record<VendorId, string>` + reverse lookup → `generateStaticParams`/index/sitemap), `marketing/json-ld.tsx` (serializer), `marketing/og-template.tsx` (`renderOgImage({eyebrow,title})`, text-only next/og — Workers constraint), `marketing/track-view.tsx` (client `sendBeacon`, Phase 6).

## 8. Content Strategy

- **Source of truth:** `.agents/product-marketing-context.md` — personas, objections table (→ `/pricing` FAQ), customer language, glossary, words-to-use/avoid. All page copy derives from it; contradictions get fixed there first.
- **Tone:** plainspoken, technically honest, quietly confident, Show-HN-compatible; numbers over adjectives; admits limits ("connect when available", "we omit rather than estimate").
- **Messaging hierarchy:** neutrality → fluency (flagship) → honesty → EU-safety → price. Cost is a hook and denominator, never the headline (not FinOps).
- **Words to avoid (hard list):** monitoring, surveillance, tracking employees, productivity score, ROI guarantee, FinOps framing, any per-user claim about account-level data, "KMS", "read-only keys" (say "we use them read-only"), present-tense unshipped connectors.
- **Content honesty (invariant b):** every number/availability claim renders a constant or registry derivation (`FREE_TRACKED_USER_LIMIT`, `registeredVendors()`, `pricing-facts.ts`) or carries a code citation; every claim-bearing PR gets an adversarial whole-page fact-check by a reviewer who didn't write the prose (W3-N/W3-P precedent).
- **Long-form/education:** methodology depth lives in `/docs` (sibling plan) — marketing links to it as a trust asset ("scores you can interrogate"). First blog post = the W3-P benchmark post, when its data unblocks; subsequent candidates: shared-account detection write-up, EU-safe architecture deep-dive, fluency-score methodology narrative. Blog = manifest-driven MDX on the docs pipeline; no CMS (authors are agents editing the repo).
- **Documentation strategy:** owned by `docs/documentation-plan.md`; this plan only adds Docs links to header/footer once `/docs` ships.

## 9. SEO Strategy

- **Infra (this plan owns it; docs plan PR 5 drops its duplicate items):** `src/lib/site.ts` exporting `SITE_URL` (env-overridable; **now default `https://revealyst.com`** — the custom domains are attached, see `docs/infra.md` §6). Note the **host split** shipped there: `revealyst.com` = marketing (this `SITE_URL`), `app.revealyst.com` = the app/auth origin. Any cross-surface link (e.g. a marketing "Sign in" CTA) must use the origins exported from `src/lib/domains.ts` (`APP_ORIGIN`/`MARKETING_ORIGIN`), the single source of truth — do NOT hard-code either host in `site.ts` or copy. `metadataBase` in root layout; per-page `alternates.canonical`; `src/app/sitemap.ts` (nav manifest + connector slugs + `/legal/*`, extensible with `DOCS_FLAT`); `src/app/robots.ts` (disallow `/api/`, `/onboarding`, `/invite`, `/s/`, and `(app)` paths; sitemap pointer); `src/app/icon.svg` + `apple-icon.tsx` (no `public/` needed).
- **Metadata:** unique title/description per page; OG via per-route `opengraph-image.tsx` on the shared text-only template (vendor pages get labeled OG for free via `params`).
- **Structured data:** Organization + SoftwareApplication (Offer from `pricing-facts.ts`) on `/`; FAQPage on `/pricing`; BreadcrumbList on `/connectors/[slug]`. Never Review/AggregateRating (no customers — honesty rule).
- **Search-intent coverage:** category ("AI adoption analytics", "AI fluency score") → `/`, `/product`; vendor long-tail ("cursor usage analytics", "openai admin api usage") → `/connectors/[slug]`; objection queries ("is AI usage analytics GDPR compliant") → `/security`; competitor/alternative queries → deferred `/compare/*`.
- **Programmatic SEO:** connector pages are the honest programmatic surface — `generateStaticParams` over the frozen vendor enum, content from frozen `docs/connector-facts.md`. Scales automatically as connectors register. No thin-page farms.
- **AI-answer-engine readiness:** plain semantic HTML, definitional headings, the glossary rendered on `/pricing` and `/product` — the honesty/methodology positioning is inherently quotable.

## 10. Performance

- **Rendering:** everything static-prerendered at build (`○` in build output), served as OpenNext static assets — required anyway (no ISR configured). `/` stays `force-dynamic` through PR 5 (analytics event), flips to static + beacon in PR 6.
- **Images/assets:** none in v1 (DOM/SVG visuals); Geist already self-hosted via `next/font`; no third-party origins → no preconnects, no CLS from media.
- **JS budget:** RSC static HTML; client JS = mobile-menu toggle + (PR 6) `TrackView` beacon ≈ low single-digit KB. No motion/carousel libraries.
- **Worker size (10MB compressed):** near-zero runtime deps added; record the OpenNext worker-size delta in PR 1 and PR 5 descriptions (same discipline as the docs plan).
- **CWV:** LCP = hero `<h1>` text (fast); CLS ≈ 0 (fixed-dimension mocks, non-reflowing header); INP trivial. Lighthouse pass on `/` and `/pricing` at PR 6.

## 11. Accessibility

Semantic landmarks (`header/nav/main/footer`, one `h1`/page, ordered headings — the numbered-Section pattern already enforces this); skip-to-content link in the marketing layout; visible `focus-visible` rings (base-nova default — don't suppress); WCAG AA contrast (grayscale palette is safe; verify `muted-foreground`-on-dark in `.dark` sections); accessible names on icon-only controls (mobile toggle, footer icons); the attribution-ladder and pricing tables as real `<table>`/list semantics, not div grids; `prefers-reduced-motion` respected by the CSS animation utilities; OG/decorative SVGs `aria-hidden`; keyboard-operable mobile nav (Base UI primitives handle focus traps). Verify per PR with preview-deploy + axe pass in the browser.

## 12. Technical Architecture

- **Route group:** new `src/app/(marketing)/` with `layout.tsx` (SiteHeader + SiteFooter). Move `page.tsx` → `(marketing)/page.tsx` (URL unchanged); new pages live in the group. `/legal`, `/sign-in`, `/s/[token]` stay outside.
- **Folder layout:** pages in `src/app/(marketing)/<page>/page.tsx` (+ colocated `opengraph-image.tsx`); shared UI in `src/components/marketing/`; pure data/facts in `src/lib/marketing/` (relative imports if consumed by tests — vitest alias rule).
- **Content management:** TSX pages with copy inline (legal-page precedent) — no CMS, no MDX in marketing v1. Blog reuses the docs-plan `@next/mdx` pipeline when it lands (blog = `(marketing)/blog/` index from a `blog-posts.ts` manifest + `page.mdx` posts).
- **Static discipline:** marketing pages never import `api-context`/DB modules (also keeps the org-scope CI guard trivially green); no `headers()`/`cookies()`. Frozen contracts untouched — no ADR needed; `docs/connector-facts.md` is cited, never edited.
- **Analytics beacon (PR 6):** `POST /api/events` route (`force-dynamic`): validates `name` against the `LaunchEventName` allowlist and `dim` against `/^[a-z0-9/_-]{0,64}$/`, reads host server-side, calls the existing pure `writeLaunchEvent` seam (`src/lib/launch-events.ts`), returns 204 `no-store`. Client fires via `navigator.sendBeacon` from `TrackView`. No-PII by construction.

## 13. Analytics & Conversion

- **Events** (extend `LaunchEventName`): `marketing_page_view` (dim = page slug — one name, low AE-index cardinality) and optional `cta_click` (dim = CTA id: `hero_primary`, `pricing_team`, `personal_share`). `landing_view` keeps its name when `/` cuts over to the beacon; the bot-semantics change (beacon counts JS-executing humans, not crawler HTML fetches) is a deliberate, dated, documented cut-over in `launch-events.ts` — an improvement in fidelity, a break in series comparability.
- **Funnel:** landing/marketing view → sign-up → connect → first score (TTFI) → share card → Team upgrade. View events in Analytics Engine; everything from sign-up onward already comes from DB rows via `src/lib/launch-funnel.ts` + `npm run launch:metrics` (untouched).
- **CTA strategy:** one action everywhere (free signup), "How scoring works" as secondary; UTM/`?ref=` capture per `docs/legacy/launch/launch-plan.md`.
- **Lead capture:** the product is the capture — no email forms in v1.
- **Success metrics:** marketing-page → sign-in click-through, activation rate and TTFI <10 min, share-card rate, Personal→Team conversion.

## 14. Implementation Roadmap

(Independently mergeable PRs; `/code-review` + apply fixes **before** `gh pr create` — merge-race rule; static-marker `○` check + preview deploy every PR.)

1. **PR 1 — Marketing shell refactor.** `(marketing)` group + layout; extract the seven shared components from `page.tsx`; nav moves out of the hero; zero copy changes; `/` keeps `force-dynamic`. Exit: `/` visually identical on preview; worker-size delta recorded. *(Also resolves the docs plan's "don't refactor the inline nav" caveat.)*
2. **PR 2 — SEO foundation.** `site.ts`, `metadataBase`, `sitemap.ts`, `robots.ts`, icons, canonicals, `json-ld.tsx` + Organization/SoftwareApplication on `/`, `og-template.tsx`. Unit test: sitemap ↔ nav-manifest consistency. *(Coordinate: trim docs plan PR 5.)*
3. **PR 3 — `/pricing`.** Page + `pricing-facts.ts` + FAQ + FAQPage JSON-LD + OG. Fact-check: tracked-user semantics, discount always with sunset date.
4. **PR 4 — `/product` + `/security`.** Claim-heaviest PR → adversarial whole-page fact-check by a non-author reviewer (W3-N precedent; words-to-avoid list enforced).
5. **PR 5 — `/connectors` + `/connectors/[slug]`.** `connector-slugs.ts` (unit test: round-trip covers every `VendorId`), registry-derived availability, content cited from frozen `connector-facts.md`, BreadcrumbList, per-vendor OG. Worker size re-recorded.
6. **PR 6 — `/personal` + analytics.** Page; `POST /api/events` + `TrackView`; extend `LaunchEventName`; flip `/` to static with a dated cut-over comment. Unit tests: beacon route allowlist/regex/204/no-binding no-op. Exit: `/` shows `○`; events visible in AE from the preview hostname; Lighthouse pass.
7. **PR 7 (deferred/optional) — blog, `/compare/*`, `/about`.** Blog after docs MDX pipeline + benchmark data; compare pages with a cite-every-competitor-claim rule.

## 15. Risks & Open Questions

- **Custom domains — done (host split).** Both domains are attached to the Worker (`docs/infra.md` §6): `revealyst.com` = marketing (this site; `SITE_URL` default), `app.revealyst.com` = the app/auth origin. The split is enforced by a host redirect in `src/worker.ts` (`src/lib/domains.ts`). When building marketing pages, flip `SITE_URL`/`metadataBase` to `https://revealyst.com` and source any app-facing link from `APP_ORIGIN` (never hard-code hosts). **Deferred:** the `revealyst.thapi.workers.dev` → canonical 301 (kept live for old links/CLIs) — enable pre-launch so backlinks (directories, HN, PH) accrue to the real domain.
- **Legal pages are drafts** (banner: "pending legal review"). `/security` will link to them; an unreviewed privacy policy under a security page is a credibility risk at launch. → Sequence the legal pass (W3-N item) before or alongside PR 4.
- **No social proof exists** and none may be fabricated. Accepted: honesty artifacts substitute; revisit after first public users.
- **Analytics cut-over breaks series comparability** for `landing_view` (bot semantics). Accepted and documented; alternative (keep `/` dynamic forever) blocks the static goal.
- **Docs-plan coordination.** Both plans touch header/footer nav, `metadataBase`/sitemap/robots, and the legal-layout mini-nav. Resolution encoded here: marketing owns shared SEO infra; docs PR 5 shrinks; whichever lands second adds its own nav links.
- **Worker bundle limit** — low risk (no runtime deps), measured twice anyway.
- **Assumptions:** marketing stays in this repo/app (existing landing + docs plan both assume it); no paid-ads landing variants in v1; English only; no dark/light theme toggle (dark sections are per-section brand styling, not a theme).
- **Open questions:** (a) ~~custom domain timing~~ — resolved: `revealyst.com` purchased, linked before launch (see above); (b) should `/pricing` show founder-discounted math ($1) as the headline price or the list $2 with the discount as a badge? → recommend list price headline + sunset-dated discount badge (the Paddle-discount-never-a-list-price rule suggests the same visually); (c) does `/personal` need its own OG/share framing distinct from the CTO-framed root OG? → recommend yes, cheap via the OG template.
