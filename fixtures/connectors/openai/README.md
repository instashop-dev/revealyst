# openai — provisional recorded-shape fixtures

**Status: provisional (W1-D).** Hand-assembled to the *documented* shapes in
`docs/connector-facts.md` §4 (field inventory retrieved 2026-07-04) so the
connector's pure `normalize()` has a deterministic seam. They are NOT recordings
— they live here, outside `fixtures/vendor-payloads/`, precisely because that
directory is W1-S's recorder-only zone (`tests/vendor-fixtures.test.ts` rejects
any hand-written file there, even one that matches the envelope schema).

W1-S owns landing scrubbed **recorded real** responses from a live org via
`scripts/record/openai.mjs` into `fixtures/vendor-payloads/openai/` (rule 2).
When those recordings arrive, their payload shapes must stay compatible with
these fixtures — a divergence is a normalize bug or a connector-facts erratum,
and either way a finding, not a silent edit.

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
