import {
  AGENT_NEVER_COLLECTED,
  AGENT_ON_DEVICE_ONLY_FIELDS,
  AGENT_SENT_FIELDS,
} from "@/lib/agent-collection-schema";

// The public "what we collect" schema page (Spec V4 §13 commitment, W5-N).
// GENERATED FROM the actual on-device allowlist mirror
// (src/lib/agent-collection-schema.ts), never a paraphrase — that module is
// byte-identical-pinned to the CLI's allowlist, which is itself pinned to the
// fields parse.ts actually reads (tests/agent-cli-contract.test.ts +
// packages/revealyst-agent/tests/allowlist.test.ts). So this page cannot claim
// to read less than the agent reads, nor more. Pairs with the in-app "what this
// sync sends" panel (W5-G). Do not hand-edit the field lists here — change the
// allowlist and this page follows.

export const metadata = {
  title: "What we collect · Revealyst",
};

export default function WhatWeCollectPage() {
  return (
    <>
      <h1>What we collect</h1>
      <p>
        <em>Generated from the Revealyst Agent&rsquo;s on-device allowlist.</em>
      </p>
      <p>
        The optional <strong>Revealyst Agent</strong> summarizes your local
        Claude Code sessions <strong>on your machine</strong> and pushes only
        aggregates. This page is generated directly from the agent&rsquo;s field
        allowlist — the same list the code enforces — so it can never describe
        reading less, or more, than the agent actually reads. The two categories
        below are the whole story: a small set of values that leave your machine,
        and a larger set read only on-device and reduced to counts before
        anything is sent.
      </p>

      <h2>Values that leave your machine</h2>
      <p>
        Only these leave your device, each as a number or a sanitized label —
        never free text:
      </p>
      <ul>
        {AGENT_SENT_FIELDS.map((f) => (
          <li key={f.field}>
            <strong>{f.label}</strong> — {f.purpose}
          </li>
        ))}
      </ul>

      <h2>Read on your machine only (never transmitted)</h2>
      <p>
        These are inspected locally to keep counts honest, then reduced to counts
        or day/hour buckets. Their values never leave your device:
      </p>
      <ul>
        {AGENT_ON_DEVICE_ONLY_FIELDS.map((f) => (
          <li key={f.field}>
            <strong>{f.label}</strong> — {f.purpose}
          </li>
        ))}
      </ul>

      <h2>Never read at all</h2>
      <p>
        The agent&rsquo;s parser never reads these fields — they are not filtered
        out after the fact, they are never accessed. There is no content field
        anywhere in the Revealyst data model.
      </p>
      <ul>
        {AGENT_NEVER_COLLECTED.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>

      <h2>How this compares to the connectors</h2>
      <p>
        API-key and app connectors (Anthropic, OpenAI, Cursor, GitHub Copilot)
        pull the behavioral usage metrics the vendors already expose on their
        admin APIs — never prompt or completion content, which those APIs do not
        return. See the{" "}
        <a href="/legal/privacy">Privacy Policy</a> for the full data-handling
        detail.
      </p>
    </>
  );
}
