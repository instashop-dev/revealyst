# Benchmark post — founder data needs (blocks PR 4)

The W3-P benchmark blog post ships **only** from founder-verified citations +
real dogfooding numbers (kickoff decision, 2026-07-07). This doc is the exact
unblock list. Everything else in W3-P proceeds without it; the post PR starts
the moment this comes back.

Why it's blocked: every seeded benchmark row is `status='draft'`
(`drizzle/0013_seed-benchmarks.sql`), and `docs/score-definitions.md`'s own
honesty rule says draft rows never reach a customer-facing surface. The
dashboard norms fixture (`src/lib/benchmarks/norms.ts`) is likewise
placeholder. There are **zero verified primary-source URLs in the repo**, and
the real usage numbers live only in the production DB.

## A. Citations to verify (3 seeded rows + 3 norms sources)

For each: find the primary source (the actual study/blog post/report URL, not
a homepage), confirm the number, and record URL + publication date. If a
number can't be traced, we drop it from the post — we don't soften it.

| # | Claim as seeded | Where seeded | What "verified" needs |
|---|---|---|---|
| 1 | Copilot suggestion acceptance rate ≈ 30% | `0013` row 1 (source_url is just github.blog) | The specific GitHub research post/paper stating the acceptance-rate figure, with date. Candidates to check: GitHub's "Research: quantifying GitHub Copilot's impact" posts (2022–2024) and the Copilot metrics API docs' cited norms. |
| 2 | Weekly active AI-tool usage among developers 60–80% | `0013` row 2 (source_url NULL) | The actual Worklytics benchmark report or Section AI-proficiency survey page + date. If their published number differs from 60–80%, the row gets the published number, not ours. |
| 3 | Enterprise AI tool adoption 55–75% | `0013` row 3 (source_url NULL) | Same as #2, enterprise segment. |
| 4 | Adoption percentile curve (p10 20 → p90 82, median 52) | `norms.ts` "Worklytics / Section (2025, published)" | Whichever published distribution this was modeled on — or reclassify the curve as "Revealyst modeled estimate" in the post (honest framing beats fake precision). |
| 5 | Fluency curve (median 49) | `norms.ts` "GitHub Copilot acceptance-rate norms + published fluency studies (2025)" | Same treatment as #4. |
| 6 | Efficiency curve (median 45) | `norms.ts` "Published value-per-spend benchmarks (2025)" | Same treatment as #4 — this one is least likely to have a real source; expect to reframe as modeled. |

After verifying: flip the `0013` rows to `status='verified'` with real
`source_url`s via a follow-up migration (additive — new migration, not an
edit of 0013; frozen `drizzle/**` means an ADR if any existing shape changes,
but adding a data-update migration for `status`/`source_url` values is a data
change, not a shape change — still flag it in the PR for contract-guardian).

## B. Dogfooding numbers to pull (production DB)

Run both against prod (read-only):

```
DATABASE_URL=<prod-neon-url> npm run launch:metrics
DATABASE_URL=<prod-neon-url> npm run calibrate:scores -- <founder-org-id>
```

Hand back (paste raw output is fine):

1. **From calibrate:scores** — the founder org's current Adoption / Fluency /
   Efficiency scores + the raw sanity numbers it prints (spend, active days,
   acceptance). These become the post's "here's a real developer's month"
   section — pseudonymized as "the founder's own data", which is honest and
   self-owned (no consent question).
2. **From launch:metrics** — stages + TTFI if any real orgs beyond fixtures
   exist (friendly-developer Personal accounts, W2-I). If the sample is <5
   orgs, the post says "early data from N dogfooding users", never implying a
   population.
3. **Anything you'd veto**: any number you don't want public, say so now —
   the post treats this list as the complete allowed set.

## C. What the post will and won't claim (agreed frame)

- WILL: methodology (score-definitions.md is fully citable), verified
  published benchmarks with links, founder + friendly-dev dogfooding numbers
  labeled as exactly that, and "we publish our formula versions" as the
  credibility hook.
- WON'T: draft benchmark numbers, percentile curves presented as measured
  unless a source exists (else labeled "modeled"), any per-user claim beyond
  what attribution tags support, customer counts or testimonials (none
  exist).
