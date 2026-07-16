// Regenerates the desktop signed-remote-config golden vector (T4.2, ADR 0049).
// Run: `npx tsx scripts/gen-desktop-config-vector.mts`
// The drift-guard test (tests/desktop-config.test.ts) fails until this is
// re-run after any change to the config shape, canonicalization, or the fixed
// test inputs — so regeneration is intentional, never silent.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { buildDesktopConfigVector } from "../tests/helpers/desktop-config-vector";

const OUT = "desktop-agent/src-tauri/fixtures/desktop-config-vector.json";

const vector = await buildDesktopConfigVector();
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(vector, null, 2)}\n`);
console.log(`wrote ${OUT}`);
