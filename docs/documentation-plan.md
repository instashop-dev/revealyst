# Documentation Section — Implementation Plan

Status: planned, not started. Scope: a public `/docs` section on the marketing site.

## 1. Existing architecture relevant to documentation

- **Next.js 16 App Router**, deployed to Cloudflare Workers via OpenNext (`open-next.config.ts`, `next build --webpack` forced on Windows). **No incremental cache / ISR configured** → every docs page must fully prerender at build time; OpenNext then serves it as a static asset. The static `/legal/*` pages prove this path works.
- **Public-page precedent — `src/app/legal/`**: outside the authenticated `(app)` group, no `requireAppContext`, no `dynamic` export (static), own `layout.tsx` providing brand link + mini-nav + prose typography via arbitrary descendant selectors (`[&_h1]:… [&_p]:…`). `/docs` mirrors this shape.
- **Authenticated shell is off-limits for docs rendering**: `(app)/layout.tsx` calls `requireAppContext` (redirects to `/sign-in`) and is `force-dynamic`. Docs pages must never import `src/lib/api-context.ts` or anything that flips them dynamic (`headers()`, `cookies()`).
- **No content pipeline exists**: no MDX/markdown tooling, no `prose` styles, no highlighter, no search, no `sitemap.ts`/`robots.ts`. All greenfield.
- **Claim-surface machinery already exists and must be reused** (W3-N/W3-P invariant-b rules): connector availability derives from `src/connectors/registry.ts` (`registeredVendors()`: anthropic, openai, cursor registered; unregistered ⇒ "Soon") + `src/lib/vendor-labels.ts`; product params render `FREE_TRACKED_USER_LIMIT` from `src/lib/entitlements.ts` (importable by public pages by design).

## 2. URL structure & navigation

```
/docs                            Overview, quick links
/docs/getting-started            Sign up → connect a tool → first scores
/docs/connectors                 Index; availability table derived from registry
/docs/connectors/anthropic       (also: openai, cursor, claude-code, copilot="Soon")
/docs/scores                     Score model overview
/docs/scores/definitions         Per-score definitions incl. honesty rules
/docs/privacy-and-attribution    Attribution ladder, visibility modes, what is NOT collected
/docs/billing                    Free band ({FREE_TRACKED_USER_LIMIT} tracked users), seat metering
/docs/agent-ingest               Desktop agent workflow (workflow-only in v1, not API reference)
```

Navigation entry points:
- Landing page `src/app/page.tsx`: add `Docs` to the inline header nav and footer. **Do not refactor the inline nav into a shared component** — separate follow-up.
- `src/app/legal/layout.tsx` mini-nav: add a `Docs` link.
- App sidebar (`src/components/app-sidebar.tsx`): optional "Documentation" footer link, deferred to the last PR.

## 3. Rendering approach — `@next/mdx` file-convention pages

Each doc is `src/app/docs/<section>/<slug>/page.mdx`, compiled by webpack at build time. Chosen over the alternatives because:

- **Static prerender guaranteed** — a `page.mdx` is an ordinary server-component module; Next prerenders it; OpenNext serves static HTML. No `generateStaticParams`, no ISR dependence.
- **Zero runtime compiler in the worker** — MDX→JS and shiki highlighting happen inside the webpack loader. A `next-mdx-remote` catch-all would bundle remark/rehype/shiki into the worker (10 MB compressed limit risk).
- **Fact-check by construction** — MDX imports real code: `{FREE_TRACKED_USER_LIMIT}` interpolated, `<ConnectorAvailability />` derived from the registry. Claims physically can't drift (the structural fix W3-P applied to the landing page).
- **Rejected**: fumadocs/nextra (own Radix-based design systems clash with Base UI base-nova; untested loaders against webpack-on-Windows + OpenNext); hard-coded TSX (legal-page precedent scales poorly to ~15 prose pages); runtime `react-markdown` (client JS + no build-time highlighting).
- Authors are AI agents editing the repo, so file-per-page ergonomics are ideal; frontmatter = typed `export const metadata = {...}` (Next-native), not YAML.

`next.config.ts` change: wrap config with `createMDX({ options: { rehypePlugins: [...] } })`, add `pageExtensions: ["ts", "tsx", "mdx"]`, keep the `initOpenNextCloudflareForDev()` tail. Add `src/mdx-components.tsx` (required by App Router MDX) mapping `pre` → CodeBlock, internal `a` → `next/link`.

## 4. Reusable + new components

Reused as-is: `src/components/ui/sidebar.tsx` (SidebarProvider/Group/Menu, cookie collapse, mobile Sheet), `ui/breadcrumb`, `ui/dialog`, `ui/separator`, `ui/scroll-area`, `brand-mark.tsx`.

New, under `src/components/docs/` (+ layout/manifest):
- **`src/app/docs/layout.tsx`** (server, public, static): SidebarProvider → docs sidebar → SidebarInset with top bar + `<article>` + ToC right rail. Prose typography extends the legal-layout arbitrary-selector approach (a `docs-prose` class string) — **no `@tailwindcss/typography`** (no existing `prose` usage; plugin mixes poorly with base-nova tokens).
- **`src/lib/docs-nav.ts`** — single-source nav manifest: `DOCS_NAV` (sections→items) + `DOCS_FLAT` (ordered, for prev/next). Consumed by sidebar, breadcrumbs, pagination, `sitemap.ts`, search index. Pure data; relative imports if it grows siblings (vitest alias rule).
- **`docs-sidebar.tsx`** (client): renders the manifest via SidebarMenu; active state `usePathname().startsWith`; links via `SidebarMenuButton render={<Link/>}` `nativeButton={false}` (Base UI pattern, mirrors `app-sidebar.tsx`).
- **`docs-toc.tsx`** (client, ~1 KB): right-rail "On this page" from `querySelectorAll("article h2, h3")` (ids from `rehype-slug`), IntersectionObserver active state, hidden below `xl:`. DOM-derived — avoids per-page build plumbing.
- **`docs-pagination.tsx`** (client): prev/next from `DOCS_FLAT` + pathname.
- **`docs-breadcrumbs.tsx`** (client): `ui/breadcrumb` + manifest lookup.
- **`code-block.tsx`** (client): wraps server-highlighted `pre` children, copy button via `innerText`. Highlighting is **build-time shiki via `rehype-pretty-code`**, dual light/dark theme via CSS variables (respect the `.dark` raw-token rule).
- **`connector-availability.tsx`** (server): imports `"@/connectors"` + `registeredVendors()` + `VENDOR_LABELS`; renders live/"Soon" table and per-page badges. Copilot shows "Soon" automatically because it isn't registered.
- **Search (last phase, deferrable)**: `scripts/build-docs-search-index.ts` (tsx, `prebuild`) strips MDX from `src/app/docs/**/page.mdx` → `public/docs-search.json` (few KB); `docs-search.tsx` cmd-K `ui/dialog`, code-split via `next/dynamic`, fetches index on first open, token-prefix scoring. No cmdk/minisearch/Pagefind (Pagefind's postbuild HTML indexing doesn't slot into the OpenNext asset pipeline; a search service is tripwire-adjacent). At ~15 pages sidebar nav may suffice — revisit at 30+.

## 5. SEO

- Per-doc `export const metadata = { title, description, alternates: { canonical } }` in each `page.mdx`.
- Add `metadataBase: new URL("https://revealyst.thapi.workers.dev")` to `src/app/layout.tsx` (site-wide benefit; currently absent).
- New `src/app/sitemap.ts`: static routes + `DOCS_FLAT`. New `src/app/robots.ts`: allow all; disallow `/api/`, `/onboarding`, `/invite`, `/s/`, and `(app)` paths; point at the sitemap.
- One `src/app/docs/opengraph-image.tsx` via `next/og` ImageResponse — **text-only, no external fonts** (Workers constraint, same as existing OG images) — inherited by all docs routes.

## 6. Performance

- All content pages static-prerendered at build; article HTML ships zero content JS (RSC output).
- Client JS limited to nav chrome (sidebar/ToC/pagination/copy ≈ a few KB); search dialog code-split and loaded on first trigger.
- shiki + remark/rehype are loader-side only — never in the worker bundle. **Record the OpenNext worker size before/after in PR 1** and re-check at the big-content PR.

## 7. Content organization & versioning

- Content = `src/app/docs/**/page.mdx` (route = file). Ordering lives only in `src/lib/docs-nav.ts` — no per-file `order` fields to drift.
- Source material to adapt (read-only; `docs/connector-facts.md` is frozen — cite, never edit): `docs/score-definitions.md`, `docs/connector-facts.md`, `docs/compliance/*.md`. ADRs/gates/evidence stay internal.
- **Versioning: none in v1** (pre-1.0, single live version). URLs are unversioned; if ever needed, add a `/docs/v1/` subtree + second manifest later. No version switcher now.
- Content rule (invariant b): every product/security claim either renders a constant/registry-derived component or carries a code citation verified in review.

## 8. Dependencies to add

| Package | Role | Runtime footprint |
|---|---|---|
| `@next/mdx`, `@mdx-js/loader` | webpack MDX integration | build-time only |
| `@mdx-js/react` | provider for `mdx-components.tsx` | tiny (KBs) |
| `@types/mdx` (dev) | types for `*.mdx` | none |
| `rehype-slug`, `rehype-autolink-headings` | heading ids/anchors | build-time only |
| `rehype-pretty-code`, `shiki` | build-time highlighting | build-time only |

Explicitly NOT added: `@tailwindcss/typography`, contentlayer/gray-matter, cmdk/minisearch/pagefind, fumadocs/nextra. Add `remark-gfm` only if/when tables are needed.

## 9. Implementation phases (small, independently mergeable PRs; run `/code-review` + apply fixes BEFORE `gh pr create` — merge-race rule)

1. **PR 1 — pipeline + shell (de-risking PR):** deps, `next.config.ts`, `src/mdx-components.tsx`, `docs-nav.ts`, `docs/layout.tsx` + sidebar, overview + getting-started pages, Docs links in landing nav/footer + legal layout. Exit: `next build --webpack` green on Windows, `/docs` marked static (`○`) in build output, preview deploy serves it, worker-size delta recorded.
2. **PR 2 — chrome:** code blocks (rehype-pretty-code), ToC, breadcrumbs, prev/next, prose polish. No claims.
3. **PR 3 — connectors section (claim-bearing):** `connector-availability.tsx`, index + 5 vendor pages from `connector-facts.md`. Adversarial whole-document fact-check by a reviewer that didn't write the prose (W3-N). Known traps: no "read-only scopes" claim, no "KMS", Copilot = "Soon".
4. **PR 4 — scores/privacy/billing/agent-ingest content:** sourced from `score-definitions.md`, compliance docs, `entitlements.ts` (interpolate `FREE_TRACKED_USER_LIMIT`, never literal "5"). Same fact-check pass, incl. scoring honesty rules (ratio components omit, never fabricate 0).
5. **PR 5 — SEO:** `sitemap.ts`, `robots.ts`, `metadataBase`, docs OG image, metadata audit.
6. **PR 6 (optional) — search + app cross-link:** search index script + cmd-K dialog; "Documentation" link in `app-sidebar.tsx`.

## 10. Risks, trade-offs, open questions

- **OpenNext serving of prerendered MDX routes** — expected identical to working `/legal/*` statics; PR 1 proves it on preview deploy before content investment. Guard against anything flipping routes dynamic.
- **webpack MDX on Windows** — `@next/mdx` is the first-party webpack-era integration (lowest risk); `rehype-pretty-code` loader-config serialization is the one sharp edge — validate in PR 1; fallback = plain `<pre>` first, highlighting in PR 2.
- **Worker size** — mitigated (build-time-only deps), measured in PR 1 and PR 4.
- **Content overclaims = the biggest real risk** — mitigated structurally (registry/constant derivation) + procedurally (adversarial whole-doc fact-check per claim-bearing PR; W3-N/W3-P precedent).
- **Typecheck hook doesn't cover `.mdx`** — MDX errors surface only at `next build`; run a build before each content PR.
- **Out of scope:** marketing-nav refactor to a shared component; per-page dynamic OG images; doc versioning.
- **Open questions:** (a) should `/docs/agent-ingest` document the ingest API surface publicly or just the desktop-agent workflow? → recommend workflow-only in v1 (API docs raise claim-surface stakes). (b) legal-style "draft" banner on docs? → recommend no banner, conservative prose (docs are fact-checked against code, not pending external review). (c) ship search at ~15 pages? → recommend defer (PR 6 optional), revisit at 30+ pages.
