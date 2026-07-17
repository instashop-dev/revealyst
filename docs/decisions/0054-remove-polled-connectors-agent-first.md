# 0054 — Remove the polled connectors; go agent-first (usage-source model)

- **Status:** Accepted
- **Date:** 2026-07-17
- **Deciders:** Founder decision this session — "remove the polled admin-API
  connectors now and lead with the desktop-agent usage-source model." With two
  founder-chosen constraints: **existing connector data is frozen in place** (no
  destructive migration, no retroactive billing/history change), and the
  device/local-agent surface **relocates into Settings → Devices** (no new
  primary-nav route). Reverses/retires the connector-facing halves of **ADR 0013**
  (connections management UI), **ADR 0022** (GitHub Copilot App connect), and
  **ADR 0032** (renewal reminders).
- **Implemented:** branch `remove-polled-connectors`. No migration; no frozen
  contract file changed (deliberate — see Registrations).

## Context

Revealyst is pivoting from "measure AI-tool *adoption* via admin/API keys" to
"understand AI *capability, workflows, prompt quality, learning, maturity*" —
behavioral signal that lives **inside the AI tools** (Claude Code, Cursor,
Codex, ChatGPT, Claude Desktop/claude.ai) and is captured by the **desktop
agent** ("Devices"), not by polling vendor APIs. Most knowledge workers never
touch an LLM API, so the admin-API connectors measure the wrong surface for the
new thesis.

One architectural fact shapes the whole change: **"Devices" is not a separate
model from "Connections."** A paired device is a row in the `connections` table
(`vendor = "claude_code_local"`), and every `subject`/`metric_record` carries a
NOT-NULL composite FK to a `connections` row. So the `connections` table,
`connection_credentials`, the `org-scope` `connections`/`renewalReminderState`
API, and the device push path (`/api/agent/ingest`, `/v1/metrics`, `/v1/logs`,
PKCE pairing) **must stay**. "Remove connectors" therefore means removing the
*polled admin-API vendors*, the poll dispatch, the connect UI, the `/connections`
nav surface, and the renewal-reminder feature — while the table and the
agent/OTel ingest paths keep running.

## Decision

**Remove (product-facing):**

- **The connector registry ships empty** (`src/connectors/index.ts` registers
  nothing). `getConnector` returns undefined for every vendor and
  `registeredVendors()` returns `[]`, so nothing is pollable or connectable.
- **Cron poll dispatch is deleted** from the worker `*/5` tick
  (`dispatchDueConnectorWork` call removed; the heartbeat + raw-payload purge
  stay). Combined with the empty registry, this *guarantees* existing frozen
  connector rows stop polling.
- **The `/connections` route + the connector connect UI** are deleted:
  add-connection dialog, connection cards, GitHub-App connect card, API-key
  onboarding cards, and the `connect-vendor`/`connections-view`/
  `vendor-connect-meta` libs. The **"Connections" nav item** is removed for
  personal, team, and system orgs.
- **The connector-only API routes** are deleted (`/api/connections/:id/{poll,
  credential}`, `/api/connections/:id`, and the `/api/integrations/github/*`
  App-install routes). **Kept:** `POST /api/connections` (the device pairing
  flow creates the `claude_code_local` row through it) and
  `/api/connections/:id/agent-token`.
- **The renewal-reminder feature** (cron scan + admin emails, ADR 0032) is
  removed — its only UI entry (per-connection renewal editing) died with the
  connect UI, and its `/connections` CTA no longer resolves.

**Relocate:** the desktop-agent pairing card + sync transparency panel move onto
**Settings → Devices** (`/settings/devices`), which already lists paired
devices. All prior "connect a source" CTAs (companion coaching, growth empty
state, team dashboard, needs-attention items) now point at `/settings/devices`.
Onboarding + the marketing landing are rewritten to lead with the Revealyst
Agent (Claude Code); the landing "Connects" strip is a static honest list
(Claude Code today — no not-yet-built source is present-tensed, invariant b /
W3-N).

**Freeze in place (no migration):** existing connector `connections` rows,
their `connection_credentials`, and their historical `metric_records` are left
untouched — they simply stop updating. The `connections.renewalDate` column and
the `renewal_reminder_state` table stay in the schema, **inert**; the frozen
`VENDOR_IDS` enum keeps its connector values (historical rows reference them).

### The vendor connector modules stay in-repo as test fixtures (a deliberate deviation)

The plan's cleanup list called for deleting `src/connectors/{anthropic,copilot,
cursor,openai}/**` and the poll pipeline (`src/poller/{dispatch,run,backfill}.ts`).
They are **kept**. Those modules are decoupled fixture generators (rule 2 —
"fixtures over coupling"): the pure `normalize()` functions and the poll
pipeline back the ingest→score end-to-end test (`tests/e2e/
ingest-to-score.e2e.test.ts`), the shared seam harness (`tests/harness/
seams.ts`), and ~8 connector/framework tests. Deleting them forces a large,
risky rewrite of that test infrastructure for **zero product benefit** — the
product removal is fully achieved by the empty registry + the deleted dispatch,
UI, nav, and routes. They are now unregistered, unreachable code that exists
only to exercise the downstream engine. Deleting the dead modules later is an
optional, separate chore (recorded as a follow-up, not done here).

## Registrations (why this needs no migration and touches no frozen path)

Freeze-in-place was chosen specifically so the change edits **no frozen
contract**: `src/contracts/**`, `src/db/schema.ts` / `drizzle/**`, the
`org-scope.ts` public API, `src/lib/credentials.ts`, and
`docs/connector-facts.md` are all byte-identical. `renewalReminderState` stays a
`forOrg` namespace with its `tests/tenant-isolation.test.ts` SCOPED_READS entry
and its `account-deletion.ts` PURGE_TABLES entry intact (the table lives on,
just unfed). `npx drizzle-kit generate` reports zero diff. The CI frozen-contract
guard stays green because nothing under a frozen path changed. This ADR + the
`docs/product-signoffs.md` row are the durable record of a founder-level product
reversal that would otherwise leave no schema trace.

## Consequences

- **Coverage narrows to Claude Code (accepted).** The desktop agent today
  collects only Claude Code (plus a gated, parse-only claude.ai export). Cursor,
  OpenAI/ChatGPT, and Copilot usage — previously reachable *only* through the
  polled connectors — stop being ingested. The multi-vendor behavioral capture
  the pivot describes (Cursor/Codex/ChatGPT/Claude Desktop agent connectors) is
  separate, gated future work; until it lands, breadth is traded for a coherent
  agent-first story.
- **`tracked_user` counts decay naturally for connector-only orgs.** Billing is
  source-agnostic (it counts `metric_records` per period, never connectors), so
  freeze-in-place changes nothing retroactively — but an org that relied solely
  on a connector will see its rolling-window billable count fall as the window
  advances past its last connector data.
- **The poll pipeline is inert, not deleted.** It remains as fixtures; a future
  chore may delete it and rewrite the e2e/harness onto the agent-ingest path
  (which would be a more faithful test of the surviving ingest path).
- **Re-introducing a polled connector** means re-registering its module in
  `src/connectors/index.ts` and re-wiring the dispatch call — and, per this
  ADR's reversal, would itself want a fresh decision record.
