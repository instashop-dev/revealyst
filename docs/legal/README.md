# Legal drafts — for the legal pass (W3-N)

These are the **draft** legal documents for Revealyst, produced by W3-N as
static content and handed to the human legal pass (tracked in
`docs/approvals.md`). None is binding until counsel finalizes it.

## What to review, and where each lives

| Document | Source of truth | Live URL | Notes |
|---|---|---|---|
| **Terms of Service** | `src/app/legal/terms/page.tsx` | `/legal/terms` | Public page; self-serve signup and Paddle MoR onboarding link to it. |
| **Privacy Policy** | `src/app/legal/privacy/page.tsx` | `/legal/privacy` | Public page; grounded in the real data model (Product Spec V4 §13). |
| **Data Processing Agreement** | `docs/legal/dpa.md` | — (provided to customers on request) | Art. 28 processor DPA; not a public marketing page. |

The Terms and Privacy Policy are authored directly as the **live public pages**
(single source of truth) so signup/Paddle have real linkable URLs; the DPA is a
document provided to customers, so it lives as markdown here.

## The MoR split counsel should know

**Paddle is the Merchant of Record.** Paddle is the *seller of record* and
handles payment, invoicing, and global sales-tax/VAT collection and remittance
— so the **sale** is covered by Paddle's terms and Paddle is an independent
controller of payment data. What remains **ours** to get right is the
**product's data-processing terms**: the Terms of Service (use of the Service),
the Privacy Policy, and the DPA (our processor obligations to customer
controllers). Those three are what this legal pass covers.

## Grounding / non-negotiables for the reviewer

All product-behavior statements are grounded in the real system and must stay
accurate (Product Spec V4 §13; the credential and tenancy frozen contracts):

- **No prompt/completion content is ever processed** — no content field exists
  in the schema; the Revealyst Agent summarizes locally.
- **Team-level, pseudonymized by default**; individual data is never fabricated
  from shared accounts.
- **Vendor credentials**: per-record AES-256-GCM envelope encryption under a
  versioned application-held key (KEK). **There is no third-party KMS** — do not
  reintroduce a "KMS" claim (an earlier draft did; it was corrected).
- **Raw payload retention ~90 days**, then automatic purge.
- **Anonymized-benchmark contribution is opt-in, off by default** (the
  `benchmark_consent` record, ADR 0008).

## Open items for counsel (bracketed in the drafts)

Legal entity name, governing jurisdiction, liability cap, effective dates,
contact emails, the confirmed live sub-processor list + transfer mechanisms,
and sub-processor-change notice terms. Search the drafts for `[` to find each.
