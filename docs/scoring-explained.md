# How Revealyst calculates its scores — a plain-English walkthrough

This guide explains, step by step and with real numbers, how Revealyst turns
raw AI-tool usage into three scores out of 100:

- **Adoption** — how broadly and consistently a team actually uses AI, day to day.
- **Fluency** — how *capably* they use it (breadth, depth, and whether AI
  suggestions actually get accepted).
- **Efficiency** — whether the team is getting value for what they're paying.

It's written so a non-coder can follow every calculation, and so a tester can
take real data and **reproduce a score by hand**. Every formula and number
below has been checked against the live scoring engine.

> Looking for the policy-level version (privacy stance, benchmarks, calibration,
> versioning)? See [`score-definitions.md`](score-definitions.md). This guide is
> the beginner + tester companion to it. To verify a specific live number, use
> the fill-in [`scoring-verification-worksheet.md`](scoring-verification-worksheet.md).

---

## 1. The one recipe every score follows

All three scores are built the exact same way. There is **no secret formula** —
a score is just a weighted average of a few simple ingredients ("components"):

1. **Count** something from the raw usage data (e.g. "how many days was the team
   active?" or "how many different tools did they use?").
2. **Put that count on a 0–100 scale** using a fixed range. This is called
   *normalizing*. Think of it as a ruler: if the ruler runs 0 → 20 active days,
   then 8 active days sits at **40 out of 100**.
3. **Multiply by that component's weight** (how much it counts toward the final
   score). Weights always add up to 1 (100%).
4. **Add the weighted pieces together.** That sum, kept between 0 and 100, is the
   score.

### The ruler (normalizing), precisely

For a component with a range of `min` to `max`:

```
normalized = ((raw − min) ÷ (max − min)) × 100
```

…then **clamped** to the 0–100 range: anything at or above `max` becomes 100,
anything at or below `min` becomes 0. Examples on a 0–20 ruler:

| Raw count | On a 0–20 ruler |
|---|---|
| 0 days | 0 |
| 8 days | 40 |
| 10 days | 50 |
| 20 days | 100 |
| 25 days | 100 (clamped — can't exceed 100) |

Every number is rounded to 4 decimal places, matching what the database stores.

---

## 2. Where the raw numbers come from

Revealyst stores usage as **metric records**. One record is simply:

> *"On this **day**, this **subject** (a person, an API key, or an account) did
> this much of this **metric**."*

A handful of these metrics feed the three scores:

| Metric | What one record means | Unit |
|---|---|---|
| `active_day` | The subject had *any* AI activity that day (a yes/no flag) | flag (1) |
| `feature_used` | A specific feature was used that day; the feature's name is tagged on the record (e.g. `chat_panel`, `mcp`, `composer`) | flag (1) |
| `suggestions_offered` | How many AI suggestions were shown that day | count |
| `suggestions_accepted` | How many of those suggestions were accepted | count |
| `spend_cents` | Vendor-authoritative cost that day, **in US cents** (so $10.00 = `1000`) | cents |

Two counting rules matter for reproducing a score:

- **Active days = distinct days, merged across the whole team.** If Alice was
  active on Mon/Tue and Bob on Tue/Wed, that's **3** active days (Mon, Tue, Wed),
  not 4 — the shared Tuesday counts once.
- **Tool/feature coverage = distinct feature names.** Using `chat_panel` on five
  different days still counts as **one** feature.

Scores are computed **per team** (Personal mode is simply a team of one — same
machinery). Each worked example below is its own small illustrative team.

---

## 3. Adoption — worked example

**Adoption = Active days (weight 0.5) + Tool coverage (weight 0.5).**

Raw records for our example team over one month:

| Subject | Metric | Day | Feature | Value |
|---|---|---|---|---|
| alice | active_day | Jun 3 | – | 1 |
| alice | active_day | Jun 4 | – | 1 |
| alice | active_day | Jun 5 | – | 1 |
| alice | active_day | Jun 6 | – | 1 |
| alice | active_day | Jun 7 | – | 1 |
| bob | active_day | Jun 6 | – | 1 |
| bob | active_day | Jun 10 | – | 1 |
| bob | active_day | Jun 11 | – | 1 |
| bob | active_day | Jun 12 | – | 1 |
| alice | feature_used | Jun 3 | chat_panel | 1 |
| alice | feature_used | Jun 4 | claude_code | 1 |
| alice | feature_used | Jun 5 | mcp | 1 |

**Distinct active days:** Jun 3, 4, 5, 6, 7, 10, 11, 12 → merged across Alice and
Bob (Jun 6 shared) = **8 days**. **Distinct features:** chat_panel, claude_code,
mcp = **3 features**.

| Component | Raw | Range | Normalized | Weight | Contribution |
|---|---|---|---|---|---|
| Active days | 8 | 0–20 | (8 ÷ 20) × 100 = **40** | 0.5 | 40 × 0.5 = **20** |
| Tool coverage | 3 | 0–6 | (3 ÷ 6) × 100 = **50** | 0.5 | 50 × 0.5 = **25** |

**Adoption = 20 + 25 = 45.0** ✅ *(engine-verified)*

Reading it: this team uses AI on roughly 40% of the "very active" bar and reaches
for 3 of 6 tracked tool types — solid but-not-yet-daily adoption.

---

## 4. Fluency — worked example

**Fluency = Breadth (0.33) + Depth (0.33) + Effectiveness (0.34).**

Breadth and Depth are counts (like Adoption). Effectiveness is a **ratio**:
suggestions accepted ÷ suggestions offered, on a 0–0.5 ruler (i.e. a 50%
acceptance rate maps to 100).

Raw records for this example team:

| Subject | Metric | Day | Feature | Value |
|---|---|---|---|---|
| *(active on 8 distinct days, as in §3)* | active_day | … | – | 1 |
| alice | feature_used | Jun 3 | chat_panel | 1 |
| alice | feature_used | Jun 4 | claude_code | 1 |
| alice | feature_used | Jun 5 | mcp | 1 |
| alice | feature_used | Jun 6 | composer | 1 |
| alice | suggestions_offered | Jun 4 | – | 400 |
| alice | suggestions_accepted | Jun 4 | – | 120 |

**Distinct features:** 4. **Distinct active days:** 8. **Acceptance:** 120 ÷ 400
= **0.30** (a 30% acceptance rate).

| Component | Raw | Range | Normalized | Weight | Contribution |
|---|---|---|---|---|---|
| Breadth | 4 | 0–8 | (4 ÷ 8) × 100 = **50** | 0.33 | **16.5** |
| Depth | 8 | 0–20 | (8 ÷ 20) × 100 = **40** | 0.33 | **13.2** |
| Effectiveness | 0.30 | 0–0.5 | (0.30 ÷ 0.5) × 100 = **60** | 0.34 | **20.4** |

**Fluency = 16.5 + 13.2 + 20.4 = 50.1** ✅ *(engine-verified)*

---

## 5. Efficiency — worked example

**Efficiency = Output per spend (0.5) + Engagement per spend (0.5).**

Both components are **ratios against spend** (in cents). "Output per spend" is
suggestions accepted ÷ spend; "engagement per spend" is active days ÷ spend.

Raw records for this example team ($10.00 of spend = `1000` cents):

| Subject | Metric | Day | Value |
|---|---|---|---|
| *(active on 8 distinct days, as in §3)* | active_day | … | 1 |
| alice | suggestions_accepted | Jun 4 | 120 |
| alice | spend_cents | Jun 4 | 1000 |

| Component | Raw | Range | Normalized | Weight | Contribution |
|---|---|---|---|---|---|
| Output per spend | 120 ÷ 1000 = **0.12** | 0–0.2 | (0.12 ÷ 0.2) × 100 = **60** | 0.5 | **30** |
| Engagement per spend | 8 ÷ 1000 = **0.008** | 0–0.01 | (0.008 ÷ 0.01) × 100 = **80** | 0.5 | **40** |

**Efficiency = 30 + 40 = 70.0** ✅ *(engine-verified)*

---

## 6. The honesty rules (why a component — or a whole score — can be missing)

Revealyst never fabricates a number to fill a gap. Three rules make this concrete:

**(a) A ratio needs both sides. If one side is missing, the component is dropped
— not set to zero.** Take the Fluency team from §4 but with **no
`suggestions_offered` data at all** (only accepted). We can't tell "genuinely 0%"
from "hasn't synced yet", so Effectiveness is **omitted entirely**. The score is
then built from the remaining components:

- Breadth 16.5 + Depth 13.2 = **Fluency = 29.7** ✅ *(engine-verified)* — a real,
  honest score from the data we *do* have, not a fake 0% acceptance dragging it down.

(If both sides *are* present but the denominator happens to total 0, the ratio
floors to 0 rather than erroring.)

**(b) No data at all → no score, ever.** If nothing fed a score for a team this
period, no score row is produced — the team shows as "not enough data yet",
never as a 0. (Verified: an empty input returns *null*, not `0`.)

**(c) A score is only as trustworthy as its weakest input.** Every raw record is
tagged with how precisely it's attributed — to a **person**, to a **key/project**,
or only to an **account**. A score inherits the *weakest* tag of anything that fed
it. So if a team's score is built partly from a shared account login, the whole
score is honestly labeled "account-level" — it is never laundered into a false
claim of person-level precision. (Ladder: person > key_project > account.)

---

## 7. Segments (Skeptic / Casual / Power User / AI Native)

A team's **Adoption** and **Fluency** scores together place it into one of four
personas. These thresholds are a first pass (pre-calibration) — treat them as
provisional:

| If… | Segment |
|---|---|
| Fluency ≥ 70 | **AI Native** |
| Adoption < 25 (and Fluency < 70) | **Skeptic** |
| Adoption ≥ 60 **or** Fluency ≥ 50 (and Fluency < 70) | **Power User** |
| everything else | **Casual** |

Our §3–§4 team (Adoption 45, Fluency 50.1) lands as a **Power User** — Fluency
clears 50. **A team with no Adoption or Fluency score yet gets no label at all**
— "not enough data" is a different, honest state from "Skeptic".

---

## 8. Why a score can change (or be withheld) later

Each score definition is a frozen, numbered **version**. If Revealyst later tunes
a weight or a range, that becomes a *new* version — the old one and every score
computed with it stay exactly as they were. So a team's history never silently
shifts when a formula evolves, and any past number stays reproducible with the
definition that produced it.

---

## 9. For testers: reproducing a live number

To check a score the app is showing:

1. **Pull the team's raw records** for the score's period (the metrics in §2).
2. **Aggregate**, minding the two gotchas: active days are *distinct days merged
   across all subjects*; feature/tool counts are *distinct feature names*.
3. **Run each component** through the table format above (normalize → weight →
   contribution) and add up. Round to 4 decimals.
4. **Diff against the stored breakdown, not just the total.** Every score row
   stores a per-component `{ raw, normalized, weight, contribution }` breakdown.
   Comparing your hand math against that breakdown pinpoints exactly which
   ingredient diverges if a number looks off.
5. **Remember the honesty rules (§6):** a dropped ratio component or a
   "not-enough-data" blank is correct behavior, not a bug.

The [`scoring-verification-worksheet.md`](scoring-verification-worksheet.md) is a
copy-paste template that does the arithmetic layout for you, and includes the
three examples above as known-good reference rows.

---

## See also

- [`score-definitions.md`](score-definitions.md) — the canonical methodology,
  privacy stance, benchmarks, calibration, and versioning.
- [`scoring-verification-worksheet.md`](scoring-verification-worksheet.md) — the
  fill-in tester worksheet.
