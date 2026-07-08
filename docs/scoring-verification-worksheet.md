# Scoring verification worksheet (for testers)

A fill-in template for reproducing a Revealyst score by hand and confirming the
app's number is right. Copy a section, drop in the raw values you counted, and
work left to right. For the *why* behind each step, read
[`scoring-explained.md`](scoring-explained.md); for policy, see
[`score-definitions.md`](score-definitions.md).

## How to use each table

For every component:

```
Normalized   = clamp( (Raw − Min) ÷ (Max − Min), 0, 1 ) × 100
Contribution = Normalized × Weight
```

- **Clamp** means: if the fraction is above 1 use 1 (→ 100), if below 0 use 0.
- **Round** every number to **4 decimal places**.
- **Score = sum of the Contributions**, then clamped to 0–100.

Before you start, count the raw inputs carefully — the two easy mistakes:

- [ ] **Active days** = *distinct* days, **merged across all subjects** (a day two
      people were both active counts once).
- [ ] **Tool coverage / breadth** = count of *distinct feature names* (not events).
- [ ] **Spend is in cents** ($10.00 = 1000).
- [ ] A **ratio component** (effectiveness, output-per-spend, engagement-per-spend)
      is **omitted** if *either* side has zero records — don't put 0, leave the
      row out and don't count its weight.
- [ ] If **nothing** fed the score → there should be **no score row at all** (not 0).
- [ ] Cross-check each row against the stored `{ raw, normalized, weight,
      contribution }` breakdown on the `score_results` row, not just the total.

---

## Adoption

| Component | Raw (fill in) | Min | Max | Normalized | Weight | Contribution |
|---|---|---|---|---|---|---|
| Active days | ____ | 0 | 20 | ____ | 0.5 | ____ |
| Tool coverage (distinct features) | ____ | 0 | 6 | ____ | 0.5 | ____ |
| **Adoption = sum (clamp 0–100)** | | | | | | **____** |

## Fluency

| Component | Raw (fill in) | Min | Max | Normalized | Weight | Contribution |
|---|---|---|---|---|---|---|
| Breadth (distinct features) | ____ | 0 | 8 | ____ | 0.33 | ____ |
| Depth (active days) | ____ | 0 | 20 | ____ | 0.33 | ____ |
| Effectiveness (accepted ÷ offered) | ____ | 0 | 0.5 | ____ | 0.34 | ____ |
| **Fluency = sum (clamp 0–100)** | | | | | | **____** |

> Effectiveness omitted (no `suggestions_offered` *or* no `suggestions_accepted`
> records)? Drop the row and add only Breadth + Depth.

## Efficiency

| Component | Raw (fill in) | Min | Max | Normalized | Weight | Contribution |
|---|---|---|---|---|---|---|
| Output per spend (accepted ÷ spend_cents) | ____ | 0 | 0.2 | ____ | 0.5 | ____ |
| Engagement per spend (active days ÷ spend_cents) | ____ | 0 | 0.01 | ____ | 0.5 | ____ |
| **Efficiency = sum (clamp 0–100)** | | | | | | **____** |

---

## Segment check (from Adoption + Fluency)

| Condition (checked in this order) | Segment |
|---|---|
| Fluency ≥ 70 | AI Native |
| Adoption < 25 | Skeptic |
| Adoption ≥ 60 **or** Fluency ≥ 50 | Power User |
| otherwise | Casual |
| either score missing | *no segment* |

---

## Known-good reference (should reproduce exactly)

Use these to confirm you're filling the worksheet correctly — every number is
engine-verified.

**Adoption — 8 active days, 3 distinct features:**

| Component | Raw | Min | Max | Normalized | Weight | Contribution |
|---|---|---|---|---|---|---|
| Active days | 8 | 0 | 20 | 40 | 0.5 | 20 |
| Tool coverage | 3 | 0 | 6 | 50 | 0.5 | 25 |
| **Adoption** | | | | | | **45.0** |

**Fluency — 8 active days, 4 features, 120 accepted ÷ 400 offered:**

| Component | Raw | Min | Max | Normalized | Weight | Contribution |
|---|---|---|---|---|---|---|
| Breadth | 4 | 0 | 8 | 50 | 0.33 | 16.5 |
| Depth | 8 | 0 | 20 | 40 | 0.33 | 13.2 |
| Effectiveness | 0.30 | 0 | 0.5 | 60 | 0.34 | 20.4 |
| **Fluency** | | | | | | **50.1** |

**Fluency with Effectiveness dropped** (accepted present, offered missing): only
Breadth 16.5 + Depth 13.2 = **29.7**.

**Efficiency — 120 accepted, 8 active days, 1000 cents ($10.00):**

| Component | Raw | Min | Max | Normalized | Weight | Contribution |
|---|---|---|---|---|---|---|
| Output per spend | 0.12 | 0 | 0.2 | 60 | 0.5 | 30 |
| Engagement per spend | 0.008 | 0 | 0.01 | 80 | 0.5 | 40 |
| **Efficiency** | | | | | | **70.0** |

Segment for this team (Adoption 45, Fluency 50.1): **Power User** (Fluency ≥ 50).
