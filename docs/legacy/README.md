# Legacy documentation archive

These documents are **superseded by [Product Spec V4](../Revealyst_Product_Spec_V4.md)**
and its active companions, but are retained here as the historical record. Nothing in
this folder is current guidance — read it only to understand *how the product got here*,
never *what it is today*. Git history is preserved (every file was moved with `git mv`).

> **Source of truth is [Product Spec V4](../Revealyst_Product_Spec_V4.md).** For the active
> plan see [Execution Plan V4](../Revealyst_Execution_Plan_V4.md); for governance rules 1–7 +
> the scope tripwires see [the V1 Execution Plan](../Revealyst_Execution_Plan.md) (still the
> live home of those rules — deliberately kept in `docs/`, not here).

## What's here and why it was archived

| Document | Why archived | What (if anything) still holds |
|---|---|---|
| [Revealyst_Product_Spec_V2.md](Revealyst_Product_Spec_V2.md) | The V1 product spec. Superseded by V3, then V4. | The **V1 reference** — V4 §1 still binds "Spec V2 §2–§7 (market, architecture, data honesty, shared accounts, Personal mode, privacy, pricing, tech stack) except where V4 says otherwise." |
| [Revealyst_Product_Spec_V3.md](Revealyst_Product_Spec_V3.md) | The V1.5 product spec. Superseded by V4's pivot. | The **V1.5 reference** — V4 §1 binds "Spec V3 §§3–12 except where V4 says otherwise." |
| [Revealyst_Feasibility_Study.md](Revealyst_Feasibility_Study.md) | Pre-launch business-feasibility study; its positioning is retired by V4. | The business-feasibility math and competitive citations remain the historical record. |
| [marketing-strategy.md](marketing-strategy.md) | Framed around the retired CTO / "AI Fluency" flagship positioning. | The automation-first **channel mechanics** still stand; the persona/messaging framing does not. |
| [marketing-website-plan.md](marketing-website-plan.md) | Messaging/persona table retired by V4; the site is not yet built. | The build/SEO **mechanics** still stand; the messaging does not. |
| [launch/launch-plan.md](launch/launch-plan.md) | Share-card headline copy ("My AI Fluency: 78") and adoption-dashboard framing retired by V4. | Sequencing/framework kept as reference; copy must be re-cut against V4 before any launch. |
| [launch/announcements.md](launch/announcements.md) | Adoption-dashboard channel copy retired by V4. | Structure retained; copy needs re-cutting. |
| [launch/directories.md](launch/directories.md) | Standard product description predates the V4 pivot. | The directory list/process is still a valid reference for a not-yet-executed task. |
| [evidence/w1-g-preview-verification.md](evidence/w1-g-preview-verification.md) | One-off W1-G (PR #36→#46) manual preview-verification log from 2026-07-06; orphaned. | Purely historical. |

## Not archived (kept live in `docs/`, by design)

The project's convention is **supersede-but-retain-with-a-banner**, so several older docs
stay in `docs/` because active documents still depend on them:

- **[V1 Execution Plan](../Revealyst_Execution_Plan.md)** — still the authoritative home of
  orchestration rules 1–7 and the seven scope tripwires, carried into V4 verbatim.
- **[connector-facts.md](../connector-facts.md)** — a frozen contract (`contracts-v1`).
- **ADRs** ([docs/decisions/](../decisions/)) and **gate evidence** ([docs/gates/](../gates/)) —
  immutable history / audit trail.
- **[launch/benchmark-post-data-needs.md](../launch/benchmark-post-data-needs.md)** — still an
  open, positioning-orthogonal checklist.
