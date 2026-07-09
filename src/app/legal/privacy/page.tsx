// Privacy Policy. Every statement about how the product handles data is
// grounded in the real system (schema, agent, credential + tenancy
// contracts); see the fact-check in the W3-N PR chain. Do not add claims
// the product does not implement.

export const metadata = {
  title: "Privacy Policy · Revealyst",
};

export default function PrivacyPage() {
  return (
    <>
      <h1>Privacy Policy</h1>
      <p>
        <em>Last updated: 08 July 2026.</em>
      </p>
      <p>
        This Privacy Policy explains how{" "}
        <strong>Thalia Technologies Private Limited</strong>{" "}
        (&ldquo;we&rdquo;) handles personal data in Revealyst. Revealyst is
        designed to be <strong>EU-safe by default</strong>: it measures how
        teams adopt AI tools using only the behavioral signals the tool vendors
        already expose — never the content of prompts, completions, code, or
        messages.
      </p>

      <h2>1. Roles</h2>
      <p>
        For a customer&rsquo;s workspace, the customer is the{" "}
        <strong>controller</strong> of their workers&rsquo; personal data and we
        act as their <strong>processor</strong>, governed by our Data Processing
        Agreement (§8). For our own account and billing data, and for Personal
        (individual) accounts, we act as controller. Paddle is the Merchant of
        Record for payments and is an independent controller of the payment data
        it processes.
      </p>

      <h2>2. What we process</h2>
      <ul>
        <li>
          <strong>Account data</strong> — name, email, and authentication data
          for people who log in.
        </li>
        <li>
          <strong>Behavioral usage signals</strong> from connected vendor
          accounts — active days, sessions, prompt/message counts, token and
          spend totals, model mix, acceptance/retry rates, feature usage, and
          output-shipped counts (commits/PRs/lines). These are numeric usage
          metrics per person, tool, and day.
        </li>
        <li>
          <strong>Identity mapping data</strong> — vendor account identifiers
          and, where you choose to map them, work email to person.
        </li>
      </ul>
      <p>
        <strong>We never process prompt or completion content.</strong> There is
        no content field in our data model; the optional Revealyst Agent
        summarizes local tool logs on your machine and structurally cannot send
        content; and there is no browser extension or proxy. We do not process
        special-category data.
      </p>

      <h2>3. How we use it and our legal basis</h2>
      <p>
        We process usage data to provide the analytics you connect the Service
        to produce. For workplace data, the appropriate lawful basis is normally
        the customer&rsquo;s <strong>legitimate interests</strong> (managing and
        getting value from their AI-tool investment), balanced by the privacy
        protections below. We do not rely on employee consent as a basis, in
        line with EDPB guidance on the employer&ndash;employee power imbalance.
      </p>

      <h2>4. Privacy protections built into the product</h2>
      <ul>
        <li>
          <strong>Team-level, pseudonymized by default.</strong> People are
          stored under a pseudonym; real identities are surfaced only if an
          admin explicitly changes the workspace visibility mode away from the
          Private (team-only) default.
        </li>
        <li>
          <strong>No fabricated individual data.</strong> Where usage resolves
          only to a shared key or account, we keep it at account level and flag
          it — we never invent per-person figures.
        </li>
        <li>
          <strong>Individual self-view is opt-in</strong> and framed as
          self-coaching, not a manager surveillance tool.
        </li>
      </ul>

      <h2>5. Security</h2>
      <p>
        Vendor credentials — the highest-value data we hold — are encrypted at
        rest with per-record AES-256-GCM envelope encryption under a versioned
        application-held key, and are used only to read your usage data (we
        perform no writes or administrative actions on your vendor accounts).
        Tenant isolation is enforced mechanically so one customer&rsquo;s data
        cannot be read by another.
      </p>

      <h2>6. Retention</h2>
      <p>
        Raw vendor payloads are retained approximately <strong>90 days</strong>{" "}
        to allow correction of normalization errors, then purged automatically;
        after that only the derived metrics and scores remain. Account data is
        retained for the life of the account and deleted on request in
        accordance with the DPA.
      </p>

      <h2>7. Sub-processors and transfers</h2>
      <p>
        We use a small set of sub-processors to run the Service, including{" "}
        <strong>Neon</strong> (database hosting), <strong>Cloudflare</strong>{" "}
        (application compute and delivery), <strong>AWS</strong> (Amazon Web
        Services, for email delivery infrastructure), and{" "}
        <strong>Paddle</strong> (payments, as Merchant of Record). The current
        list, locations, and any transfer safeguards (e.g. Standard
        Contractual Clauses) are maintained in the DPA.
      </p>

      <h2>8. Data Processing Agreement</h2>
      <p>
        Customers acting as controllers can enter our Data Processing Agreement,
        which sets out processing instructions, sub-processors, security
        measures, and deletion obligations. It is available on request at{" "}
        <strong>info@revealyst.com</strong>.
      </p>

      <h2>9. Anonymized benchmarks (opt-in)</h2>
      <p>
        You may optionally consent to contribute anonymized, aggregated metrics
        to future published benchmarks. This is <strong>off by default</strong>,
        recorded as an explicit opt-in, and can be withdrawn at any time. We do
        not use your data for benchmarks unless you opt in.
      </p>

      <h2>10. Your rights</h2>
      <p>
        Depending on your location you have rights to access, correct, delete,
        or restrict processing of your personal data, and to object or lodge a
        complaint with a supervisory authority. For workplace data, direct
        requests to the customer (controller); we assist them as processor.
        Contact: <strong>info@revealyst.com</strong>.
      </p>

      <h2>11. Changes</h2>
      <p>
        We may update this Policy; material changes will be notified. Continued
        use after changes take effect constitutes acknowledgement.
      </p>
    </>
  );
}
