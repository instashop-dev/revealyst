// Bindings that exist at runtime but not in wrangler.jsonc yet, merged into
// the wrangler-generated CloudflareEnv:
// - DATABASE_URL: Worker secret / .dev.vars (fallback until Hyperdrive)
// - HYPERDRIVE: added to wrangler.jsonc when the founder provisions it
//   (docs/infra.md) — remove from here at that point.
interface CloudflareEnv {
  DATABASE_URL?: string;
  HYPERDRIVE?: Hyperdrive;
  // Auth secrets (wrangler secret / .dev.vars)
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
}
