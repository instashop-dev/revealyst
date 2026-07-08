#!/usr/bin/env node
// PostToolUse (Edit|Write|MultiEdit): fail loudly when a V1 tripwire technology (rule 7)
// enters a source file or package.json at write time. Convention won't survive an agent
// fleet; this hook will (Workflow §2.2). Scans imports/requires and declared dependencies
// only — not prose — so the "no Kafka" line in CLAUDE.md never trips it.
import { readFileSync, existsSync } from 'node:fs'
import { basename } from 'node:path'

function stdin() { try { return readFileSync(0, 'utf8') } catch { return '' } }

let payload = {}
try { payload = JSON.parse(stdin() || '{}') } catch { process.exit(0) }

const filePath = payload?.tool_input?.file_path
if (!filePath || !existsSync(filePath)) process.exit(0)

const base = basename(filePath).toLowerCase()
let content = ''
try { content = readFileSync(filePath, 'utf8') } catch { process.exit(0) }

// Tripwire packages: streaming/OLAP infra, formula-DSL / expression evaluators, and
// browser-extension tooling. Matched against module specifiers and dependency names.
const BANNED = /(^|[/@])(kafkajs|kafka-node|node-rdkafka|clickhouse|@clickhouse|jexl|filtrex|expr-eval|jsep|nerdamer|mathjs|hot-formula-parser|formulajs|@formulajs|webextension-polyfill)(\/|$)/i
// Chinese-vendor AI SDKs — no Chinese-vendor connectors in V1.
const CN_VENDOR = /(^|[/@])(deepseek|dashscope|qwen|moonshot|kimi|zhipu|zhipuai|hunyuan|minimax|01ai|yi-large|ernie|wenxin)(\/|$)/i

const hits = []

if (/\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/i.test(filePath)) {
  const importRe = /(?:import[^;'"]*from\s*|require\(\s*|import\(\s*)['"]([^'"]+)['"]/g
  let m
  while ((m = importRe.exec(content))) {
    const mod = m[1]
    if (BANNED.test(mod)) hits.push(`imports banned module "${mod}"`)
    if (CN_VENDOR.test(mod)) hits.push(`imports Chinese-vendor SDK "${mod}"`)
  }
}

if (base === 'package.json') {
  try {
    const pkg = JSON.parse(content)
    for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
      for (const dep of Object.keys(pkg[field] || {})) {
        if (BANNED.test(dep)) hits.push(`declares banned dependency "${dep}"`)
        if (CN_VENDOR.test(dep)) hits.push(`declares Chinese-vendor dependency "${dep}"`)
      }
    }
  } catch { /* not valid JSON yet — ignore */ }
}

if (base === 'manifest.json' && /"manifest_version"\s*:/.test(content)) {
  hits.push('looks like a browser-extension manifest (no browser extension/proxy in V1)')
}

if (hits.length) {
  process.stderr.write(
    `TRIPWIRE (rule 7) — ${filePath}\n` +
    hits.map(h => `  • ${h}`).join('\n') +
    `\nThese are V1 non-goals (CLAUDE.md -> Tripwires). Stop. If it is genuinely required, ` +
    `it needs a decision on the record (/adr) — not a silent add.\n`
  )
  process.exit(2) // block loudly
}
process.exit(0)
