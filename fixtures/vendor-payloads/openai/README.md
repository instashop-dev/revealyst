# openai — provisional recorded-shape fixtures

**Status: provisional (W1-D).** Hand-assembled to the *documented* shapes in
`docs/connector-facts.md` §4 (field inventory retrieved 2026-07-04) so the
connector's pure `normalize()` has a deterministic seam. NOT yet recorded from
a live org — W1-S replaces them with scrubbed recordings via
`scripts/verify/openai.mjs` (rule 2).

One connector, two credential modes: these fixtures serve BOTH the
personal-key mode (W1-D) and the org-admin mode (W2-J) — same shapes, same
`normalize()`.

Files map 1:1 to `raw_payloads.kind` values:
- `usage-completions-1h.json` → `openai.usage.completions.1h`
  (contains a user-owned-key row, a service-key row with `user_id: null`
  — the shared_key_not_person_level gap case — a `batch: true` row, and an
  all-zero idle row.)
- `costs-1d.json` → `openai.costs.1d` (float-USD amounts, no user dimension.)

Bucket times are Unix seconds (UTC): 2026-06-11 09:00 = 1781168400.
