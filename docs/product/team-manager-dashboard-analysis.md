# Revealyst Team Manager Dashboard — Analysis and 100× Improvement Plan

> **Provenance / status.** This is the founder-supplied product analysis that grounds the
> [Team Manager Dashboard Execution Plan](../Revealyst_Team_Manager_Dashboard_Execution_Plan.md).
> It is the **source of truth** for that plan's product direction. Where a claim in this
> analysis is already met by shipped work (notably the Team Capability Intelligence slice —
> ADRs 0044–0046 / 0050 / 0054), or conflicts with a ratified founder decision (notably
> D-TCI-5 "keep growing the 5-card page, no new nav items"), the execution plan records the
> reconciliation in its §1 "Conflict resolutions" — the plan does not silently override this
> document, and this document does not silently override the ledger. Confidence tags
> (`[KNOWN]`/`[INFERRED]`/`[COMMON]`) are the author's own and are preserved verbatim.

## Verdict

[INFERRED] Revealyst currently behaves like an accurate analytics report, not an indispensable management system. It explains the team in detail but does not complete the management loop: decide, act, assign, review, and improve. **Confidence: HIGH.**

[INFERRED] Adding more scores or charts would make the product worse. The core change should be:

**Data → metrics → explanations**

becomes

**Goal → diagnosis → recommended action → execution → measured outcome → next action**

**Confidence: HIGH.**

---

## 1. What already works

- [KNOWN] Revealyst distinguishes measured, modeled, directional, and unavailable information. **Confidence: HIGH.**
- [KNOWN] The maturity model separates breadth, depth, and consistency instead of equating activity with capability. **Confidence: HIGH.**
- [KNOWN] The product refuses unsupported claims around ROI, time saved, employee quality, shadow AI, and governance maturity. **Confidence: HIGH.**
- [INFERRED] The underlying intelligence model is stronger than the current experience. **Confidence: HIGH.**

---

## 2. Fundamental problems

### 2.1 Too many questions on one page

[INFERRED] Team Intelligence behaves like an annual diagnostic report inside one long dashboard. Managers must process health, maturity, adoption, fluency, efficiency, capability gaps, concentration, spend, tools, trust, and account attribution before knowing what matters. **Confidence: HIGH.**

### 2.2 Insight-heavy, action-light

[INFERRED] Recommendations are mostly informational. Managers cannot easily assign an initiative, choose participants, define a baseline and target, schedule a review, or assess whether the action worked. **Confidence: HIGH.**

### 2.3 No visible team objective

[INFERRED] Adoption, fluency, maturity, depth, and consistency scores are presented without a manager-defined goal determining which metric matters now. **Confidence: HIGH.**

[COMMON] Capability is only actionable relative to a role, workflow, goal, or desired operating change. **Confidence: HIGH.**

### 2.4 Analytics are not translated into management decisions

[INFERRED] "Depth 41" does not tell a manager which workflow is weak, which intervention to run, who should participate, or what success means. "Concentration 88%" does not automatically become a knowledge-transfer plan. **Confidence: HIGH.**

### 2.5 Aggregates hide operational context

[INFERRED] Team-wide scores can hide differences by function, workflow, subgroup, or role. Revealyst needs stronger segmentation without turning into employee surveillance. **Confidence: HIGH.**

### 2.6 Every metric is over-explained

[INFERRED] Repeated descriptions, caveats, badges, denominators, and methodology notes protect honesty but make the product cognitively expensive. **Confidence: HIGH.**

### 2.7 Data-quality issues dominate the narrative

[INFERRED] Unknown accounts, shared accounts, source coverage, and attribution matter, but should be a compact confidence layer unless they materially change a conclusion. **Confidence: HIGH.**

### 2.8 Maturity is detached from action

[INFERRED] The maturity screen is descriptive and retrospective. It does not clearly show the blocker to the next level, the operational meaning of progression, or the intervention most likely to help. **Confidence: HIGH.**

### 2.9 No recurring management habit

[INFERRED] The product lacks a clear weekly or monthly operating ritual. Without this, managers may inspect Revealyst occasionally rather than depend on it. **Confidence: HIGH.**

---

## 3. Product direction: Team AI Operating System

[INFERRED] Revealyst should become a guided system for improving team AI capability, not merely a dashboard. **Confidence: HIGH.**

The recurring manager loop should be:

1. Set the team capability goal.
2. See the highest-priority constraint.
3. Accept or modify an intervention.
4. Launch it.
5. Track participation and evidence.
6. Review whether behaviour changed.
7. Continue, modify, or stop the intervention.

---

## 4. Recommended information architecture

### Overview
Current goal, priorities, progress, risks, active initiatives, and next decisions.

### Capabilities
Strengths, gaps, concentration, spread, and trends by workflow and subgroup.

### Initiatives
Capability-building experiments, playbooks, training, and workflow changes.

### Team
Privacy-safe participation, capability distribution, mentors, support needs, and coverage.

### Settings
Sources, account matching, privacy, members, integrations, spend configuration, and methodology.

[INFERRED] Maturity should become a lens inside Overview and Capabilities rather than a separate dashboard duplicating the same information. **Confidence: HIGH.**

---

## 5. Replace the homepage with a Manager Command Center

### A. Goal and review period

Show the current goal prominently:

> **Current team goal:** Make AI part of the weekly workflow for support and product teams
> Review date: 31 August
> Baseline: 54% sustained adoption
> Target: 75%

### B. What needs your attention

Display no more than three priorities.

#### Example: Depth is the main constraint

- Evidence: Most people are active, but only a minority use repeatable multi-step workflows.
- Recommended action: Run a two-week repeatable-workflow initiative.
- Expected signal: More people use AI across multiple workflow steps.
- Actions: `Start initiative` · `Review evidence`

#### Example: Capability is concentrated

- Evidence: Most advanced usage comes from two people.
- Recommended action: Create peer-led workflow sessions and reusable examples.
- Actions: `Create knowledge-sharing plan` · `See affected capabilities`

#### Example: Attribution gap weakens confidence

- Evidence: Shared accounts prevent reliable interpretation.
- Recommended action: Resolve or separate unresolved identities.
- Action: `Resolve accounts`

[INFERRED] Every priority should state why it matters, supporting evidence, the next action, and what Revealyst will monitor. **Confidence: HIGH.**

### C. Current initiatives

| Initiative | Goal | Participation | Early signal | Review |
|---|---|---:|---|---|
| Support reply workflow | Increase repeatable AI use | 7 of 9 | Improving | 5 days |
| Product research playbook | Spread advanced capability | 3 of 5 | Too early | 12 days |

Each initiative needs:

- Owner
- Participant group
- Capability affected
- Baseline
- Target
- Duration
- Review date
- Final outcome

### D. Team progress

Replace many independent scorecards with one narrative:

> **The team is broadly active, but capability depth has not yet spread.** Adoption is high and consistent. Advanced workflows remain concentrated among two people. The next priority is capability transfer, not broader onboarding.

Show only four compact indicators:

- Sustained adoption
- Workflow depth
- Capability spread
- Data confidence

### E. Capability map

| Capability | Coverage | Depth | Spread | Trend | Suggested action |
|---|---:|---:|---:|---:|---|
| Research and synthesis | Strong | Medium | Broad | Rising | Maintain |
| Drafting and editing | Strong | Low | Broad | Flat | Improve workflow depth |
| Data analysis | Limited | High | Concentrated | Rising | Spread expertise |
| Automation and agents | Limited | Medium | Concentrated | Flat | Pilot with one team |
| Customer support | Medium | Medium | Broad | Rising | Standardize playbook |

[INFERRED] This better answers the manager's real question: "What can the team reliably do with AI?" **Confidence: HIGH.**

### F. People and support

Use aggregated categories:

- Ready to mentor
- Building consistency
- Needs workflow support
- Not enough data
- Newly activated
- At risk of disengagement

Avoid:

- Employee rankings
- Prompt inspection
- Hidden quality scores
- Activity leaderboards
- Manager access to private coaching

### G. Weekly review

Generate a concise weekly review:

- What materially changed
- Why it probably changed
- Which initiative influenced it
- What failed to improve
- Which decision is required
- What Revealyst recommends next

Actions: `Accept` · `Modify` · `Dismiss` · `Create initiative`

---

## 6. Redesign maturity

### New maturity summary

> **Level 3 — Embedded**
> AI use is broad and consistent, but advanced capability remains concentrated.
> **Primary blocker to Level 4:** sophisticated workflows have not spread across the team.

Show only:

- Current level
- Change since last period
- Primary blocker
- Strongest evidence
- Confidence
- Recommended next move

### Path to the next level

| Requirement for Level 4 | Current status |
|---|---|
| Broad sustained activation | Met |
| Multiple repeatable workflows | Partially met |
| Advanced usage distributed across the team | Not met |
| Evidence across enough weeks | Met |
| Reliable attribution | Partially met |

Move the following behind progressive disclosure:

- What Revealyst deliberately does not measure
- Board-level evidence
- Full methodology
- Definitions of measured, modeled, and directional

[INFERRED] Replace floating-point artifacts such as `47.019999%` with rounded language such as `47% higher`. **Confidence: HIGH.**

---

## 7. Convert recommendations into executable initiatives

Every recommendation should contain:

1. **Diagnosis** — what pattern was detected.
2. **Why it matters** — risk or opportunity.
3. **Evidence** — supporting signals and confidence.
4. **Intervention** — concrete action.
5. **Expected change** — observable behaviour to monitor.
6. **Launch controls** — owner, participants, duration, baseline, target, review date.
7. **Outcome review** — improved, unchanged, worsened, or inconclusive.

[INFERRED] Revealyst should learn which interventions work for each team rather than repeatedly issuing generic advice. **Confidence: HIGH.**

---

## 8. Initiative library

Recommended templates:

- **Spread an expert workflow** — convert concentrated expertise into reusable team knowledge.
- **Build one repeatable AI workflow** — move from occasional prompting to habitual multi-step use.
- **Improve consistency** — establish a sustainable weekly habit.
- **Activate an underused tool** — test whether an existing paid tool solves a defined workflow.
- **Reduce unnecessary overlap** — consolidate redundant tools without eliminating useful specialization.
- **Agentic workflow pilot** — test one bounded agent workflow before broader rollout.
- **Function-specific playbook** — create workflows for support, product, engineering, sales, marketing, finance, or operations.

---

## 9. Make insights role- and workflow-aware

During setup, managers should define:

- Team function
- Primary workflows
- Important outcomes
- Approved tools
- Current capability priorities
- Constraints
- Review cadence

Example:

> **Customer support:** AI use is broad for drafting, but low for classification, knowledge retrieval, and escalation preparation.

[INFERRED] This is more actionable than a generic team-wide depth score. **Confidence: HIGH.**

---

## 10. Privacy-safe capability map

Use:

- Aggregated coverage
- Cohort-level patterns
- Minimum group-size thresholds
- Opt-in mentor identification
- Private individual coaching
- Explicitly shared achievements
- Data-confidence indicators

[INFERRED] Revealyst should coach individuals privately while helping managers improve the system collectively. **Confidence: HIGH.**

---

## 11. Redesign data confidence

Use one persistent indicator:

> **Data confidence: Good**
> 13 of 14 members identified · 5 of 7 tools reporting · 2 shared accounts unresolved

Only show inline warnings when a limitation materially changes a conclusion.

Example:

> Agent adoption may be understated because two connected tools do not report agent activity.

---

## 12. Visual design improvements

- Reduce the main page to roughly two desktop viewports.
- Show conclusion first, evidence second, methodology third.
- Stop giving every metric an equal-sized bordered card.
- Use fewer containers and stronger section hierarchy.
- Replace jargon with manager language.
- Keep measured, modeled, and directional states as subtle metadata.
- Use compact tables where comparison matters.
- Move configuration out of the analytics page.

Suggested language changes:

| Current term | Better label |
|---|---|
| Activation | People using AI regularly |
| Fluency | Repeatable workflow usage |
| Concentration | Expert dependency / capability spread |
| Plateau | Growth momentum |
| Agentic share | Agent-assisted work |
| Tool sprawl | Tool coverage and overlap |

---

## 13. Metrics to remove, demote, or redefine

### Demote: Adoption vs benchmark

[INFERRED] An unverified modeled benchmark should not dominate the dashboard. Internal progress against a chosen goal matters more. **Confidence: HIGH.**

### Rename: Efficiency

[INFERRED] "Efficiency" risks implying productivity. Rename it to the actual construct, such as `License utilisation` or `Spend utilisation`. **Confidence: MED.**

### Demote: Cost per active user

[INFERRED] Useful for procurement, weak as a headline capability metric. **Confidence: HIGH.**

### Replace: Tool sprawl

Use `Tool coverage and overlap`, distinguishing purposeful specialization from redundant subscriptions.

### Keep: Concentration

Connect it directly to knowledge transfer, mentoring, and workflow-sharing actions.

### Keep: Depth

Break it down by workflow and capability rather than using only one team-wide score.

---

## 14. New indispensable features

### AI Manager Brief

A concise weekly summary of what changed, why it matters, what worked, what did not, and what decision is required.

### Ask Revealyst

Managers should be able to ask:

- Where is capability concentrated?
- Why did consistency fall?
- Which team improved most?
- Did the support initiative work?
- Which paid tools are not contributing?
- Where is evidence insufficient?

Answers must expose evidence, uncertainty, and unavailable conclusions.

### Decision log

Record recommendations accepted, modified, rejected, launched, or completed.

### Intervention effectiveness

Compare before, during, and after evidence. Do not claim causality unless supported.

### Capability playbooks

Turn proven internal workflows into reusable templates.

### Team learning memory

Remember which interventions worked, failed, or were rejected for each team.

### Monthly management review

Generate a management-ready summary of goals, initiatives, progress, risks, confidence gaps, and next decisions.

---

## 15. Final homepage order

1. Goal and review period
2. Manager brief
3. Top three priorities
4. Active initiatives
5. Capability map
6. Four compact progress indicators
7. Data confidence
8. Expandable detail: maturity, tools, spend, benchmark, segments, methodology

---

## 16. Remove from the primary screen

- Long sequences of recommendation cards
- Repeated metric descriptions
- Workspace and source configuration
- Full account-matching details
- Duplicate maturity content
- Low-priority board metrics
- Heavy benchmark emphasis
- Technical methodology language in the default view

---

## 17. Implementation plan

### Phase 1 — Fix the management experience

- Build a narrative-first Manager Command Center.
- Add goals, top priorities, active initiatives, capability map, and weekly brief.
- Consolidate confidence information.

### Phase 2 — Make recommendations executable

- Add initiative creation, ownership, participants, baseline, target, duration, and review workflow.
- Connect each recommendation to an initiative template.

### Phase 3 — Measure improvement

- Add intervention reviews, capability trends, decision history, and before-versus-after evidence.

### Phase 4 — Personalize intelligence

- Add role-aware capability models, workflow definitions, manager feedback, and recommendation learning.

### Phase 5 — Build the operating habit

- Add recurring weekly reviews, monthly summaries, reminders, and exports.

---

## Final product principle

[INFERRED] Revealyst should not make managers study AI analytics. It should tell them:

> **Here is the capability outcome you are trying to achieve. This is the constraint preventing it. This is the strongest available evidence. This is the action most likely to help. Launch it here. Return on this date to see whether behaviour changed.**

[INFERRED] That would move Revealyst from an honest reporting dashboard to a system managers depend on for running AI capability improvement. **Confidence: HIGH.**
