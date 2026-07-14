# EU AI Act worker-notification checklist

> **Static onboarding content (Product Spec V4 §13).** Shown in-app at
> `/compliance`. **Guidance, not legal advice.** The EU AI Act (Regulation
> (EU) 2024/1689) is phased in over 2025–2027; obligations and guidance are
> still settling. Treat this as a practical checklist to run alongside your
> DPIA, and confirm the current text and dates with counsel.

## Why the AI Act is in the conversation

The AI Act classifies as **high-risk** AI systems used for
"**evaluation of employees**" and related workplace decisions
(**Annex III, point 4**). Two things matter for how it applies to Revealyst:

1. **Classification attaches to the system's *purpose*, not to where inference
   runs.** Processing usage signals "locally" or pushing "only the score"
   does not change the analysis — a fluency score bound to an identifiable
   employee is an evaluation output regardless of where it was computed
   (Product Spec V4 §13).
2. **Purpose is what counts.** Revealyst's purpose is to give each employee a
   personal, self-directed AI-usage coach grounded in their own measured
   behavior, with pseudonymized team-level usage patterns emerging only as a
   by-product — **not** making or supporting decisions about hiring,
   promotion, task allocation, or termination. Whether a given deployment
   reaches Annex III high-risk depends on **how you use the output** — using
   scores to evaluate individuals for work-related decisions pulls you toward
   high-risk; using team-level pseudonymized usage metrics for organizational
   insight does not.

**The decisive control is your own usage policy.** The strongest, cleanest
posture — and the one Revealyst's defaults are built for — is: **team-level,
pseudonymized, not used for individual performance or employment decisions.**
Document that, and you keep the deployment out of the workplace-evaluation
high-risk category. If you choose to use individual scores for evaluation, you
take on the high-risk obligations (risk management, logging, human oversight,
etc.) as the **deployer**.

## Worker transparency — the obligation you almost certainly have

Independent of the high-risk question, **Article 26(7)** requires deployers who
put a high-risk system into use in the workplace to **inform affected workers
(and their representatives) before** doing so. Even where your usage keeps you
out of high-risk, worker transparency is expected under GDPR (Arts. 12–14) and
is good practice — so notify workers regardless. This dovetails with the
works-council consultation (see that note) and the DPIA.

## Checklist

**Classify your deployment**

- [ ] Confirm the **purpose**: a personal AI-usage coach for each employee,
      with pseudonymized team-level metrics as a by-product — not employee
      evaluation for employment decisions.
- [ ] Confirm you will **not** use individual scores for hiring, promotion,
      task allocation, discipline, or termination. If you will, treat the
      deployment as **high-risk** and engage counsel on the full deployer
      obligations.
- [ ] Keep the deployment on Revealyst's defaults: **team-level,
      pseudonymized** (visibility mode = Private / team-only).

**Notify workers (before deployment)**

- [ ] Tell affected workers, and their representatives, that Revealyst is being
      introduced, its **purpose**, and **what it measures** (behavioral usage
      signals; **no prompt/completion content**).
- [ ] State plainly **what it is not used for** (no individual performance or
      disciplinary use).
- [ ] Explain the privacy defaults: team-level, pseudonymized, ~90-day raw
      retention, opt-in individual self-view.
- [ ] Point workers to who to contact with questions.

**Template — worker notice**

> We are introducing **Revealyst**, a personal AI-usage coach: it gives you
> private feedback and suggestions based on your own usage of the AI
> developer tools we already use (how often, which features, acceptance
> rates, cost) — it **does not read your prompts, code, or messages**.
> Pseudonymized, team-level usage patterns are also produced as a by-product
> for the organization; we do **not** use it for individual performance
> reviews or disciplinary decisions. Raw data is kept ~90 days, then deleted.
> Questions: `[contact]`.

**Record-keeping**

- [ ] Attach the classification reasoning and the worker notice to your DPIA.
- [ ] Re-check when the AI Act's workplace provisions and any guidance/codes of
      practice are finalized (the Act phases in through 2025–2027).

---

*Sources: Regulation (EU) 2024/1689 (AI Act) — Annex III(4), Art. 26(7); GDPR
Arts. 12–14; Revealyst Product Spec V4 §13. The Act is phasing in and guidance is
evolving — verify current obligations and dates with counsel.*
