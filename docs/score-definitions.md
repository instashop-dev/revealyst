# Score definitions & methodology

This document explains how Revealyst turns raw AI-tool usage into three
scores — **Adoption**, **Fluency**, and **Efficiency** — plus how teams get
grouped into adoption personas (Skeptics, Casual, Power Users, AI Natives)
and how our numbers compare to published industry benchmarks. It is written
to be read by a customer, not just an engineer: if a founder or a CTO asks
"how did you calculate this?", this is the answer.

## Purpose and non-goals

Revealyst measures *AI adoption at the team level* — how broadly a tool is
used, how capably, and whether the spend is paying off. It is explicitly
**not**:

- A productivity-surveillance tool. We never rank or expose individuals
  without their consent (see the [Product Spec](Revealyst_Product_Spec_V2.md)
  §7 privacy model); team-level scores are the default everywhere.
- A prompt-content analyzer. Scores are built entirely from usage metadata
  (session counts, tokens, spend, suggestion acceptance) — never from what
  anyone actually typed.
- A single number that claims false precision. Where the underlying data
  can't support a clean answer, a score is *withheld*, not guessed at (see
  "Honesty rules" below).

## How scoring works

Every score is a **weighted sum of components**, each reading one or two
canonical metrics (active days, tokens, spend, suggestions accepted, etc.)
over a period (week, month, or rolling 28 days). Components are stored as
versioned data rows, not code — so a score's exact formula, at any point in
its history, is a fact in the database, not something buried in a deploy.

Each component is normalized onto a 0–100 scale using a fixed range (e.g.
"0 to 20 active days maps to 0–100"), then combined by weight into the final
0–100 score. The published component ranges below reflect the v1 definitions
currently seeded.

**Attribution honesty.** Every underlying usage row is tagged with how
precisely it's attributed: to a specific person, to a shared key/project, or
only to an account as a whole. A score computed from a mix of these carries
the *weakest* attribution level of anything that fed it — so a team score
built partly from a shared login is honestly labeled "account-level," never
laundered into a false claim of person-level precision.

**Honesty rules (no fabricated numbers).** If a component needs two things —
say, suggestions accepted *and* suggestions offered, to compute an acceptance
rate — and one side has zero data for the period, that component is left
out of the score rather than assumed to be zero. If literally nothing fed
the score, no score is produced at all: absence of data is never presented
as a measured zero.

## Adoption Score

**What it measures:** how consistently and broadly a team is actually using
AI tools, day to day.

| Component | What it counts | Range mapped to 0–100 | Weight |
|---|---|---|---|
| Active days | Distinct days the team had any AI-tool activity | 0–20 days/period | 0.5 |
| Tool coverage | Distinct features/tools used (chat, completions, MCP, etc.) | 0–6 tools | 0.5 |

A low Adoption score usually means a tool was rolled out but isn't part of
daily workflow yet. A high score means the team reaches for it regularly and
across more than one use case.

## Fluency Score

**What it measures:** not just *whether* a team uses AI, but how capably —
breadth of use, depth of engagement, and whether suggestions are actually
being accepted.

| Component | What it counts | Range mapped to 0–100 | Weight |
|---|---|---|---|
| Breadth | Distinct features used | 0–8 features/period | 0.33 |
| Depth | Active days | 0–20 days/period | 0.33 |
| Effectiveness | Suggestions accepted ÷ suggestions offered | 0–0.5 (0–50%) | 0.34 |

Effectiveness is a ratio component, so it follows the honesty rule above: a
team with suggestions *offered* but none yet *accepted* still scores (a real
0% acceptance), but a team with **no offered-suggestion data at all** gets
that component omitted rather than a fabricated 0%.

## Efficiency Score

**What it measures:** are we getting value for what we're paying — output
and engagement relative to spend.

| Component | What it counts | Range mapped to 0–100 | Weight |
|---|---|---|---|
| Output per spend | Suggestions accepted ÷ spend (cents) | 0–0.2 | 0.5 |
| Engagement per spend | Active days ÷ spend (cents) | 0–0.01 | 0.5 |

Both components are ratios and follow the same honesty rule: a team with
real spend but zero recorded output isn't floored to a "0% efficient" score
— it's left unscored on that component until both sides of the ratio have
data, since a fabricated zero would look like measured underperformance
rather than what it actually is (a data gap).

## Segmentation: Skeptics, Casual, Power Users, AI Natives

To make results easier to act on, every team with computed Adoption and
Fluency scores gets classified into one of four adoption personas, derived
from those two scores (not a separate data source):

- **Skeptic** — low adoption; the tool isn't part of the team's routine yet.
- **Casual** — some adoption, but fluency hasn't caught up — occasional,
  shallow use.
- **Power User** — either adoption or fluency is comfortably high — regular,
  capable use.
- **AI Native** — fluency is very high — deep, broad, effective use
  regardless of raw frequency.

**A team with no Adoption or Fluency score yet is never labeled a
"Skeptic."** Just as a score is withheld rather than fabricated when data is
missing, a segment is withheld too — "we don't have enough data yet" is a
different, honest state from "this team doesn't use AI." The exact
thresholds are versioned configuration (see `src/scoring/segment.ts`,
`SEGMENT_THRESHOLDS_V1`), currently a first pass pending calibration against
real dogfooding data (see "Calibration" below) — treat the specific cutoffs
as provisional, not as a firm public claim.

## Benchmarks

Where a published third-party figure exists for a comparable metric, we show
it alongside your own score so "is this good?" has an external answer, not
just an internal one. Seeded sources:

| Score / component | Benchmark | Source | Status |
|---|---|---|---|
| Fluency → Effectiveness | ~30% suggestion acceptance rate | GitHub Copilot public commentary | **Provisional — pending founder verification** |
| Adoption (overall) | 60–80% weekly active AI-tool usage among developers | Worklytics / Section AI adoption benchmark commentary | **Provisional — pending founder verification** |
| Adoption (enterprise segment) | 55–75% enterprise AI tool adoption rate | Worklytics / Section AI adoption benchmark commentary | **Provisional — pending founder verification** |

**Every benchmark row above is currently `status: draft`** in our database —
placeholder figures pulled from general industry commentary, not yet traced
to a specific, citable primary source. We surface that status honestly
rather than implying settled fact: no benchmark reaches a customer-facing
panel until a founder has verified its source and flipped it to `verified`.
A published benchmark's own methodology may also not measure the exact same
thing our component does (e.g. Copilot's own "acceptance rate" definition
may differ subtly from our suggestions-accepted ÷ suggestions-offered
ratio) — treat cross-tool comparisons as directional, not exact.

## Calibration

Score definitions are seeded with reasonable-looking ranges, but the true
test is whether they track real usage sensibly. Calibration compares
computed scores against the founder's own real Anthropic + Claude Code data
(available since Wave 1) using `scripts/calibrate-scores.mjs` — a manually
run operator tool, not a merge gate. If calibration surfaces a genuine
miscalibration (a normalization range that's clearly off, thresholds that
misclassify an obviously heavy user), that becomes a new versioned
definition (v2) in a follow-up change — the v1 rows and their historical
results are never edited, so past scores stay reproducible.

## Versioning

Every score definition is a versioned row: `(org_id, slug, version)`. A
`NULL` org_id means a global preset visible to every org; a change to a
definition — a new weight, a new normalization range, an added component —
is always a **new version row**, never an edit to an existing one. This
means a score computed last month is reproducible forever, even after the
definition evolves, and a customer's history never silently shifts under
them when we tune a formula.
