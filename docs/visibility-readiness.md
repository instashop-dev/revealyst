# Visibility-readiness playbook

> Static guided content (Product Spec §6.3). Shown in-app at `/playbook` and
> linked from the shared-account signals on the Reconcile page. **Zero new
> software** — this is guidance, not a feature.

When Revealyst flags an account as *likely shared*, adoption is being
**undercounted**: the usage of several people collapses into one seat, so your
per-person adoption and fluency numbers read low and your spend looks
concentrated. Moving from shared credentials to per-user access fixes three
things at once:

- **Accurate adoption & fluency** — usage attributes to real people, so scores
  and team benchmarks reflect reality instead of a blurred average.
- **ToS compliance** — most vendors prohibit credential sharing; per-user
  access keeps you inside the terms you agreed to.
- **Security & governance** — a shared key or login is an unrevocable,
  unattributable secret. Per-user access means clean offboarding and an audit
  trail.

You don't have to do all of this at once. Each step below independently
improves data quality; do the ones that fit the tools you run.

## Step 1 — Issue per-user API keys

Replace shared admin/organization API keys with one key per person. Usage then
carries a real owner instead of landing at the account level.

- **Anthropic (API / Console)** — create a workspace member per person and
  issue each their own API key. The Console's usage & cost reports then break
  down by key owner. (Note: OAuth-only users can be missing from Console
  breakdowns — a known vendor gap Revealyst surfaces honestly rather than
  papering over.)
- **OpenAI** — issue per-user API keys (or per-project keys scoped to one
  person). OpenAI's usage is person-level **only** when the customer issues
  per-user keys; a shared org key stays account-level, and Revealyst shows it
  as such.
- **Rotate out the shared key** once per-user keys are live, so new usage stops
  accumulating on the unattributable credential.

## Step 2 — Migrate shared consumer logins to Team/Business plans

A shared ChatGPT Plus or Claude Pro login is the hardest case: one seat, many
people, no admin visibility, and usually against the vendor's terms.

- **ChatGPT** — move shared Plus logins to **ChatGPT Team / Enterprise**, which
  gives per-member seats and an admin console.
- **Claude** — move shared Pro logins to **Claude Team / Enterprise** for
  per-member seats and workspace administration.
- Give each person their own seat and retire the shared login.

## Step 3 — Reconcile the new identities in Revealyst

Once per-user keys and seats exist, the connectors discover per-person
subjects. Finish the job on the **[Reconcile](/reconcile)** page:

- Map each vendor account to a real person (email matches are proposed
  automatically; the rest are one click).
- Leave genuinely shared or service accounts unresolved — Revealyst keeps them
  at account level rather than inventing per-user numbers.
- Assign people to teams so team-level scores and the privacy-default views
  populate.

## What you gain

After a pass through this playbook, the shared-account flags clear on their
own: usage now attributes to people, adoption reflects your real headcount, and
your spend and fluency numbers are trustworthy enough to act on.
