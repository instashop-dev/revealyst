#!/usr/bin/env node
// PostToolUse (Edit|Write|MultiEdit): typecheck the touched TypeScript package at write
// time, so contract drift is caught when it's written, not at CI time (Workflow §2.2).
// No-ops cleanly until there's a TS project with a local `typescript` (pre-W0-B), so it
// never blocks on missing tooling — only on real type errors.
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

function stdin() { try { return readFileSync(0, 'utf8') } catch { return '' } }

let payload = {}
try { payload = JSON.parse(stdin() || '{}') } catch { process.exit(0) }

const filePath = payload?.tool_input?.file_path
if (!filePath || !/\.(ts|tsx|mts|cts)$/i.test(filePath)) process.exit(0)

// Walk up from the edited file to the nearest tsconfig.json.
let dir = dirname(resolve(filePath))
let tsconfig = null
for (;;) {
  const cand = join(dir, 'tsconfig.json')
  if (existsSync(cand)) { tsconfig = cand; break }
  const parent = dirname(dir)
  if (parent === dir) break
  dir = parent
}
if (!tsconfig) process.exit(0) // no TS project yet -> no-op

const pkgDir = dirname(tsconfig)
const tscJs = join(pkgDir, 'node_modules', 'typescript', 'bin', 'tsc')
if (!existsSync(tscJs)) process.exit(0) // typescript not installed -> don't block on tooling

try {
  execFileSync(process.execPath, [tscJs, '--noEmit', '-p', tsconfig], {
    cwd: pkgDir,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  process.exit(0)
} catch (e) {
  const out = (e.stdout?.toString() || '') + (e.stderr?.toString() || '')
  process.stderr.write(`Post-edit typecheck failed (${pkgDir}):\n${out}\n`)
  process.exit(2) // block: surface the drift to the agent at write time
}
