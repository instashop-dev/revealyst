import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import staticAssetsIncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/static-assets-incremental-cache";

// Incremental cache: the READ-ONLY static-assets flavor + cache interception.
//
// Why this flavor and not R2/KV: this app has ZERO ISR — no `revalidate`
// exports, no fetch-cache — so the only cacheable surfaces are the build-time
// prerenders. The Next build marks these `○ (Static)` and lists them in
// `.next/prerender-manifest.json`: /, /sign-in, /reset-password,
// /legal/privacy, /legal/terms, plus /_not-found, /_global-error, /icon.svg,
// /opengraph-image. The static-assets cache serves exactly those: the build
// emits each into .open-next/assets/cdn-cgi/_next_cache/** (worker-only
// paths) and the runtime reads them through the existing ASSETS binding.
// That means NO new Cloudflare bindings and NO CI provisioning steps (an R2
// bucket would need `wrangler r2 bucket create` mirrored into BOTH deploy.yml
// and ci.yml's preview-deploy, or every PR preview goes red — see the queues
// precedent in CLAUDE.md). Runtime `set` calls error-log and no-op
// (read-only) — nothing in this app writes the incremental cache at runtime
// today. If a surface ever needs real ISR/on-demand revalidation, switch to
// the R2 incremental cache and do that provisioning dance.
//
// Two DIFFERENT fast paths reach this cache, and it's worth being precise
// (verified against @opennextjs/aws cacheInterceptor.js + a local wrangler
// dev probe):
//   • enableCacheInterception short-circuits a prerendered route to its
//     cached HTML BEFORE NextServer runs — for every manifest route EXCEPT
//     "/". The interceptor strips the trailing slash (localizedPath), turning
//     "/" into "" which misses the "/" manifest key, so the root falls
//     through. It DOES fire for /sign-in, /reset-password, /legal/* — those
//     skip NextServer entirely.
//   • "/" is fast for the OTHER reason: it is no longer force-dynamic (see
//     src/app/page.tsx), so NextServer serves it from ITS incremental cache
//     (this same static-assets store) instead of re-rendering. Still a cache
//     hit (`x-nextjs-cache: HIT`), just resolved inside NextServer rather
//     than ahead of it.
// Either way the page comes from the static-assets store, not a cold render
// (measured 2026-07-10: /sign-in cold render was 1–2s; warm reads are tens of
// ms). Interception runs inside the OpenNext handler, i.e. AFTER
// src/worker.ts's host-split redirect and request-timing wrapper — the
// Server-Timing header and the marketing/app-host 308s are unaffected.
// Authenticated pages are all force-dynamic and never enter either path.
export default {
  ...defineCloudflareConfig({
    incrementalCache: staticAssetsIncrementalCache,
    enableCacheInterception: true,
  }),
  // Turbopack builds break the adapter's chunk-registry patch on Windows
  // (bracketed chunk filenames defeat its globbing) — the local dev machine
  // is Windows, so build with webpack.
  buildCommand: "next build --webpack",
};
