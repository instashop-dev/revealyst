---
name: new-connector
description: Scaffold a new vendor connector implementing the frozen Connector interface, wired to a recorded-fixture test harness. Use when the founder types /new-connector <vendor> (e.g. /new-connector cursor). So W2-J connectors start from the pattern, not from scratch.
---

# /new-connector <vendor>

Scaffolds a connector against the **frozen `Connector` contract** and its recorded-fixture
harness (rule 2). The vendor slug is the argument (e.g. `copilot`, `cursor`, `openai-admin`).

## Preconditions
- W0-C contracts are frozen and `docs/connector-facts.md` has this vendor's entry
  (endpoints, auth, granularity, attribution level). If the vendor is missing there, **stop**:
  that fact-finding is W0-A, and building without it risks a frozen-contract break.
- The `Connector` interface, fixture layout, and normalize→`metric_records` shape exist
  (from W1-D). This skill fills the pattern; it does not invent the framework.

## Steps

1. **Create the connector module** implementing the frozen `Connector`
   (`{ auth, discover(subjects), poll(window), normalize(raw) → metric_records }`). Do not
   alter the interface — if the vendor won't fit it, that's an `/adr`, not an edit.

2. **Wire the recorded-fixture harness**: a test that feeds recorded real payloads (scrubbed)
   through `normalize()` and asserts the produced `metric_records`, including
   `attribution_confidence` and `source_connector`. Fixtures are recorded from a live account
   by the founder — keys never go in prompts or the repo.

3. **Set the attribution level honestly** (§6.1): person-level only where the vendor exposes
   it; otherwise stay at key/account level and surface it — **never fabricate per-user numbers**.

4. **Respect the blast radius.** One connector = one directory. No shared-framework or schema
   edits from this skill; those are W1-D / W0-C.

Leave a failing/pending test as the definition of done, ready for the session's inner loop.
