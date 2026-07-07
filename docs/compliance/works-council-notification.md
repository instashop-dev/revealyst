# Works-council notification note (Germany §87 BetrVG, and EU equivalents)

> **Static onboarding content (Product Spec §7).** Shown in-app at
> `/compliance`. **Guidance, not legal advice** — where a works council
> (*Betriebsrat*) or other employee-representative body exists, involving it is
> the controller's obligation. This note explains *why* it applies to
> Revealyst and gives a template you can adapt.

## Why a works council is in scope — even before anyone opts in

In Germany, **§87(1) no. 6 BetrVG** gives the works council a
**co-determination** (*Mitbestimmung*) right over the introduction and use of
"technical devices designed to monitor the behavior or performance of
employees." The settled reading — and the reason this matters for Revealyst —
is that the right is triggered by a system's **monitoring *capability***, not
by whether monitoring is actually switched on or whether individuals have
opted in. A tool that *can* produce behavior- or performance-relevant data
about identifiable employees is co-determinable from the moment it is
introduced.

Revealyst measures AI-tool adoption and fluency per person (even when
pseudonymized by default), so it falls within that capability test. **Consult
the works council before deployment, not after.** An opt-in configured by the
employer does not remove the co-determination right, and — separately — under
**EDPB Guidelines 05/2020** employee consent is not a valid GDPR basis anyway
(see the DPIA template). The path that works is: legitimate-interests basis +
transparency + a co-determination agreement (*Betriebsvereinbarung*) with the
council.

Other EU jurisdictions have analogues — French **CSE** information/consultation
on tools that monitor activity, Dutch **works council** consent under the WOR
for staff-monitoring arrangements, and similar bodies elsewhere. If you operate
in those countries, run the equivalent process. `[List the jurisdictions and
bodies that apply to you.]`

## What makes this an easy consultation

Revealyst is built to keep the co-determination conversation short, because the
monitoring surface is deliberately narrow (Product Spec §7):

- **Team-level, pseudonymized by default** — individual identities are not
  surfaced unless an admin explicitly changes the visibility mode.
- **No prompt or completion content is ever read** — only behavioral signals
  the vendor APIs already expose; no browser extension, no proxy, no keystroke
  or screen capture.
- **Individual view is opt-in self-coaching**, not a manager leaderboard, and
  scores are not designed as a disciplinary metric.
- **No per-person numbers are fabricated** from shared accounts.

A *Betriebsvereinbarung* can therefore commit to concrete, verifiable limits:
team-only pseudonymized reporting, no content processing, no use of scores in
performance or disciplinary decisions, and a defined retention period.

## Template — notification to the works council

> **Subject:** Introduction of Revealyst — AI-tool adoption analytics
> (co-determination under §87(1) no. 6 BetrVG)
>
> Dear members of the works council,
>
> We intend to introduce **Revealyst**, a tool that measures how our teams
> adopt and use AI developer tools (e.g. GitHub Copilot, Cursor, Anthropic
> Claude, OpenAI). Because the tool can produce performance- and
> behavior-relevant data about employees, we recognize your co-determination
> right under §87(1) no. 6 BetrVG and are notifying you **before** deployment.
>
> **Purpose:** understand adoption, fluency, and cost-efficiency of our AI-tool
> investment — not individual performance management.
>
> **What is processed:** behavioral usage signals already exposed by the tool
> vendors' admin APIs (active days, sessions, prompt/message counts, tokens,
> spend, acceptance rates, feature usage, output shipped). **No prompt or
> completion content is read.**
>
> **Privacy defaults:** reporting is **team-level and pseudonymized by
> default**; individual identities are shown only if explicitly enabled;
> individual self-view is opt-in self-coaching. Raw vendor data is retained
> ~90 days, then purged.
>
> **What we propose to agree** in a *Betriebsvereinbarung*: `[team-only
> pseudonymized reporting; no content processing; scores not used for
> disciplinary or performance decisions; named admins with access; retention
> period; review cadence]`.
>
> We would welcome a session to walk through the tool and answer questions, and
> we will not deploy to `[team/org]` until we have completed this consultation.
>
> `[Name, role, date]`

---

## Checklist

- [ ] Identify every jurisdiction/body with a consultation or co-determination
      right over staff-monitoring tools.
- [ ] Notify **before** deployment; share purpose, data categories, and privacy
      defaults.
- [ ] Offer a live walkthrough of the pseudonymized-by-default reporting.
- [ ] Negotiate a *Betriebsvereinbarung* (or local equivalent) capturing the
      limits above.
- [ ] Record the consultation outcome in the DPIA (§6 sign-off).

---

*Sources: §87(1) no. 6 BetrVG (German Works Constitution Act); EDPB Guidelines
05/2020 on consent; Revealyst Product Spec §7. Jurisdiction-specific — confirm
the applicable body and process with local counsel.*
