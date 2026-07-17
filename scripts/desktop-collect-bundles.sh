#!/usr/bin/env bash
# Collect Tauri release bundles for the desktop agent (T6.2 release workflow).
#
# Copies installers + the Tauri updater bundles (and any `.sig` sidecars from
# the signed path) out of the per-target bundle tree into a flat output dir.
#
# The macOS updater bundle is named `<productName>.app.tar.gz` with NO arch in
# the name, so flattening the aarch64 and x86_64 builds into one release dir
# would collide. This script embeds the arch (from $RUST_TARGET) into the
# macOS `.app.tar.gz` / `.app.tar.gz.sig` filenames so both survive. The `.dmg`
# and Windows installer names already carry their target, so they are copied
# verbatim.
#
# Usage: RUST_TARGET=<triple> desktop-collect-bundles.sh <output-dir>
set -euo pipefail

out="${1:?output dir required}"
: "${RUST_TARGET:?RUST_TARGET env required}"
mkdir -p "$out"

base="desktop-agent/src-tauri/target/${RUST_TARGET}/release/bundle"
if [ ! -d "$base" ]; then
  echo "::error::bundle dir not found: $base" >&2
  exit 1
fi

# macOS arch label derived from the rust triple: aarch64-apple-darwin ->
# aarch64, x86_64-apple-darwin -> x86_64. Empty for non-macOS targets.
mac_arch=""
case "$RUST_TARGET" in
  aarch64-apple-darwin) mac_arch="aarch64" ;;
  x86_64-apple-darwin) mac_arch="x86_64" ;;
esac

copied=0
while IFS= read -r -d '' f; do
  name="$(basename "$f")"
  dest="$name"
  # Arch-label the macOS updater bundle + its signature to avoid collisions.
  if [ -n "$mac_arch" ]; then
    case "$name" in
      *.app.tar.gz) dest="${name%.app.tar.gz}_${mac_arch}.app.tar.gz" ;;
      *.app.tar.gz.sig) dest="${name%.app.tar.gz.sig}_${mac_arch}.app.tar.gz.sig" ;;
    esac
  fi
  cp "$f" "$out/$dest"
  copied=$((copied + 1))
done < <(find "$base" -type f \
  \( -name "*.dmg" -o -name "*.msi" -o -name "*.exe" \
     -o -name "*.app.tar.gz" -o -name "*.nsis.zip" -o -name "*.msi.zip" \
     -o -name "*.sig" \) -print0)

if [ "$copied" -eq 0 ]; then
  echo "::error::no bundles found under $base" >&2
  exit 1
fi

ls -la "$out"
