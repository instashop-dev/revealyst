// Generate a Tauri v2 updater manifest for a desktop-agent release (T6.2).
//
// This is the shape T6.1's dynamic update endpoint serves (spec §18.1): a
// top-level {version, notes, pub_date} plus a `platforms.<target>.{signature,
// url}` map keyed by Tauri's updater target ids. The file is written into the
// release dir as `<channel>.json` and uploaded as a release asset, so a static
// host OR the T6.1 endpoint can serve it unchanged.
//
//   platforms:
//     darwin-aarch64  <- *_aarch64.app.tar.gz  (+ .sig)
//     darwin-x86_64   <- *_x86_64.app.tar.gz   (+ .sig)
//     windows-x86_64  <- *.nsis.zip | *.msi.zip (+ .sig)
//
// `signature` is the base64 content of the sibling `.sig` Tauri emits on the
// signed path. On the UNSIGNED dry-run path there are no `.sig` files, so the
// manifest is written with empty signatures and `unsigned: true` — a real
// tauri-plugin-updater REJECTS a manifest whose signature does not verify, so
// the dry-run manifest is deliberately non-installable.
//
// Usage: node scripts/desktop-updater-manifest.mjs <releaseDir> <channel>
// Env:   TAG (release tag for asset URLs), REPO (owner/repo, defaults to
//        GITHUB_REPOSITORY), SIGNED ("true"/"false").
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const [releaseDir, channel] = process.argv.slice(2);
if (!releaseDir || !channel) {
  console.error("usage: desktop-updater-manifest.mjs <releaseDir> <channel>");
  process.exit(1);
}

const repo = process.env.REPO || process.env.GITHUB_REPOSITORY || "";
const tag = process.env.TAG || "";
const signed = process.env.SIGNED === "true";

// Version is sourced from tauri.conf.json — the single source of truth the
// bundler already stamped into the artifacts.
const tauriConf = JSON.parse(
  readFileSync("desktop-agent/src-tauri/tauri.conf.json", "utf8"),
);
const version = tauriConf.version;

const files = readdirSync(releaseDir);

function assetUrl(filename) {
  // GitHub Release asset URL. T6.1's endpoint may rewrite the host (e.g. to
  // R2); the path/filename contract is what matters here.
  return `https://github.com/${repo}/releases/download/${tag}/${encodeURIComponent(
    filename,
  )}`;
}

function readSig(updaterFile) {
  const sigName = `${updaterFile}.sig`;
  if (!files.includes(sigName)) return "";
  return readFileSync(join(releaseDir, sigName), "utf8").trim();
}

// Match each updater target to its bundle. Order matters: check the more
// specific aarch64 before x86_64 (neither substring collides, but be explicit).
const targets = [
  { key: "darwin-aarch64", match: (f) => /_aarch64\.app\.tar\.gz$/.test(f) },
  { key: "darwin-x86_64", match: (f) => /_x86_64\.app\.tar\.gz$/.test(f) },
  // Prefer the NSIS updater zip; fall back to the MSI updater zip.
  { key: "windows-x86_64", match: (f) => /\.nsis\.zip$/.test(f) },
  { key: "windows-x86_64", match: (f) => /\.msi\.zip$/.test(f), fallback: true },
];

const platforms = {};
for (const t of targets) {
  if (platforms[t.key]) continue; // already filled (e.g. nsis beat msi)
  const file = files.find(t.match);
  if (!file) continue;
  platforms[t.key] = { signature: readSig(file), url: assetUrl(file) };
}

const manifest = {
  version,
  notes: `Revealyst Desktop ${version} (${channel} channel).`,
  pub_date: new Date().toISOString(),
  platforms,
};
if (!signed) {
  // Make the non-installable state explicit + machine-checkable.
  manifest.unsigned = true;
}

const outPath = join(releaseDir, `${channel}.json`);
writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Wrote ${outPath} (signed=${signed})`);
console.log(JSON.stringify(manifest, null, 2));

if (Object.keys(platforms).length === 0) {
  console.error("::warning::no updater bundles matched — manifest has no platforms");
}
