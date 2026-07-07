# Launch announcement set

Ready-to-paste text per channel, in launch-plan.md order. Voice rules
(`.agents/product-marketing-context.md`): plainspoken, numbers over
adjectives, admit limits first, no exclamation points, no fabricated numbers.
Replace `<landing>` with the prod URL + the channel's `?ref=` tag, and
`<share-link>` with the founder's own live score card.

---

## Hacker News — Show HN

**Title (≤80 chars, no superlatives):**
```
Show HN: Revealyst – See who's actually adopting AI across your AI tools
```
**URL:** `<landing>?ref=hn`

**First comment (post immediately, from the founder account):**
```
Founder here. I built this because every AI vendor's dashboard grades its own
homework: Copilot tells you Copilot is great, and nobody tells a CTO what the
company is actually getting across all of its AI tools.

Revealyst polls the admin APIs you already control (Cursor, OpenAI, Anthropic,
plus a local agent for Claude Code) and computes three scores — Adoption,
Fluency, Efficiency — from versioned formulas whose components you can
inspect in the product; every number records which formula version produced
it. [If the methodology doc is live on the site by launch day, add: "The full
scoring methodology is public: <link>" — pre-flight check in launch-plan.md.]

The part I care most about is attribution honesty. Vendor data comes at
different granularities (per-person, per-key, per-account), so every record
carries an attribution-confidence tag and we never fabricate per-user numbers
from account-level data. Shared logins — which break seat=person assumptions
in every vendor dashboard — are detected and flagged instead of miscounted.

Privacy is architectural, not a setting: team-level and pseudonymized by
default, no prompt content ever in team mode, no browser extension (we
rejected it — that's monitoring, and it triggers works-council co-determination
in Germany besides). De-pseudonymizing a team is an explicit org-admin
decision, never a silent default — and individual self-view is the free
Personal mode, where you're your own data subject.

What doesn't work yet, so you don't have to find out the hard way: the GitHub
Copilot connector isn't shipped (it's on the landing page as "soon", not in
the connects list), and benchmarks are seeded from public industry commentary
and held as draft until I've verified each against a primary source —
unverified figures don't reach the product, and the customer network that
would make benchmarks richer doesn't exist on day one.

Personal mode is free forever — connect your own keys or Claude Code and get
your own fluency score. Mine: <share-link>. Teams are $2/tracked user/month
and free up to 5 tracked users; you're only billed for identity-resolved
people with real usage.

Happy to go deep on the scoring formulas, the shared-account heuristics, or
the EU AI Act reasoning.
```

---

## Product Hunt

**Name:** Revealyst
**Tagline (≤60 chars):**
```
See who's actually adopting AI — and how well
```
**Description (≤260 chars):**
```
Neutral AI-adoption analytics across Cursor, OpenAI & Claude (Copilot soon).
Adoption, Fluency & Efficiency scores from versioned, inspectable formulas —
team-level, pseudonymized, no prompt content. Free for individuals & teams ≤5.
```
**Topics:** Analytics · Developer Tools · SaaS

**First comment:**
```
Hi Product Hunt — solo founder here.

The problem: companies pay for four different AI tools and can't answer
"who's using them, how well, and is it worth it?" Every vendor's dashboard
grades its own homework, and none can see across tools.

Revealyst is the neutral referee. It reads the admin APIs you already
control and turns them into three scores — Adoption, Fluency, Efficiency —
with versioned, inspectable formulas and benchmarks. When the data only
supports key-level truth, we show key-level truth: no fabricated per-user
numbers, ever. Shared accounts (everyone has them) get detected and flagged
instead of silently miscounted.

Privacy-first by architecture: team-level + pseudonymized by default, no
prompt content, no browser extension. Built to survive an EU works council.

Personal mode is free forever — measure your own AI fluency and share the
card if you like it. Here's mine: <share-link>

Team pricing is $2/tracked user/mo, free up to 5 tracked users, and there's
a 50% founder rate ($1) through Aug 31, 2026.

I'll be here all day — ask me anything, especially the hard questions about
scoring credibility.
```

---

## X / Twitter — launch thread (post as the founder)

```
1/ Your company pays for Copilot, Cursor, OpenAI and Claude.

Quick: who's actually using them? How well? Is it worth the spend?

If the answer is "let me check four dashboards and a spreadsheet" — that's
the problem I've spent the last months solving. Show HN today: <landing>?ref=x

2/ The uncomfortable truth about AI-usage dashboards: every vendor grades its
own homework. Copilot will never tell you your team uses Cursor better.

The one thing a vendor dashboard structurally can't be is neutral.

3/ Revealyst reads the admin APIs you already control and computes three
scores: Adoption (who), Fluency (how well), Efficiency (worth it).

The formulas are versioned and inspectable. Every number records which
formula version produced it.

4/ My favorite part is what it refuses to do.

Vendor data comes per-person, per-key, or per-account. Every record carries
an attribution tag, and we never invent per-user numbers from account-level
data. A gap shows as a gap, not a guess.

5/ Shared ChatGPT logins break every seat=person dashboard. We detect and
flag them — round-the-clock activity, overlapping sessions, outlier volume —
instead of miscounting them as one person.

Undercounted adoption, a ToS problem, and a security exposure. All three are
things a CTO wants to know.

6/ Privacy is architecture, not a toggle: team-level + pseudonymized by
default, no prompt content ever, no browser extension. De-pseudonymizing a
team is an explicit admin decision, never a silent default.

Built to pass the works-council test, literally.

7/ It's free forever for individuals — connect your own keys or Claude Code,
get your own fluency score.

Mine is public: <share-link>

Teams: $2/tracked user/mo, free ≤5. You're only billed for real, resolved
people.

Test your AI fluency: <landing>?ref=x
```

---

## LinkedIn — launch post (founder account)

```
Somebody in your next board meeting is going to ask what the company is
getting for its AI tooling spend. Most CTOs I know answer with anecdotes.

Today I'm launching Revealyst: neutral, cross-tool AI adoption analytics.
It reads the admin APIs of the AI tools you already pay for and turns them
into three scores — Adoption, Fluency, Efficiency — with versioned,
inspectable formulas and benchmarks.

Three principles I refused to compromise on:

1. Neutrality. No AI vendor will ever credibly measure its own impact, or
tell you a competitor's tool is used better. The referee has to be a third
party.

2. Attribution honesty. Vendor data comes per-person, per-key, or
per-account. Every metric carries a confidence tag, and we never fabricate
per-user numbers from account-level data.

3. Privacy by architecture. Team-level and pseudonymized by default, no
prompt content ever, no browser extension. If your works council would veto
it, we didn't build it.

Free forever for individuals (measure your own AI fluency — mine is linked in
the comments). Teams: $2 per tracked user per month, free up to 10.

<landing>?ref=li
```
*(First comment: the share-card link — plus the methodology doc link ONLY if
it's publicly hosted by launch day; see the pre-flight check in
launch-plan.md.)*

---

## Indie Hackers — build-in-public post

**Title:** `Launched: AI-adoption analytics at a deliberately unsustainable-looking $2/user`

```
Solo founder, launching Revealyst today — neutral AI-adoption analytics for
engineering teams ("who's using AI, how well, and is it worth the money").

The IH-relevant part is the pricing decision. The category looks like this:
WakaTime $8.25/user, Jellyfish $35–50/dev, Worklytics ~$2.5K/mo floor,
Larridin $50K+/yr. I priced Team at $2/tracked user/month, free below 10
users, Personal free forever.

Why a price that low on purpose: COGS is cents per tracked user, adoption
friction in this category is trust + connector setup (not price), and the
real levers are the free tiers. $2 buys headline affordability against
incumbents that literally cannot follow (their sales motion won't survive
it). The risk I'm accepting: sub-$5 can signal low value, and repricing
upward from a low anchor is famously painful — so expansion has to come from
feature depth and headcount growth, not rate increases.

The whole product was also built by a fleet of parallel AI coding agents
against frozen API contracts, which felt appropriately on-brand for an
AI-adoption analytics tool. Happy to write that up if there's interest.

Product: <landing>?ref=ih — free to measure your own AI fluency.
```

---

## Reddit — adoption-measurement discussion opener (r/ExperiencedDevs etc.)

*Not a launch post — a genuine question with disclosure. Adapt to each
subreddit's self-promo rules; some require product mention only in comments.*

```
How do you actually measure whether AI dev tooling is paying off?

Our org pays for multiple AI tools and the per-vendor dashboards are useless
for the question leadership actually asks ("is this worth it?"): they don't
agree on definitions, they assume one seat = one person (lol), and every
vendor grades its own homework.

Curious what others do: spreadsheets over admin exports? Just vibes? Does
anyone track acceptance rates or engaged days across tools?

(Disclosure: I got frustrated enough to build a product around this —
happy to share in comments if allowed, but I'm genuinely asking how others
handle it.)
```
