# Data Processing Agreement (DPA) — DRAFT

> **W3-N draft, pending the human legal pass** (`docs/approvals.md`). This DPA
> is the data-processing contract between a customer (**controller**) and
> Revealyst (**processor**) under GDPR Art. 28. Paddle, as Merchant of Record,
> is an independent controller for payment data and is **not** covered here.
> Bracketed `[…]` fields are for counsel / the operating entity. Product-
> behavior clauses are grounded in the real system (Product Spec §7; the
> credential and tenancy frozen contracts) — do not add controls the product
> does not implement.

## 1. Parties and roles

- **Controller:** the customer organization using Revealyst for its workers.
- **Processor:** `[Legal entity name]` operating Revealyst.
- This DPA applies where the Processor processes personal data on behalf of the
  Controller. It forms part of, and is subject to, the Terms of Service.

## 2. Subject matter, nature, and purpose

The Processor processes the Controller's workers' personal data solely to
provide the Revealyst analytics service: reading behavioral usage and cost
signals from the Controller's connected vendor accounts and the optional
Revealyst Agent, normalizing them, and computing adoption/fluency/efficiency
scores. **No prompt, completion, code, or message content is processed.**

## 3. Categories of data subjects and personal data

- **Data subjects:** the Controller's workers whose AI-tool usage is visible to
  the connected accounts.
- **Personal data:** account/identity data (name, email, vendor account
  identifiers) and **behavioral usage metrics** (active days, sessions, prompt/
  message counts, tokens, spend, model mix, acceptance/retry rates, feature
  usage, output-shipped counts) per person/tool/day, plus derived scores.
- **No special-category data.** **No content data.**

## 4. Duration

For the term of the Controller's subscription, plus the deletion/return period
in §10.

## 5. Controller instructions

The Processor processes personal data only on the Controller's documented
instructions, including as set out in this DPA and the Terms, unless required
by law (in which case it notifies the Controller unless legally prohibited).

## 6. Confidentiality

Personnel authorized to process the data are bound by confidentiality.

## 7. Security measures (Art. 32)

- **Encryption at rest** of the highest-value secrets (vendor credentials):
  per-record AES-256-GCM envelope encryption under a versioned application-held
  key (KEK), bound to `org:connection:kind`. *(No third-party KMS is used; the
  KEK is a platform-managed secret — describe accurately, do not claim a KMS.)*
- **Mechanically enforced tenant isolation** so one Controller's data cannot be
  read by another (composite tenant foreign keys + a mandatory org-scoping
  query layer + an automated cross-tenant-read test).
- **Read-only use of vendor credentials** — Revealyst performs only read
  operations, never writes or administrative changes. (Some vendor admin keys
  are broadly scoped by the vendor; the restriction is enforced by how the
  Processor uses them, not by the key's own scope.)
- **Bounded retention** with automatic purge of raw payloads (§10).
- `[Add: access controls, logging, backup, incident detection — counsel/ops to
  confirm against the W3-O hardening pass.]`

## 8. Sub-processors

- The Controller authorizes the Processor to engage sub-processors, currently:
  **[Neon]** (database hosting), **[Cloudflare]** (application compute and
  delivery). `[Confirm the live list, locations, and roles.]`
- The Processor imposes data-protection obligations on sub-processors no less
  protective than this DPA, and remains liable for their performance.
- The Processor gives notice of intended changes to sub-processors and allows
  the Controller to object. `[Set the notice mechanism/period.]`

## 9. International transfers

Where personal data is transferred outside the EEA/UK, the transfer is
protected by an appropriate safeguard (e.g. **Standard Contractual Clauses**).
`[Identify each transfer, importer, and mechanism — counsel to confirm against
the live sub-processor locations.]`

## 10. Return and deletion

- Raw vendor payloads are automatically purged ~**90 days** after ingestion.
- On termination, the Processor deletes or returns the Controller's personal
  data within `[period]`, subject to legal retention requirements.

## 11. Assistance to the Controller

The Processor assists the Controller, taking into account the nature of
processing, with: data-subject rights requests; security (Art. 32); breach
notification (Arts. 33–34) **without undue delay** after becoming aware; DPIAs
(Art. 35) and prior consultation (Art. 36) — the in-app compliance guidance and
DPIA template support this.

## 12. Audit

The Processor makes available information necessary to demonstrate compliance
with Art. 28 and allows for and contributes to audits. `[Set audit scope,
frequency, and confidentiality terms.]`

## 13. Order of precedence

In case of conflict, this DPA prevails over the Terms with respect to
processing of personal data.

---

*Sources: GDPR Arts. 28, 32–36; Revealyst Product Spec §7 and the credential /
tenancy frozen contracts. This is a draft for the legal pass — not binding
until finalized by counsel.*
