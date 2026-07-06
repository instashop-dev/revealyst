# cursor — provisional recorded-shape fixtures

**Status: provisional (W2-J).** Hand-assembled to the *documented* shapes in
`docs/connector-facts.md` §2 (field inventory retrieved 2026-07-04) so the
connector's pure `normalize()` has a deterministic seam. They are NOT recordings
— they live here, outside `fixtures/vendor-payloads/`, precisely because that
directory is W1-S's recorder-only zone (`tests/vendor-fixtures.test.ts` rejects
any hand-written file there).

W1-S owns landing scrubbed **recorded real** responses from a live team via
`scripts/record/cursor.mjs` into `fixtures/vendor-payloads/cursor/` (rule 2).
When those arrive, their shapes must stay compatible with these — a divergence
is a normalize bug or a connector-facts erratum, a finding not a silent edit.

Files map 1:1 to `raw_payloads.kind` values (each is the FULL, page-concatenated
payload for its surface — see `types.ts` on why events cannot be split across
envelopes):
- `members.json` → the `/teams/members` roster (discover → person subjects,
  email-keyed). Alice + Bob.
- `daily-usage-data.json` → `cursor.daily-usage-data`. Alice is `isActive`
  with prompts/acceptance/tabs/lines/feature activity; **Bob is present but
  `isActive: false` with all-zero counts** — the pagination-honesty case:
  presence in a paginated response is not activity, so Bob yields no records.
  (No tokens/model here — that's events-only.)
- `filtered-usage-events.json` → `cursor.filtered-usage-events`. Three Alice
  events (two in the same UTC minute → peak-concurrency 2; one later hour) plus
  one **service-account** event (`serviceAccountId`, no `userEmail`) — the
  `service_accounts_unresolved` gap case, kept at `service_account` /
  `key_project`, never billed to a person.

Timestamps are epoch-ms strings (UTC): 2026-06-11 00:00 = 1781136000000,
09:00 = 1781168400000.
