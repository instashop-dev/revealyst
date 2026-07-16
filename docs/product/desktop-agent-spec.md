# Revealyst Desktop Agent — Technical Specification (transcribed)

> **Provenance:** transcribed 2026-07-16 from the founder-provided
> `Revealyst Desktop Agent Technical Specification.docx` (formatting restored;
> content unchanged). The original carries per-claim confidence tags
> (`[KNOWN|INFERRED, HIGH|MED|LOW]`); tags are preserved only where the
> confidence level changes what the plan may assume.
>
> **Standing:** this is the **technical source of truth for the Desktop Agent's
> scope, privacy constraints, platform support, and acceptance criteria**.
> [Product Spec V4](../Revealyst_Product_Spec_V4.md) remains the product ground
> truth; where the two touch (self-view-only in Team orgs, resident-agent
> cadence gate, "No prompt content. Ever."), conflicts are reconciled in
> [desktop-agent-gap-analysis.md](desktop-agent-gap-analysis.md) and queued in
> `docs/product-signoffs.md` — never resolved silently. §4's proposed repo
> layout is `[INFERRED]` and is **adapted** to the actual repo by the
> [Desktop Agent Execution Plan](../Revealyst_Desktop_Agent_Execution_Plan.md),
> which is authoritative on file placement.

## 0. Purpose

Revealyst Desktop Agent is a lightweight, cross-OS desktop utility that ingests
supported local AI-usage signals, processes them locally, and syncs
privacy-preserving analytics events to Revealyst.

It is **not** a desktop dashboard, employee surveillance tool, screen recorder,
keylogger, browser inspector, or Claude conversation scraper.

The default implementation must not transmit raw prompts, responses, files,
screenshots, clipboard contents, browser cookies, or AI-provider credentials to
Revealyst.

The default product promise:

> Connect this computer once. Revealyst will securely sync supported AI-usage
> analytics in the background without uploading your prompt text.

## 1. Core product decisions

### 1.1 Desktop agent type

A background desktop utility with a small tray/menu-bar UI. The Revealyst web
application remains the main product surface for: individual AI growth
insights, team capability dashboards, manager views, coaching, reports, admin
settings, connection management.

The desktop agent only handles: device enrollment, local source detection,
local signal extraction, local privacy processing, encrypted local queueing,
background synchronization, update management, connection health, diagnostics.

### 1.2 Default data mode

The default data mode is **Analytics Only**: the agent uploads derived metadata
and feature signals, not raw prompt or response content. This is sufficient for
Revealyst's initial product direction: AI adoption, capability maturity,
workflow coverage, team-level insights, and coaching recommendations.

### 1.3 Prompt data policy

- Raw prompt and response upload is not required for MVP.
- Raw prompt and response upload must not be silently enabled.
- Prompt content may be supported later only as an explicit opt-in mode called
  Deep Coaching or Full Content, with visible user/admin disclosure and
  separate policy controls.

### 1.4 Browser extensions

Browser extensions are Phase 2. The desktop agent must not inspect browser
history, browser local storage, browser cookies, browser DOM, or browser
traffic in Phase 1.

### 1.5 Claude API

Claude API connection is not the primary Phase 1 path. It may remain an
advanced optional connector later for teams with API usage, cost analytics,
automation analytics, or enterprise reporting needs.

## 2. Goals

### 2.1 Functional goals

The agent must: install cleanly on macOS and Windows; run quietly in the
background; start at login after user approval; authenticate through the
Revealyst web app; register the current device; support multiple devices per
user; attribute activity to the authenticated Revealyst user, not merely to
the AI-provider account; discover supported local AI sources; collect only
explicitly supported signals; locally compute analytics features; queue events
securely while offline; sync automatically; update itself safely; show
transparent collection coverage; provide user-friendly status, privacy, and
diagnostics screens.

### 2.2 Non-functional goals

Cross-platform · lightweight · secure by default · privacy-preserving by
default · easy to update · easy to uninstall · stable across restarts ·
resilient to network loss · honest about unsupported sources · extensible
through connectors · decoupled from web-app release cadence.

### 2.3 Non-goals (Phase 1 must NOT include)

Browser extensions · screen recording · keystroke capture · clipboard
monitoring · network interception · TLS proxying · provider-session-cookie
reading · provider-password collection · universal Claude Desktop chat
ingestion · manager access to employee prompts · raw prompt upload by default ·
a local analytics dashboard · Linux distribution · privileged system service ·
mobile-device collection.

## 3. Recommended technology stack

### 3.1 Framework

Use **Tauri 2** for the desktop agent, with:

- Rust for trusted local runtime logic.
- React and TypeScript for onboarding, status, privacy, and diagnostics UI.
- SQLite for local queue and state.
- Operating-system credential storage for secrets.
- Signed Tauri updater for releases.

Tauri is preferred because the agent needs a small UI and low background
overhead. `[INFERRED, MED]` Electron should be used only if the team lacks
Rust capacity or if Tauri blocks a critical platform requirement.

### 3.2 Official Tauri capabilities

`[KNOWN, HIGH]` Tauri officially supports: system tray, an autostart plugin,
deep-link handling via configured URL schemes, and an updater that requires
signed updates and verifies update signatures.

### 3.3 Supported platforms

| Platform | Minimum          | Architecture          | Installer                  |
|----------|------------------|-----------------------|----------------------------|
| macOS    | macOS 13         | Apple Silicon + Intel | signed, notarized `.dmg`   |
| Windows  | Windows 10 22H2  | x64                   | signed `.exe` or `.msi`    |
| Linux    | deferred         | deferred              | none                       |

`[KNOWN, HIGH]` Apple requires notarization for Developer ID-distributed macOS
software outside the Mac App Store. Microsoft SignTool digitally signs Windows
packages and verifies publisher identity and package integrity.

## 4. Repository and deployment structure

`[INFERRED]` The desktop agent should live inside the main Revealyst monorepo
but **release independently**. (The original proposes an `apps/` + `packages/`
+ `services/` split; the execution plan adapts this to the actual repo layout —
see the Standing note above.)

Same repository must not mean same release lifecycle. The desktop agent must
have: independent app version · independent CI workflow · independent release
workflow · independent signing credentials · independent staged rollout ·
independent update channel · shared schemas and contracts with the backend.

## 5. High-level architecture

```
┌────────────────────────────────────────────┐
│              Revealyst Cloud               │
│  Auth Service · Device Service             │
│  Remote Config Service · Ingestion API     │
│  Normalization Worker · Deduplication      │
│  Analytics + Coaching Engine               │
└──────────────────▲─────────────────────────┘
                   │ HTTPS
┌──────────────────┴─────────────────────────┐
│         Revealyst Desktop Agent            │
│  Tray/Menu Bar UI · Onboarding UI          │
│  Privacy UI · Diagnostics UI               │
│  Auth Agent · Device Identity              │
│  Policy Engine · Connector Runtime         │
│  Local Feature Extractor                   │
│  Privacy Processor                         │
│  Encrypted Event Queue · Sync Engine       │
│  Update Manager · Diagnostics Engine       │
└────────────────────────────────────────────┘
```

## 6. Data philosophy

### 6.1 Principle

Revealyst should measure AI capability without requiring employees to expose
prompt text. This is product-critical because trust directly affects adoption.

### 6.2 Three data modes

#### Mode 1 — Analytics Only (default)

**Upload allowed:** source name · product name · event timestamp · session
duration · prompt character count · prompt word count · response character
count · response word count · turn count · iteration count · tool invocation
count · file-operation count where available · model name where available ·
token count where available · locally inferred task category · locally
inferred workflow type · locally inferred prompt-structure features · locally
inferred complexity band · local confidence score · connector health metadata ·
attribution metadata · privacy-policy version.

**Upload prohibited:** raw prompt text · raw response text · full conversation
transcript · file contents · screenshots · clipboard contents · browser
cookies · provider access tokens · provider refresh tokens · provider
passwords · raw environment variables · unrelated local paths.

#### Mode 2 — Redacted Summary

`[INFERRED, MED]` Optional; should not be implemented until Analytics Only is
stable. Upload allowed only after explicit opt-in: locally generated task
summary, locally redacted prompt/response snippets, locally redacted failure
examples, redaction metadata. The UI must state that redaction reduces risk but
cannot guarantee removal of every sensitive fact.

#### Mode 3 — Full Content

Explicit opt-in only, after clear consent or visible organization policy: raw
prompts, raw responses, conversation structure, selected file references
(never files by default). For deep coaching, prompt review, workflow review,
user-approved diagnostics. **Disabled by default for team deployments.**

## 7. Local feature extraction

### 7.1 Purpose

Convert local activity into privacy-preserving capability signals before
upload.

### 7.2 Feature extractor input

Feature extractors may temporarily access prompt-like content **only inside
the local process** if the source connector legitimately has access to it. In
Analytics Only mode, prompt-like content must be discarded before queue
persistence.

### 7.3 Feature extractor output

```ts
export interface LocalPromptFeatures {
  promptCharacterCount: number;
  promptWordCount: number;
  hasContext: boolean;
  hasConstraints: boolean;
  hasExamples: boolean;
  hasOutputFormat: boolean;
  hasSuccessCriteria: boolean;
  hasRoleInstruction: boolean;
  hasDataProvided: boolean;
  hasFollowUp: boolean;
  taskCategory:
    | "coding" | "debugging" | "research" | "writing" | "summarization"
    | "data_analysis" | "planning" | "customer_support" | "sales_marketing"
    | "operations" | "unknown";
  workflowType:
    | "one_shot" | "iterative" | "tool_augmented" | "document_based"
    | "code_based" | "multi_step" | "unknown";
  complexityBand: "low" | "medium" | "high" | "unknown";
  localClassifierVersion: string;
  localClassifierConfidence: number;
}
```

### 7.4 Classifier implementation

Initial implementation uses deterministic and transparent local heuristics.
`[INFERRED, MED]` A small local classifier may come later if accuracy justifies
bundle size, CPU cost, and privacy review. **Do not call a cloud LLM from the
agent to classify prompts in Analytics Only mode.**

### 7.5 Example Analytics Only event

```json
{
  "eventType": "prompt_submitted",
  "provider": "anthropic",
  "product": "claude_code",
  "contentMode": "analytics_only",
  "occurredAt": "2026-07-16T10:20:31Z",
  "payload": {
    "promptCharacterCount": 1482,
    "promptWordCount": 233,
    "hasContext": true,
    "hasConstraints": true,
    "hasExamples": false,
    "hasOutputFormat": true,
    "hasSuccessCriteria": true,
    "taskCategory": "coding",
    "workflowType": "multi_step",
    "complexityBand": "high",
    "localClassifierVersion": "heuristics-v1",
    "localClassifierConfidence": 0.78,
    "rawPromptIncluded": false,
    "rawResponseIncluded": false
  }
}
```

## 8. Authentication

### 8.1 Flow

System-browser authentication with OAuth Authorization Code + PKCE:

```
Agent creates PKCE verifier/challenge
  → Agent opens Revealyst web login
  → User signs in through browser
  → Revealyst redirects to revealyst://desktop-auth/callback
  → Agent validates state
  → Agent exchanges code for tokens
  → Agent registers device
  → Agent stores refresh token in OS secure storage
```

The agent must not show a password form inside the desktop UI.

### 8.2 Deep link

Use a custom URI scheme such as `revealyst://desktop-auth/callback`. Validate:
state · nonce · code lifetime · PKCE verifier · redirect source · one-time
code use.

### 8.3 Token storage

Store refresh tokens in the macOS Keychain or Windows Credential Manager /
DPAPI-backed storage. Do **not** store refresh tokens in frontend local
storage, SQLite, config files, logs, or crash reports.

## 9. Device enrollment and identity

### 9.1 Device identifiers

```ts
export interface DeviceEnrollment {
  installationId: string;      // locally generated
  deviceId: string;            // server issued
  deviceDisplayName: string;
  platform: "macos" | "windows";
  architecture: "arm64" | "x64";
  agentVersion: string;
  publicDeviceKey: string;     // device keypair generated at enrollment
  createdAt: string;
}
```

Do not derive identity from MAC address, motherboard serial, disk serial, or
other permanent hardware identifiers.

### 9.2 Multi-device model

One Revealyst user may enroll multiple devices (work MacBook, office Windows
PC, home Mac). Setup is one-time per device. Cloud analytics should merge all
enrolled device events into one user timeline.

## 10. Shared AI-account attribution

### 10.1 Main rule

Activity must be attributed to the **authenticated Revealyst user and
registered installation**. AI-provider account identity is secondary evidence
only.

### 10.2 Shared Claude credentials

If Alice and Bob use the same Claude login on different computers, Revealyst
still attributes events separately because each desktop agent is authenticated
as a different Revealyst user.

### 10.3 Shared OS session

If multiple people share the same computer, OS account, Claude login, and
Revealyst session, reliable automatic attribution is impossible — mark events
as **ambiguous** instead of guessing.

```ts
export interface Attribution {
  revealystUserId: string;
  installationId: string;
  osUserHash?: string;
  providerUserHash?: string;
  method:
    | "authenticated_installation"
    | "authenticated_installation_and_os_user"
    | "manual_import"
    | "ambiguous_shared_session";
  confidence: number;
  conflict: boolean;
}
```

## 11. Source connector architecture

### 11.1 Connector contract (Rust)

```rust
#[async_trait]
pub trait SourceConnector: Send + Sync {
    fn descriptor(&self) -> ConnectorDescriptor;
    async fn detect(&self, ctx: &ConnectorContext) -> Result<DetectionResult>;
    async fn request_permissions(&self, ctx: &ConnectorContext) -> Result<PermissionResult>;
    async fn load_checkpoint(&self, ctx: &ConnectorContext) -> Result<Option<Checkpoint>>;
    async fn collect(&self, ctx: &ConnectorContext, checkpoint: Option<Checkpoint>)
        -> Result<CollectionBatch>;
    async fn health(&self, ctx: &ConnectorContext) -> Result<ConnectorHealth>;
    async fn disconnect(&self, ctx: &ConnectorContext) -> Result<()>;
}
```

### 11.2 Connector states

```ts
export type ConnectorState =
  | "not_detected" | "detected" | "permission_required" | "ready"
  | "collecting" | "partially_supported" | "paused" | "degraded"
  | "blocked" | "disabled_remotely" | "unsupported_version";
```

### 11.3 Initial connectors

#### 11.3.1 Claude Code connector

`[INFERRED, MED]` Implement only against confirmed local data surfaces or
supported telemetry validated during implementation. Do not assume every
Claude Code detail is available locally. If a local format is unsupported,
return `unsupported_version` rather than parsing partially.

#### 11.3.2 Claude export importer

Support manual import of Claude data export as a user-initiated action. The
importer must: validate archive type · reject path traversal · enforce
file-count and decompressed-size limits · parse locally · convert to the
selected privacy mode · queue normalized events · delete temporary extraction
files · show imported/skipped/failed counts. In Analytics Only mode, raw
conversation text from the export must not be uploaded.

#### 11.3.3 Process presence connector

`[INFERRED, LOW]` Possibly useful only for connection-coverage diagnostics.
Process presence must not be treated as AI capability evidence. Disabled by
default unless there is a clear product use case.

## 12. Event schema

### 12.1 Normalized activity event

```ts
export interface RevealystActivityEvent {
  eventId: string;
  schemaVersion: number;
  organizationId?: string;
  revealystUserId: string;
  deviceId: string;
  installationId: string;
  provider: string;
  product: string;
  connectorId: string;
  connectorVersion: string;
  sourceEventId?: string;
  sourceConversationId?: string;
  sourceSessionId?: string;
  eventType:
    | "session_started" | "session_ended" | "prompt_submitted"
    | "response_completed" | "tool_invoked" | "tool_completed"
    | "file_modified" | "conversation_imported" | "usage_summary";
  occurredAt: string;
  observedAt: string;
  contentMode: "analytics_only" | "redacted_summary" | "full_content";
  payload: Record<string, unknown>;
  attribution: Attribution;
  privacy: {
    processedLocally: boolean;
    rawPromptIncluded: boolean;
    rawResponseIncluded: boolean;
    rawFileContentIncluded: boolean;
    redactionVersion?: string;
    policyVersion: string;
  };
}
```

### 12.2 Analytics Only payload contract

```ts
export interface AnalyticsOnlyPayload {
  sessionDurationMs?: number;
  promptCharacterCount?: number;
  promptWordCount?: number;
  responseCharacterCount?: number;
  responseWordCount?: number;
  turnCount?: number;
  iterationCount?: number;
  toolInvocationCount?: number;
  modelName?: string;
  inputTokenCount?: number;
  outputTokenCount?: number;
  taskCategory?: string;
  workflowType?: string;
  complexityBand?: string;
  localClassifierVersion?: string;
  localClassifierConfidence?: number;
  rawPromptIncluded: false;
  rawResponseIncluded: false;
}

type ProhibitedAnalyticsOnlyFields =
  | "prompt" | "response" | "messages" | "conversationText" | "transcript"
  | "fileContent" | "screenshot" | "clipboard" | "cookie"
  | "accessToken" | "refreshToken" | "password";
```

## 13. Local storage

### 13.1 Storage components

Encrypted SQLite for local non-secret state:

```
agent.db
├── installation_state
├── connector_state
├── connector_checkpoints
├── pending_events
├── upload_receipts
├── policy_cache
├── remote_config_cache
├── diagnostics_state
└── update_state
```

Secrets live **only** in OS secure storage.

### 13.2 Queue rules

Events must be committed to the encrypted queue **before** connector
checkpoints advance. On crash, duplicate events are acceptable; data loss is
not. Server-side idempotency must deduplicate retries.

### 13.3 Retention defaults

| Data                              | Retention                                |
|-----------------------------------|------------------------------------------|
| Pending events                    | 30 days                                  |
| Upload receipts                   | 30 days                                  |
| Connector checkpoints             | until connector reset                    |
| Diagnostic logs                   | 7 days                                   |
| Temporary imports                 | delete immediately after processing      |
| Raw text in Analytics Only mode   | **never persist**                        |

## 14. Synchronization

### 14.1 Delivery semantics

At-least-once delivery with server-side idempotency. Do not claim exactly-once
delivery.

### 14.2 Batch request

```ts
export interface IngestionBatch {
  batchId: string;
  installationId: string;
  deviceId: string;
  agentVersion: string;
  schemaVersion: number;
  privacyPolicyVersion: string;
  createdAt: string;
  events: RevealystActivityEvent[];
}
```

### 14.3 Batch constraints

`[INFERRED, MED]` Initial limits: 250 events per batch · 1 MB compressed body ·
10-second request timeout · one active ingestion upload per installation ·
gzip compression.

### 14.4 Retry policy

**Retry:** network timeout · connection reset · HTTP 408 · 425 · 429 ·
500–599. **Do not blindly retry:** HTTP 400 · 401 after a refresh attempt ·
403 · 409 schema conflict · 413 without batch split · 422 invalid event. Use
exponential backoff with jitter.

## 15. Deduplication

### 15.1 Priority

Deduplicate using, in order: stable provider event ID · stable provider
conversation ID plus event index · connector-specific source record ID ·
deterministic event fingerprint · server-side probabilistic duplicate
detection.

### 15.2 Event fingerprint

```
SHA-256(
  provider + product + connector_id
  + normalized_source_conversation_id
  + normalized_event_type
  + normalized_source_timestamp
  + canonical_content_digest_or_feature_digest
)
```

Conversation title alone must not be used as a unique identifier. First-prompt
text alone must not be used as a unique identifier.

## 16. Privacy engine

### 16.1 Policy precedence

Effective policy is the **most restrictive** result of: platform hard limits +
organization policy + user policy + connector capability.

### 16.2 Policy broadening

Remote configuration must not silently increase collection scope. Moving from
Analytics Only to Redacted Summary or Full Content requires explicit
authorization.

### 16.3 Local enforcement

Privacy enforcement must happen **before queue persistence**. The sync engine
must reject events whose privacy flags contradict the active policy — e.g. an
Analytics Only event with `rawPromptIncluded: true` must be quarantined and
not uploaded.

## 17. Remote configuration

### 17.1 Contents

Remote config controls: minimum agent version · connector enablement ·
connector minimum version · poll intervals · batch size · update channel ·
diagnostic sampling · redaction version · privacy policy version · emergency
connector shutdown.

### 17.2 Signed config

```json
{
  "configurationVersion": 18,
  "issuedAt": "2026-07-16T10:00:00Z",
  "expiresAt": "2026-07-23T10:00:00Z",
  "minimumAgentVersion": "1.1.0",
  "defaultContentMode": "analytics_only",
  "connectors": {
    "claude_code": {
      "enabled": true,
      "minimumVersion": "1.0.0",
      "pollIntervalSeconds": 30
    }
  },
  "signature": "..."
}
```

Remote configuration must be cryptographically signed. If signature validation
fails, retain the last valid unexpired configuration. If no valid
configuration exists, use restrictive built-in defaults.

## 18. Auto-update system

### 18.1 Mechanism

Use the official Tauri updater (signed manifests, signature verification) with
a Revealyst-controlled dynamic update endpoint.

### 18.2 Channels

`internal` · `beta` · `stable`.

### 18.3 Update behavior

Check for updates on startup and every six hours while running · download in
the background · verify signatures · install when idle or on restart ·
preserve local queue and checkpoints · report update errors in diagnostics ·
force mandatory updates only for security, privacy, or protocol-critical
issues.

### 18.4 Staged rollout

Deterministic cohorts: internal 100% → beta 100% → stable 5% → 25% → 50% →
100%. Cohort assignment uses a stable hash of `installationId + releaseId`.

## 19. User interface requirements

### 19.1 Tray/menu-bar menu

```
Revealyst
● Syncing normally
Last sync: 2 minutes ago
─────────────────────────
Open Revealyst
Connection status
Privacy settings
Pause collection
Check for updates
Send diagnostics
Quit
```

### 19.2 Onboarding screens

1. **Welcome** — "Connect this computer to Revealyst. Revealyst securely syncs
   supported AI-usage analytics from this computer. Prompt text is not
   uploaded in the default mode." [Continue]
2. **Sign in** — "Your browser will open so you can securely connect this
   computer." [Open browser]
3. **Source detection** — "Supported sources found: Claude Code — Ready to
   connect. Claude Desktop — Installed; detailed conversation sync is not
   available in Phase 1." [Continue]
4. **Privacy mode** — Analytics Only (selected) / Redacted Summary (optional,
   not enabled by default) / Full Content (explicit opt-in only).
5. **Finish** — "This computer is connected. Revealyst will run quietly in the
   background. Prompt text is not uploaded in Analytics Only mode."
   [Open Revealyst] [Done]

### 19.3 Status screen

Show: overall status · signed-in Revealyst user · device name · last sync ·
active privacy mode · connected sources · unsupported sources · coverage
limitations · pending sync count · app version · update status.

### 19.4 Privacy screen

Show: current mode · what leaves the device · what never leaves the device ·
organization restrictions · pause collection · delete pending local data ·
disconnect this device.

## 20. Connection-state model

```ts
export type AgentState =
  | "onboarding" | "healthy" | "partially_covered" | "offline" | "paused"
  | "authentication_required" | "policy_blocked" | "update_required"
  | "degraded" | "storage_full";
```

State precedence (highest first): `update_required` → `authentication_required`
→ `policy_blocked` → `storage_full` → `paused` → `degraded` → `offline` →
`partially_covered` → `healthy`.

"Healthy" means enabled and supported connectors are working. It does **not**
mean all AI activity on the computer is captured.

## 21. Performance requirements

`[INFERRED, MED]` Initial targets — must be measured in CI or internal beta
before stable release:

| Metric                    | Target                                  |
|---------------------------|-----------------------------------------|
| Installed size            | under 40 MB per architecture            |
| Idle memory               | under 80 MB                             |
| Idle CPU                  | under 0.5% averaged over 10 minutes     |
| Active CPU                | under 3% averaged over 1 minute         |
| Startup to tray ready     | under 3 seconds                         |
| Warm status-window open   | under 500 ms                            |
| Idle network use          | under 1 MB/day excluding updates        |

## 22. Security requirements

### 22.1 Mandatory controls

Signed binaries · macOS notarization · Windows code signing · signed updates ·
signed remote config · short-lived access tokens · rotating refresh tokens ·
device-key request signatures · encrypted local event queue · OS secure
storage for secrets · strict Tauri capability permissions · no unrestricted
shell access · no unrestricted filesystem access · no remote script loading ·
dependency scanning · secret scanning · tamper-resistant update verification.

### 22.2 Tauri permissions

The frontend UI must not directly access: filesystem, shell, credential store,
network outside approved commands, database, update installation, connector
internals. The frontend must call narrowly scoped Rust commands.

### 22.3 Content security policy

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
img-src 'self' data:; connect-src 'self'; object-src 'none';
frame-src 'none'; base-uri 'none';
```

## 23. Diagnostics

### 23.1 Logs

Logs may include: timestamp, component, error code, connector ID, agent
version, retry count, queue count, sync status. Logs must **not** include:
prompt text, response text, access tokens, refresh tokens, private keys,
provider session cookies, file contents, clipboard contents.

### 23.2 Diagnostic bundle

"Send diagnostics" requires explicit user action. The bundle includes: app
version, platform, architecture, connector states, sanitized logs, queue
counts, last successful sync, remote-config version, policy version, update
state. The bundle must exclude activity payloads by default.

## 24. Backend API requirements

```
# Auth
POST /v1/desktop/auth/start
POST /v1/desktop/auth/exchange
POST /v1/desktop/auth/refresh
POST /v1/desktop/auth/revoke

# Device management
POST   /v1/desktop/devices
GET    /v1/users/me/devices
PATCH  /v1/users/me/devices/{deviceId}
DELETE /v1/users/me/devices/{deviceId}
POST   /v1/users/me/devices/{deviceId}/revoke
POST   /v1/desktop/devices/{deviceId}/heartbeat

# Ingestion
POST /v1/desktop/ingestion/batches
GET  /v1/desktop/ingestion/capabilities

# Config and updates
GET /v1/desktop/config
GET /v1/desktop/policy
GET /v1/desktop/updates/{platform}/{architecture}/{channel}/{version}

# Diagnostics
POST /v1/desktop/diagnostics
```

(Route shapes are `[INFERRED]`; the execution plan maps them onto existing
Revealyst routes where a live equivalent exists.)

## 25. CI/CD requirements

### 25.1 Pull-request checks (desktop-agent or shared-contract changes)

Rust format · Rust lint · Rust unit tests · TypeScript lint · TypeScript type
check · frontend unit tests · connector fixture tests · schema compatibility
tests · privacy-mode validation tests · Analytics Only payload tests · Tauri
capability audit · dependency audit · secret scan · unsigned macOS build ·
unsigned Windows build.

### 25.2 Release workflow

```
tag release → run full test suite → build platform artifacts → sign binaries
→ notarize macOS → verify signatures → generate checksums
→ generate signed update manifest → publish internal channel
→ promote to beta → staged stable rollout
```

Pull-request workflows must **not** access signing secrets. Signing secrets
live in protected release environments.

## 26. Testing strategy

### 26.1 Privacy tests

Analytics Only rejects raw prompt fields · rejects raw response fields ·
Redacted Summary requires explicit policy · Full Content requires explicit
policy · remote config cannot silently broaden policy · diagnostic bundle
excludes activity payloads · logs exclude prompt/response/token secrets ·
queue persistence does not store raw text in Analytics Only mode.

### 26.2 Sync tests

Offline queueing · restart recovery · duplicate retry · batch splitting ·
partial acceptance · token refresh · device revocation · schema rejection ·
retry backoff.

### 26.3 Platform tests

macOS Apple Silicon · macOS Intel · Windows 10 · Windows 11 · standard
non-admin user · sleep/resume · offline startup · corporate proxy · Unicode
username/path · multiple OS users.

### 26.4 Security tests

Malicious deep link · PKCE state mismatch · refresh-token replay · tampered
update manifest · tampered remote config · archive path traversal · local
database tampering · Tauri command authorization · frontend injection attempt.

## 27. Acceptance criteria

### 27.1 Installation

User installs without a separate runtime · signs in through the browser ·
never copies API keys · never enters Claude credentials · device is
registered · agent runs in tray/menu bar · start-at-login works · user can
uninstall normally.

### 27.2 Data privacy

Analytics Only is the default · uploads no prompt text · no response text ·
no files · Full Content unavailable unless explicitly enabled · privacy screen
clearly explains what leaves the device · remote config cannot silently
broaden collection · diagnostic bundle excludes activity payloads by default.

### 27.3 Sync

Events queue offline · sync after reconnect · duplicate retries deduplicated ·
partial batch acceptance works · device revocation stops future upload · local
queue survives app restart and update.

### 27.4 Multi-device

One user can enroll multiple devices · devices sync independently · cloud
merges events into one user timeline · revoking one device does not affect
others.

### 27.5 Shared credentials

Two users sharing one Claude account on different enrolled devices remain
separately attributed · same OS user + same Revealyst login + same Claude
account is marked ambiguous if multi-person use is detected or declared ·
provider account identity does not override Revealyst identity.

### 27.6 Updates

Agent checks for updates · signed updates install · invalid signatures are
rejected · update preserves local queue · staged rollout can be halted ·
mandatory update can block unsafe versions.

## 28. Delivery milestones

1. **App foundation** — Tauri shell, tray lifecycle, status window, settings
   window, platform abstraction, start-at-login, single-instance, structured
   logs.
2. **Auth and device identity** — browser PKCE, deep-link callback, device
   enrollment, secure token storage, device keypair, token refresh, device
   revoke.
3. **Privacy-first local pipeline** — privacy modes, Analytics Only
   enforcement, local feature extractor, encrypted queue, connector
   checkpoints, payload validator, privacy tests.
4. **Sync and backend** — ingestion API, batch upload, retry handling, partial
   acceptance, server-side idempotency, heartbeat, remote config.
5. **Initial sources** — Claude Code connector (only after source validation),
   Claude export importer, coverage-status UI, unsupported-source disclosures.
6. **Updates and release** — signed updater, dynamic update endpoint,
   channels, staged rollout, macOS signing/notarization, Windows signing,
   release halt.
7. **Hardening** — performance, battery, security, privacy review, upgrade
   testing, corporate-proxy testing, internal beta, stable rollout.

## 29. AI coding-agent implementation constraints (hard rules, verbatim)

- Do not implement browser extensions in Phase 1.
- Do not upload raw prompts in the default mode.
- Do not upload raw responses in the default mode.
- Do not store raw prompt text in the local queue in Analytics Only mode.
- Do not inspect browser cookies, browser storage, or browser history.
- Do not intercept network traffic.
- Do not capture screen contents.
- Do not monitor keystrokes.
- Do not monitor clipboard contents.
- Do not request Claude, Anthropic, OpenAI, Google, Cursor, or other provider
  credentials.
- Do not treat app presence as proof of productive AI usage.
- Do not claim complete Claude Desktop coverage.
- Do not use undocumented local formats unless isolated behind a connector
  with fixtures and explicit fallback states.
- Do not broaden collection through remote configuration without explicit
  authorization.
- Do not store tokens in SQLite or frontend storage.
- Do not grant unrestricted Tauri filesystem or shell permissions.
- Do not expose signing secrets to pull-request workflows.
- Do not add a privileged background service in MVP.
- Do not calculate final team capability scores inside the agent.
- Do not display manager analytics inside the desktop agent.

## 30. Definition of done (Phase 1)

macOS and Windows installers signed · macOS build notarized · Windows build
shows verified publisher identity · installs and runs without technical
setup · browser sign-in · device enrollment works · start-at-login works ·
Analytics Only is default · Analytics Only uploads no raw prompt or response
text · local queue encrypted · sync automatic and idempotent · offline queue
survives restart · multiple devices merge under one user · shared provider
credentials handled through Revealyst identity · coverage limitations
visible · privacy mode visible · updates signed and staged · device revocation
works · CI validates schemas, privacy, platform builds, and security
constraints · documentation covers install, privacy, troubleshooting, updates,
uninstall.

## 31. Final technical decision

Build Revealyst Desktop Agent as a Tauri 2 cross-platform background utility
inside the Revealyst monorepo. Make Analytics Only the default and mandatory
MVP mode. Do not transmit prompt or response text by default. Compute
capability and workflow signals locally, then sync only derived analytics
events. Keep raw-content upload as a future explicit opt-in mode, not a hidden
dependency.

> Revealyst improves AI capability without asking employees to expose their
> prompts.
