# External approvals — filings & chasers (rule 5)

External review lead time is the critical path. This file contains submittable
drafts; **filing is a founder action.** After filing, set up the `/schedule`
chaser routine (per the harness-setup doc) to poll status until each clears.

## Status checklist

| Filing | Where | When | Lead time | Status |
|---|---|---|---|---|
| GitHub App registration | github.com/settings/apps (or org) | **Now** (no site needed) | Instant to create; install-approval per customer org | ✅ filed |
| GitHub Marketplace listing (optional, deferrable) | Marketplace review | When the W2 site is live (needs public URLs) | Days–weeks (human review) | ☐ deferred |
| Anthropic / OpenAI / Cursor | — | — | **None needed** — customer-created admin keys | ✅ n/a |
| Paddle MoR onboarding | paddle.com | The instant W2 has a live site | Days–weeks (KYC) | 🔶 account created; **sandbox + production catalog configured** (see below); MoR/KYC approval status TBC |
| Legal pass (ToS/DPA/privacy) | counsel | When W3-N drafts terms | Weeks | ☐ **drafts ready — file with counsel** (W3-N: `docs/legal/`, `/legal/terms`, `/legal/privacy`) |
| Apple Developer Program + Developer ID Application cert (Desktop Agent T0.4) | developer.apple.com | **Now** — notarization lead time is the M6 long pole (rule 5) | Days (enrollment identity check) + cert issuance | ☐ pending founder enrollment (nothing filed yet — this row is the request) |
| Windows code-signing cert — **EV recommended** per D-DA-7 (avoids SmartScreen reputation lag) | CA of founder's choice (e.g. DigiCert/SSL.com) | **Now** | Days–weeks (EV org validation) | ☐ pending founder purchase |
| GitHub protected Environment `desktop-release` with required reviewer (Desktop Agent T0.4) | repo Settings → Environments | **Now** | Instant (founder action) | ☐ pending founder |
| Tauri updater keypair + remote-config Ed25519 keypair (Desktop Agent T0.4) | generate offline; store ONLY as `desktop-release` Environment secrets — never repo/PR-accessible secrets, never committed | With the `desktop-release` Environment | Instant once the Environment exists | ☐ pending founder |

Only GitHub requires an *app-shaped* approval, and only Copilot needs it: every
other V1 connector authenticates with a customer-created API key pasted into
Revealyst (encrypted per the W0-C credential contract).

---

## GitHub App registration (draft — submittable as-is)

Create as a **personal-account-owned app** now (transfer to the org later is
supported); public app so customer orgs can install it.

| Field | Value |
|---|---|
| App name | `Revealyst` (fallback: `Revealyst Analytics`) |
| Description | Read-only GitHub Copilot usage metrics for AI-adoption analytics. Revealyst reads daily Copilot usage reports and seat information to show teams who is using AI, how well, and whether they're getting their money's worth. No code access, no write access, no webhooks required. |
| Homepage URL | `https://revealyst.com` (placeholder until W2; GitHub accepts any valid URL at creation) |
| Callback URL | `https://app.revealyst.com/api/integrations/github/callback` (matches the internal API-route contract namespace; update at W2 if the route contract lands differently — route contracts freeze at W0-C) |
| Setup URL | `https://app.revealyst.com/api/integrations/github/setup` |
| Webhooks | **Disabled** (polling architecture; no webhook = smaller security-review surface for customer orgs) |
| Where can it be installed? | Any account |

### Permissions requested (all read-only)

| Permission | Level | Why (customer-security-review justification) |
|---|---|---|
| **Organization Copilot metrics** | Read | Core product: fetch the five `/orgs/{org}/copilot/metrics/reports/*` endpoints (org + per-user daily usage reports, user-team mapping). |
| **GitHub Copilot Business** (seat management) | Read | Seat inventory + `last_activity_at` from `/orgs/{org}/copilot/billing*` — needed to show unused seats and corroborate active users. Read-only; Revealyst never assigns/removes seats. |
| Organization members | Read | Map Copilot user logins to org membership for identity resolution (tracked_user contract). *(Verify during NLV-C1 whether the metrics + seat permissions already return enough identity data; drop this permission if redundant — request the minimum that works.)* |

**Not requested:** repository contents/code (never needed — tripwire: no
prompt/content ingestion), Administration read (would unlock AI-credit spend
via the billing API, but it is a heavyweight permission that will frighten
security reviewers; decision deferred — Copilot per-user spend is already in
the metrics report `ai_credits_used` field since 2026-06-19), webhooks, any
write permission.

**Enterprise Copilot metrics** (read): add only when the first GitHub
Enterprise customer appears; requesting enterprise permissions on day one
widens the review surface for every org-level install.

### Post-creation actions
1. Generate + store the App private key per the W0-C encrypted-credential contract (versioned Worker-secret KEK envelope) — never in the repo.
2. Note the App ID / client ID into deployment secrets.
3. Add the install flow to W2-J's Copilot connector plan (org admin installs the app → installation token → reports API).
4. When the W2 site is live: update homepage/callback URLs, then (optionally) submit the Marketplace listing — that is the only step with a human GitHub review queue.

### Filed — App identifiers (2026-07-05)

| Field | Value |
|---|---|
| App ID | `4215573` |
| Client ID | `Iv23li7wFumkZwiRogYu` |

Client secret and private key generated at creation time and added to GitHub
repo secrets (not committed here). Distinct from the *login* OAuth app's
`GH_OAUTH_CLIENT_ID`/`GH_OAUTH_CLIENT_SECRET` (see `docs/infra.md`) — this app
is scoped only to the Copilot metrics connector (rule 7: one GitHub App, no
broader scope). Repo secret naming for W2-J to consume:

| Value | Repo secret name |
|---|---|
| App ID | `GH_COPILOT_APP_ID` |
| Client ID | `GH_COPILOT_APP_CLIENT_ID` |
| Client secret | `GH_COPILOT_APP_CLIENT_SECRET` |
| Private key (PEM) | `GH_COPILOT_APP_PRIVATE_KEY` |

Not yet wired into `deploy.yml` or any Worker binding — that happens when the
W2-J Copilot connector is built and actually consumes these.

---

## OAuth scope notes (non-App fallback)

If a customer refuses GitHub Apps, a classic-PAT fallback works: `read:org`
(+ `manage_billing:copilot` for seat endpoints). Document as a degraded path —
PATs are user-bound and expire; the App is the recommended integration.

No OAuth filings are needed for Anthropic (admin key `sk-ant-admin01-…`,
created by an org admin), OpenAI (admin key `sk-admin-…`, created by the org
owner), or Cursor (`crsr_…` team key, created by a team admin). Onboarding UI
for each = "create this key type, paste it here" with per-vendor screenshots
(W2 content task).

---

## Paddle — catalog IDs (configured 2026-07-07)

Set up via the Paddle MCP server (Spec v2.4 pricing: $2/user/mo list + 50%
founder discount). **Both sandbox and production are configured** — IDs differ
per environment, so W3-M must select by `PADDLE_ENVIRONMENT`. These IDs are
**config, not secrets** — safe to commit; W3-M consumes them.

### Sandbox

| Object | Sandbox ID | Notes |
|---|---|---|
| Product | `pro_01kwxp8090acsjpd3ypjtbhcm7` | "Revealyst Team", tax category `saas` |
| Price | `pri_01kwxp80bbbgpaaat2501eybpb` | $2.00/tracked user/mo (200¢ USD), monthly, quantity 1–10,000 |
| Discount | `dsc_01kwxp80eny3jr72zc3qkdhh7z` | code `FOUNDER`, 50% off, recurring, expires `2026-08-31T23:59:59Z`, restricted to the Team product |
| Webhook dest. | `ntfset_01kwxp80kkb9ye9whrggx3qkdd` | url → `/api/webhooks/paddle`; 4 events; `traffic_source: all` (incl. simulation, for W3-M CI tests) |

### Production (live)

| Object | Production ID | Notes |
|---|---|---|
| Product | `pro_01kwxr7mccxmbzjqfegmnfa382` | "Revealyst Team", tax category `saas` |
| Price | `pri_01kwxr7mysf3s37c9tk3mmd5y6` | $2.00/tracked user/mo (200¢ USD), monthly, quantity 1–10,000 |
| Discount | `dsc_01kwxr7n6f46g0dn190zvev43g` | code `FOUNDER`, 50% off, recurring, expires `2026-08-31T23:59:59Z`, Team-only, **`enabled_for_checkout: true` — LIVE/publicly redeemable now** |
| Webhook dest. | `ntfset_01kwxr7necjebkw89g6fndtyfv` | url → `/api/webhooks/paddle`; 4 events; `traffic_source: platform` (real events only) |

**Webhook signing secrets are NOT recorded here** (sensitive). Each environment
returns its own at creation; store them as Worker/repo secrets (e.g.
`PADDLE_WEBHOOK_SECRET_SANDBOX` / `PADDLE_WEBHOOK_SECRET`) when W3-M builds the
handler — never in a tracked file.

⚠️ **Both webhook destinations point at `/api/webhooks/paddle`, which does not
exist until W3-M** — so both log delivery failures until the handler ships, and
Paddle may **auto-deactivate** the *production* destination after sustained
failures. W3-M: check both destinations are `active` and re-activate the
production one if needed (`notificationSettings.update { active: true }`).

**Founder-discount model:** `recur: true` + `expires_at` = redeem `FOUNDER` before
the sunset date to lock in 50% off on every renewal; after the date the code can
no longer be redeemed. This is the §11 "time-boxed, publicly sunset-dated founder
pricing as a discount" model — not a first-N-months discount.

## Chaser setup (after filing)

Per Workflow §3 W0 step 5: create a `/schedule` cloud routine (daily) that
checks each ☐ item above and reports status; retire it when all clear. Loops
(`/loop`) are for same-day watches only.
