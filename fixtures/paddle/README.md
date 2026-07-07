# Paddle webhook fixtures (W3-M)

Schema-accurate Paddle Billing webhook payloads for the four events Revealyst
subscribes to, used by `tests/paddle-webhook.test.ts` as the CI harness that
proves `subscription.*` / `transaction.completed` → entitlement transitions
without clicking through Paddle (execution plan §W3-M: "tested, not clicked").

- `subscription-created.json` — new Team subscription, `active`, 5 seats.
- `subscription-updated.json` — same subscription, seats raised to 12.
- `subscription-canceled.json` — `canceled` with `canceled_at`.
- `transaction-completed.json` — payment confirmation (acknowledged, no
  entitlement change; the `subscription.*` events own entitlement state).
- `subscription-unknown-status.json` — a status outside our enum; the handler
  must acknowledge + skip it, never crash the write (ADR 0009).

Notes:
- `custom_data.org_id` is the checkout passthrough (set in W3-M PR3). Fixtures
  carry the placeholder `"ORG_PLACEHOLDER"`; the test rewrites it to a real
  fixture org before signing, so the signed body matches the posted body.
- The signature is computed by the test over the exact posted body with a test
  secret — these files hold no real Paddle signature. At the live sandbox gate,
  replace them with truly-recorded sandbox deliveries (rule 2).
- The price id (`pri_01kwxp80bbbgpaaat2501eybpb`) is the real Paddle **sandbox**
  Team price.
