# Revealyst V1 launch plan (W3-P)

Solo-founder plan, sequenced so each step feeds the next and everything funnels
to the landing page → sign-up → share-card loop. Copy source of truth:
`.agents/product-marketing-context.md`. Announcement text: `announcements.md`.
Directory backlinks: `directories.md`.

**Launch artifact:** the share card ("My AI Fluency: 78" → `/s/<token>`).
**Content asset:** the benchmark post (blocked on `benchmark-post-data-needs.md`).
**Gate:** don't start the sequence until W3 exit-gate items are live (signup,
Paddle checkout, entitlements) — a PH/HN spike onto a broken funnel is wasted.

## Sequencing (build momentum, don't spend it at once)

### T-7 to T-1 — quiet seeding
- [ ] Verify prod end-to-end as a stranger: fresh email → sign up → connect a
      key → score → create share link → open `/s/<token>` logged out.
      Confirm `launch:metrics` and the AE dataset are recording.
- [ ] Personal invites to 10–20 friendly developers (the W2-I dogfooding circle
      + their referrals): ask each to run Personal mode AND share one score
      card. This pre-seeds real cards in the wild so launch-day visitors see a
      live loop, not an empty room. One-to-one messages, not a blast.
- [ ] Publish the benchmark post (if founder data has landed — PR 4) and the
      score-definitions methodology as its companion. If the post isn't ready,
      launch anyway; the post becomes the T+7 second wave.
- [ ] Prepare PH listing (below) and schedule the launch day.
- [ ] Set up a plain-text launch-day status doc: prod URL, health endpoint
      (`/api/health`), Cloudflare dashboard links, rollback command — the
      solo-founder pager.

### T-0 (a) — Hacker News: Show HN
The primary channel: the beachhead buyer (CTO/VP Eng, 25–200) reads HN, and the
product's honesty posture is HN-native. Post early morning US time, Tue–Thu.

- Title: `Show HN: Revealyst – See who's actually adopting AI across your AI tools`
  (plain, no superlatives — the text in `announcements.md` §HN).
- First comment (yours, immediately): the honest technical story — attribution
  ladder, why no browser extension, why team-level pseudonymized default, what
  the score formula is, what doesn't work yet (Copilot connector "soon"; the
  "Soon" strip on the landing page must match reality on launch day).
- Rules of engagement: answer every substantive comment same-day; concede
  valid criticism plainly ("correct — that's key-level attribution and we tag
  it as such"); never argue tone; link the methodology doc, not marketing
  pages, when challenged on credibility.
- HN failure mode to accept: if it doesn't front-page, don't repost for ≥30
  days. The PH launch is the second shot.

### T-0 (b) or T+1 — Product Hunt
- Tagline: `See who's actually adopting AI — and how well` (≤60 chars).
- Gallery: landing hero, the three-scores dashboard (pseudonymized demo org),
  a share card, the attribution-honesty section. Short screen-capture video:
  signup → key → first score, real time, timer visible (the <10-min claim as
  footage — only if it's actually true on prod).
- First comment: solo-founder story — "every vendor grades its own homework;
  I built the neutral referee. Personal mode is free forever; here's my own
  fluency score card as proof: <share link>."
- All-day engagement; every commenter gets a reply. Traffic goal is signups,
  not upvotes: the CTA in every reply is the free Personal score.
- Do NOT buy/beg upvote pods — category credibility is the moat; a hollow
  launch damages it.

### T+1 to T+3 — dev communities (borrowed channels, one per day)
Order by audience fit; adapt the base text per community (`announcements.md`),
always as a participant, never a drive-by link drop. Disclose being the founder
everywhere.
- [ ] r/ExperiencedDevs or r/EngineeringManagers (adoption-measurement angle,
      NOT a product pitch — "how do you measure whether AI tooling is paying
      off?" with Revealyst in a comment/footer per subreddit self-promo rules).
- [ ] r/devops / r/programming: only if the benchmark post is live (content
      first, product second — these communities reject naked launches).
- [ ] Lobsters: only via the benchmark post (methodology angle), if at all.
- [ ] Relevant Slack/Discords the founder is already a member of (platform
      engineering, CTO groups): personal note + share card, not a broadcast.
- [ ] Indie Hackers: build-in-public launch post (revenue-transparent framing
      works there; the $2 deliberate-low-anchor pricing story is the hook).

### T+7 — second wave
- [ ] Benchmark post to HN (if not used at T-1) — content posts get a second
      audience the Show HN missed.
- [ ] Directory submissions round (see `directories.md`) — backlink layer, an
      afternoon of form-filling; do it after launch so listings have real
      screenshots and the PH badge.
- [ ] Personal follow-up to every HN/PH commenter who showed buying intent.

## Owned-channel capture (ORB: everything funnels home)
- The landing page is the only launch URL used anywhere (UTM-tagged per
  channel: `?ref=hn`, `?ref=ph`, `?ref=reddit` — visible in AE host/path data
  and server logs without any PII).
- No email list exists yet at launch; the product IS the capture (free
  Personal signup). Post-V1: changelog + a monthly benchmark-data email are
  the natural owned channels — decide after launch, don't build now.

## Measurement (what "worked" means)
Read daily during launch week, from `npm run launch:metrics` + AE dashboard:
- Signups per channel (UTM), activation rate (first score), TTFI median,
  share-card creation rate, share-card views (AE) vs signups from `/s/*`
  referrals, Personal→Team signals.
- §15 targets: TTFI <10 min · share-card loop demonstrably driving signups ·
  first Personal→Team conversions without founder involvement.

## Risks / honesty tripwires for launch content
- Never claim Copilot support in present tense (registry-derived "Soon" strip
  is the source of truth — same rule for all launch copy).
- No fabricated numbers anywhere: if a metric sample is small, say the number
  AND the n. HN will find the weak claim; volunteering it first is the brand.
- The founder discount must always appear with its sunset date (2026-08-31).
- **Pre-flight content fact-check (W3-N lesson, CLAUDE.md):** the night before
  posting, re-verify EVERY product claim in `announcements.md` against live
  prod — connector list matches the registry, "methodology is public" only if
  the doc is actually reachable on the site (else use the "inspectable in the
  product" phrasing already in the copy), scope claims say we *use* keys
  read-only (never that the keys *are* read-only — admin keys are non-scoped
  full-access per docs/connector-facts.md), and no "KMS" language (it's a
  versioned Worker-secret KEK).
- **Blockers found by the 2026-07-07 adversarial fact-check — must clear
  before launch day:**
  - [x] **Share-link revoke surface** — RESOLVED: `GET /api/share?personId=`
        (own links, metadata only — tokens are never stored) +
        `DELETE /api/share/:id` (self-only, audited as `share.revoke`,
        idempotent), active-links list + revoke button in the share dialog,
        and the landing "Revoke the link any time." line restored.
  - [ ] **Team benchmark panel provenance**: the panel still renders the
        placeholder `norms.ts` fixture whose source strings claim
        "(2025, published)" — violates score-definitions.md's verified-only
        rule. Before ANY public screenshot/demo: swap to the verified-only DB
        source (as personal view does) or relabel as "modeled estimate
        (unverified)".
  - [ ] **Paddle end-to-end**: checkout/webhook/entitlement wiring (W3-M) must
        be live — buy a Team seat as a stranger. If launching without it, the
        Paddle footnote + "self-serve end to end" copy come off the landing
        page first.
  - [ ] **"Minutes" claim**: keep "see your first insight in minutes" only if
        the T-7 stranger walkthrough clocks signup→first score under ~10 min.
