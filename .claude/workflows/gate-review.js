export const meta = {
  name: 'gate-review',
  description: 'Wave-gate adversarial pre-review: parallel finders across risk dimensions, each finding adversarially refuted, survivors synthesized into an evidence-pack section. Invoke as /gate-review <wave> (e.g. /gate-review W2).',
  phases: [
    { title: 'Find', detail: 'one finder per risk dimension, in parallel' },
    { title: 'Verify', detail: 'adversarially refute each finding; keep survivors' },
    { title: 'Synthesize', detail: 'evidence-pack section for docs/gates' },
  ],
}

// Wave id comes in as args ("W2") or {wave:"W2"}.
const wave = ((typeof args === 'string' ? args : args?.wave) || '').trim() || 'the current wave'

// Risk dimensions — the same lenses the contract-guardian and adversarial-reviewer
// subagents cover for per-PR review, here fanned out for the integrated wave branch.
const DIMENSIONS = [
  {
    key: 'tenancy',
    prompt: `Review the integrated branch for gate ${wave} for TENANCY ESCAPES. Read CLAUDE.md (Tenancy rule + invariants), then inspect the diff vs the base branch (use git). Find any query, repository method, or raw table access that is not org-scoped through the mandatory-scoping layer / RLS — one missing org_id filter is a cross-tenant leak. Report concrete leak paths only.`,
  },
  {
    key: 'contract-drift',
    prompt: `Review the integrated branch for gate ${wave} for FROZEN-CONTRACT DRIFT. Read CLAUDE.md ("Frozen contracts"), then inspect the diff. Flag changes to the Connector/ScoreDefinition/ScoreResult/API-route typed interfaces, frozen schema (especially weakened sub-daily signals), tracked_user semantics, or credential handling — any of which needs an ADR (rule 1) it doesn't have.`,
  },
  {
    key: 'attribution',
    prompt: `Review the integrated branch for gate ${wave} for ATTRIBUTION DISHONESTY. Read CLAUDE.md (invariant b). Find anywhere key/account-level data is presented as per-person, or a shared account is split into fabricated people, or attribution_confidence is dropped/ignored. Never-fabricate-per-user-numbers is load-bearing.`,
  },
  {
    key: 'tripwire',
    prompt: `Review the integrated branch for gate ${wave} for TRIPWIRE TECH (rule 7, CLAUDE.md -> Tripwires): formula DSL, browser extension/proxy, prompt-content ingestion in Team mode, a second B2C funnel, Kafka/ClickHouse, a separate ML service, Chinese-vendor connectors. Report any that appear in code or dependencies.`,
  },
  {
    key: 'correctness',
    prompt: `Review the integrated branch for gate ${wave} adversarially for SCORE/METRIC WRONGNESS. Assume the code is wrong. Find a concrete input (empty poll window, backfill gap, duplicate idempotent upsert, day-boundary/timezone, missing signal) that yields a wrong or non-deterministic metric or score the tests don't cover.`,
  },
]

const FINDINGS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['summary', 'file', 'failure_scenario', 'severity'],
        properties: {
          summary: { type: 'string', description: 'One-sentence statement of the defect' },
          file: { type: 'string', description: 'Repo-relative path' },
          line: { type: 'integer', description: '1-indexed line, or 0 if not line-specific' },
          failure_scenario: { type: 'string', description: 'Concrete inputs/state -> wrong outcome' },
          severity: { type: 'string', enum: ['blocker', 'high', 'medium', 'low'] },
        },
      },
    },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['refuted', 'reason'],
  properties: {
    refuted: { type: 'boolean', description: 'true if the finding does NOT hold up under scrutiny' },
    reason: { type: 'string', description: 'Why it holds or falls' },
  },
}

log(`Gate review for ${wave}: ${DIMENSIONS.length} risk dimensions, each finding adversarially verified.`)

// Pipeline: each dimension's findings get verified as soon as that dimension returns —
// no barrier, so a fast dimension's findings verify while a slow one is still reviewing.
const verified = await pipeline(
  DIMENSIONS,
  d => agent(d.prompt, { label: `find:${d.key}`, phase: 'Find', schema: FINDINGS_SCHEMA }),
  (review, d) => parallel((review?.findings || []).map(f => () =>
    agent(
      `You are a skeptic verifying a ${d.key} finding for gate ${wave}. Try to REFUTE it: ` +
      `assume it is wrong and find the reason it does not actually hold (already-present ` +
      `guard, scoping layer that covers it, test that catches it). Inspect the code to ` +
      `confirm. Default refuted=true if you cannot substantiate it. Finding: ${JSON.stringify(f)}`,
      { label: `verify:${d.key}`, phase: 'Verify', schema: VERDICT_SCHEMA }
    ).then(v => ({ ...f, dimension: d.key, verdict: v }))
  ))
)

const survivors = verified
  .flat()
  .filter(Boolean)
  .filter(x => x.verdict && x.verdict.refuted === false)

// blocker/high first
const order = { blocker: 0, high: 1, medium: 2, low: 3 }
survivors.sort((a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9))

log(`${survivors.length} of ${verified.flat().filter(Boolean).length} findings survived adversarial verification.`)

const evidenceSection = await agent(
  `Write a concise markdown section titled "## Adversarial pre-review (${wave})" for the gate ` +
  `evidence pack docs/gates/${wave}-evidence.md. Group the surviving findings by dimension; ` +
  `for each give: severity, one-line summary, file:line, the failure scenario, and a ` +
  `recommended disposition (fix now / accept with note / needs ADR). If there are none, state ` +
  `that the adversarial pre-review surfaced no surviving findings and the gate may proceed on ` +
  `this axis. Do not invent findings. Surviving findings: ${JSON.stringify(survivors)}`,
  { phase: 'Synthesize', label: 'synthesize' }
)

return {
  wave,
  dimensions: DIMENSIONS.map(d => d.key),
  total: verified.flat().filter(Boolean).length,
  surviving: survivors.length,
  findings: survivors,
  evidenceSection,
}
