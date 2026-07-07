# GDPR DPIA template — deploying Revealyst in your organization

> **Static onboarding content (Product Spec §7).** Shown in-app at
> `/compliance` and provided as a working template you can adapt. **This is
> guidance, not legal advice** — a Data Protection Impact Assessment is your
> controller obligation, and this template is a starting point your DPO or
> counsel should finalize. Revealyst is your **processor** for the analytics
> it produces; you remain the **controller** of your employees' personal data.

A DPIA under **GDPR Article 35** is required when processing is "likely to
result in a high risk to the rights and freedoms of natural persons" —
which the EDPB and most supervisory authorities treat as triggered by
**systematic monitoring of employees** and by **evaluation or scoring** of
people at work. Measuring AI-tool adoption and fluency across a workforce is
squarely in that zone, so you should complete a DPIA before rolling Revealyst
out to a team. The good news: Revealyst is architected to keep this risk
**low and well-mitigated by default** (§7), and most of the mitigations below
are already true of the product rather than things you must configure.

Fill in the bracketed `[…]` fields; the pre-filled text describes how
Revealyst actually works so you don't have to reverse-engineer it.

---

## 1. Description of the processing

| Field | Value |
|---|---|
| **Controller** | `[Your organization]` |
| **Processor** | Revealyst (data-processing terms in the DPA; the *sale* is handled by Paddle as Merchant of Record) |
| **Purpose** | Measure adoption, fluency, and cost-efficiency of AI developer tools across the organization, to answer "who is using AI, how well, and are we getting our money's worth." |
| **Nature** | Revealyst polls each connected vendor's **admin/usage APIs** (Anthropic, OpenAI, GitHub Copilot, Cursor) and ingests locally-summarized Claude Code usage via the Revealyst Agent. It normalizes these into per-(person, tool, day) **behavioral metric records** and computes versioned **scores** (Adoption / Fluency / Efficiency) from them. |
| **Scope of data subjects** | Members of `[team(s)/org]` whose usage is visible to the connected vendor accounts. |
| **Retention** | Raw vendor payloads are held ~**90 days** for normalization-bug replay, then purged automatically; after that only the derived metric records and scores remain. |
| **Recipients** | `[Your admins with Revealyst access]`. Sub-processors: `[list — e.g. Neon (database), Cloudflare (compute)]`; see the DPA. |
| **Transfers** | `[Note any transfer outside the EEA and its safeguard — SCCs, etc. Confirm against the current sub-processor list in the DPA.]` |

## 2. Categories of personal data

- **Behavioral usage signals only** — active days, sessions, prompt/message
  counts, tokens, spend, model mix, acceptance/retry rates, feature usage,
  output-shipped counts (commits/PRs/lines). Derived **scores** bound to a
  person are themselves personal data.
- **Identity data** used for attribution — vendor account identifiers and,
  where the customer maps them, work email → person.
- **No special-category data.**
- **No prompt or completion content — ever.** This is a hard architectural
  guarantee, not a setting: there is no content column in the schema, the
  Revealyst Agent summarizes Claude Code logs **locally** and structurally
  cannot emit content (proven by an automated sentinel test suite), and there
  is no browser extension or proxy. (Product Spec §7, tripwire rule 7.)

## 3. Necessity and proportionality

- **Lawful basis:** typically **legitimate interests (Art. 6(1)(f))** —
  managing and getting value from AI-tool investment — balanced against
  employee rights via the mitigations in §5. `[Confirm your basis; do not rely
  on employee *consent*, see the note below.]`
- **Data minimization:** only signals the vendor APIs already expose are
  processed; no new surveillance surface is introduced. Team-level,
  pseudonymized aggregates are the default output (§4), so individual-level
  processing is the exception, not the rule.
- **⚠️ Employee consent is not a safe basis.** Under **EDPB Guidelines
  05/2020**, employee consent is presumptively *invalid* because of the
  employer–employee power imbalance — it cannot be "freely given." Design your
  rollout around legitimate interests + transparency + works-council
  involvement (§5, and the works-council note), not around asking staff to
  opt in.

## 4. Privacy-by-design measures already in the product (§7)

These are Revealyst defaults, so your DPIA can rely on them:

- **Team-level, pseudonymized by default.** People are stored under a
  **pseudonym**; real names surface only if an admin explicitly switches the
  org's visibility mode away from the **Private (team-only)** default.
- **Three privacy modes**, team-only is the default: **Private** (team-only,
  default) · **Managed visibility** · **Full visibility**.
- **Individual view is opt-in self-coaching**, never a manager-facing
  surveillance leaderboard.
- **No content capture, no per-user fabrication.** Where usage can only be
  attributed to a shared key or account, Revealyst keeps it at
  account level and flags it — it never invents per-person numbers from a
  shared subject (Product Spec §6.1).
- **Bounded retention** of raw payloads (~90 days) with automatic purge.
- **Encryption at rest** for the highest-value secrets (vendor API keys):
  per-row AES-256-GCM envelope encryption under a versioned application-held
  key (KEK), stored as a platform (Cloudflare Worker) secret and bound to
  `org:connection:kind`; **mechanically enforced tenant isolation** so one
  customer's data cannot be read by another.

## 5. Risks and mitigations

| Risk to data subjects | Likelihood / severity before mitigation | Mitigation | Residual |
|---|---|---|---|
| Feeling surveilled / chilling effect | Medium / Medium | Team-only pseudonymized default; transparency to staff; no content read; framed as tooling ROI, not performance management | Low |
| Score used as a disciplinary/performance metric | Low / High | Individual view is opt-in self-coaching; document internally that scores are **not** used for HR decisions `[state this in your worker notice]` | Low |
| Re-identification from pseudonymized aggregates | Low / Medium | Pseudonyms + team-level aggregation; individual identities gated behind an explicit visibility-mode change | Low |
| Over-attribution from shared accounts | Low / Low | Shared-account detection flags undercounting rather than fabricating people (§6.2); no per-user numbers invented | Low |
| Secret/credential compromise | Low / High | AES-256-GCM envelope encryption under a versioned Worker-secret key (KEK); credentials used only to read usage data (Revealyst performs no writes/admin actions) | Low |

## 6. Consultation & sign-off

- [ ] **Works council / employee representatives** consulted where applicable
      (in Germany, §87 BetrVG co-determination can be triggered by the
      system's *monitoring capability* — see the works-council notification
      note; consult **before** deployment, not after).
- [ ] **Workers informed** per the AI Act worker-notification checklist.
- [ ] **DPO reviewed** `[name / date]`.
- [ ] **Residual risk accepted by** `[controller sign-off / date]`.
- [ ] **Supervisory-authority prior consultation** considered (Art. 36) —
      usually **not** required given the low residual risk, but record the
      reasoning.

---

*Sources: GDPR Arts. 4(1), 6, 35, 36; EDPB Guidelines 05/2020 on consent;
Revealyst Product Spec §7 (privacy model) and §6.1–6.2 (attribution honesty
and shared-account detection). Adapt to your jurisdiction and have counsel
review before relying on it.*
