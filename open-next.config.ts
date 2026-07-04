import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// No incremental cache yet: the walking skeleton has no ISR/SSG pages worth
// caching. Add the R2 incremental cache when a surface needs it.
export default {
  ...defineCloudflareConfig(),
  // Turbopack builds break the adapter's chunk-registry patch on Windows
  // (bracketed chunk filenames defeat its globbing) — the local dev machine
  // is Windows, so build with webpack.
  buildCommand: "next build --webpack",
};
