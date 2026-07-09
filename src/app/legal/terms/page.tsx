// Terms of Service. Product-behavior statements are grounded in the real
// system (Product Spec §7); commercial terms are grounded in the W3-M
// Paddle-as-MoR model.

import { FREE_TRACKED_USER_LIMIT } from "@/lib/entitlements";

export const metadata = {
  title: "Terms of Service · Revealyst",
};

export default function TermsPage() {
  return (
    <>
      <h1>Terms of Service</h1>
      <p>
        <em>Last updated: 08 July 2026.</em>
      </p>
      <p>
        These Terms of Service (&ldquo;Terms&rdquo;) govern your access to and
        use of Revealyst (the &ldquo;Service&rdquo;), operated by{" "}
        <strong>Thalia Technologies Private Limited</strong>{" "}
        (&ldquo;we&rdquo;, &ldquo;us&rdquo;). By creating an account or using
        the Service you agree
        to these Terms. If you use the Service on behalf of an organization, you
        represent that you are authorized to bind that organization.
      </p>

      <h2>1. The Service</h2>
      <p>
        Revealyst is a cross-vendor analytics product that measures adoption,
        fluency, and cost-efficiency of AI developer tools. It reads usage and
        cost data from the vendor accounts you connect (for example Anthropic,
        OpenAI, and Cursor) and from the optional Revealyst
        Agent, and presents normalized metrics and scores. The Service does not
        read the content of your prompts, completions, code, or messages.
      </p>

      <h2>2. Accounts and plans</h2>
      <ul>
        <li>
          <strong>Personal</strong> — free, for a single individual connecting
          their own tools.
        </li>
        <li>
          <strong>Team</strong> — a paid, per-tracked-user subscription for
          multi-user organizations. A &ldquo;tracked user&rdquo; is an
          identity-resolved person with at least one usage record in the billing
          period; usage that resolves only to a shared key or account is
          surfaced but not billed. Teams of up to {FREE_TRACKED_USER_LIMIT}{" "}
          tracked users are free.
        </li>
      </ul>
      <p>
        You are responsible for maintaining the confidentiality of your
        credentials and for all activity under your account.
      </p>

      <h2>3. Billing and Merchant of Record</h2>
      <p>
        Paid subscriptions are sold and processed by{" "}
        <strong>Paddle</strong>, our Merchant of Record. Paddle is the seller of
        record for these transactions and handles payment, billing, invoicing,
        and the collection and remittance of applicable sales taxes and VAT.
        Your purchase is therefore also subject to{" "}
        <a
          href="https://www.paddle.com/legal/checkout-buyer-terms"
          target="_blank"
          rel="noreferrer"
        >
          Paddle&rsquo;s buyer terms
        </a>
        . Team subscriptions are billed on the number of tracked users; quantity
        changes are prorated per Paddle&rsquo;s rules. Any time-boxed founder
        pricing is applied as a discount and is publicly sunset-dated.
      </p>

      <h2>4. Refunds</h2>
      <p>
        Our company uses Paddle as our Merchant of Record for all payments.
        All transactions are processed securely through Paddle in accordance
        with their Buyer Protection policies.
      </p>
      <p>
        We offer refunds in line with Paddle&rsquo;s refund guidelines. If you
        believe a charge was made in error, or if you are unsatisfied with
        your purchase, you may request a refund within the applicable time
        window set by Paddle. Refund eligibility may vary depending on the
        specific product, subscription term, and usage conditions.
      </p>
      <p>Please note:</p>
      <ul>
        <li>Refunds are not guaranteed in all cases.</li>
        <li>
          Paddle may assess eligibility based on factors such as usage, time
          since purchase, or potential misuse.
        </li>
        <li>
          Approved refunds will be issued by Paddle to the original payment
          method.
        </li>
      </ul>

      <h2>5. Connected accounts and credentials</h2>
      <p>
        To use the Service you provide credentials (such as vendor API keys or
        an installed app). We use them solely to read your usage data and never
        to make changes to your vendor accounts. You represent that you are
        authorized to connect those accounts. We store these credentials
        encrypted at rest and use them only to provide the
        Service. You may disconnect an account at any time.
      </p>

      <h2>6. Acceptable use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>use the Service to monitor individuals unlawfully, or in breach of
          your obligations to your workers or their representatives (see our{" "}
          <a href="/legal/privacy">Privacy Policy</a> and in-app compliance
          guidance);
        </li>
        <li>connect accounts you are not authorized to connect;</li>
        <li>attempt to circumvent tenant isolation, access other customers&rsquo;
          data, or probe the Service&rsquo;s security without authorization;</li>
        <li>resell or provide the Service to third parties except as permitted.</li>
      </ul>

      <h2>7. Data</h2>
      <p>
        Our handling of personal data is described in the{" "}
        <a href="/legal/privacy">Privacy Policy</a>. For customers acting as a
        data controller over their workers&rsquo; personal data, our Data
        Processing Agreement governs that processing and is available on request
        (see <a href="/legal/privacy">Privacy Policy</a>). You retain ownership
        of your data; we retain aggregated, non-identifying operational metrics.
      </p>

      <h2>8. Availability, warranties, and liability</h2>
      <p>
        The Service is provided on an &ldquo;as is&rdquo; and &ldquo;as
        available&rdquo; basis. To the maximum extent permitted by law, we
        disclaim implied warranties, and our aggregate liability is limited as
        set out here: <strong>if liability is found on the part of the
        Company, it will be limited to the amount paid for the products
        and/or services, and under no circumstances will there be
        consequential or punitive damages</strong>. Nothing limits liability
        that cannot be limited by law.
      </p>

      <h2>9. Termination</h2>
      <p>
        You may stop using the Service and cancel your subscription at any time
        through the customer portal. We may suspend or terminate access for
        material breach of these Terms. On termination we delete or return your
        data in accordance with the Privacy Policy and DPA.
      </p>

      <h2>10. Changes</h2>
      <p>
        We may update these Terms; material changes will be notified in advance.
        Continued use after changes take effect constitutes acceptance.
      </p>

      <h2>11. Governing law and contact</h2>
      <p>
        These Terms are governed by the laws of{" "}
        <strong>Mumbai, India</strong>. Questions:{" "}
        <strong>info@revealyst.com</strong>.
      </p>
    </>
  );
}
