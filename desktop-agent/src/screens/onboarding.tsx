// Onboarding stepper (spec §19.2). Wave M1: sign-in does not exist until M2,
// so the "Open browser" button is disabled ("Available soon") and no step
// performs any action. Steps are clickable so the flow can be previewed.
//
// Honesty rule (invariant b / W3-N: rendered UI copy is a claim surface):
// steps 3 and 5 render honest placeholders instead of the spec's target copy,
// because "sources found" and "this computer is connected" are claims nothing
// backs yet. The spec copy is kept below as ONBOARDING_TARGET_COPY so later
// waves light it up from real state.

import { useState } from "react";

// target copy — rendered only when backed by real detection/enrollment (M2/M5)
export const ONBOARDING_TARGET_COPY = {
  sourceDetection: {
    intro: "Supported sources found:",
    claudeCode: "Claude Code — Ready to connect.",
    claudeDesktop:
      "Claude Desktop — Installed; detailed conversation sync is not available in Phase 1.",
  },
  finish:
    "This computer is connected. Revealyst will run quietly in the background. " +
    "Prompt text is not uploaded in Analytics Only mode.",
} as const;

const STEPS = ["Welcome", "Sign in", "Sources", "Privacy mode", "Finish"] as const;

export default function OnboardingScreen() {
  const [step, setStep] = useState(0);
  const next = () => setStep((s) => Math.min(s + 1, STEPS.length - 1));

  return (
    <div>
      <h1>Set up Revealyst on this computer</h1>
      <ol className="steps">
        {STEPS.map((label, index) => (
          <li key={label}>
            <button
              type="button"
              className="step"
              aria-current={index === step ? "step" : undefined}
              onClick={() => setStep(index)}
            >
              {label}
            </button>
          </li>
        ))}
      </ol>

      {step === 0 && (
        <section>
          <h2>Welcome</h2>
          <p>
            Connect this computer to Revealyst. Revealyst securely syncs
            supported AI-usage analytics from this computer. Prompt text is
            not uploaded in the default mode.
          </p>
          <div className="button-row">
            <button type="button" className="primary" onClick={next}>
              Continue
            </button>
          </div>
        </section>
      )}

      {step === 1 && (
        <section>
          <h2>Sign in</h2>
          <p>Your browser will open so you can securely connect this computer.</p>
          <div className="button-row">
            <button type="button" className="primary" disabled>
              Open browser
            </button>
            <span className="muted">Available soon</span>
          </div>
        </section>
      )}

      {step === 2 && (
        <section>
          <h2>Source detection</h2>
          <p>
            After you sign in, Revealyst checks this computer for supported
            sources.
          </p>
          <p className="muted">Source detection is not available yet.</p>
          <div className="button-row">
            <button type="button" className="primary" onClick={next}>
              Continue
            </button>
          </div>
        </section>
      )}

      {step === 3 && (
        <section>
          <h2>Privacy mode</h2>
          <div className="choice">
            <input type="radio" name="privacy-mode" id="mode-analytics" checked readOnly />
            <label htmlFor="mode-analytics">
              <strong>Analytics Only</strong>
              <p className="muted">
                The default. Prompt text is not uploaded in this mode.
              </p>
            </label>
          </div>
          <div className="choice">
            <input type="radio" name="privacy-mode" id="mode-redacted" disabled />
            <label htmlFor="mode-redacted">
              <strong>Redacted Summary</strong>
              <p className="muted">Optional — not enabled by default.</p>
            </label>
          </div>
          <div className="choice">
            <input type="radio" name="privacy-mode" id="mode-full" disabled />
            <label htmlFor="mode-full">
              <strong>Full Content</strong>
              <p className="muted">Explicit opt-in only.</p>
            </label>
          </div>
          <div className="button-row">
            <button type="button" className="primary" onClick={next}>
              Continue
            </button>
          </div>
        </section>
      )}

      {step === 4 && (
        <section>
          <h2>Finish</h2>
          <p>
            Sign-in isn&apos;t available yet. When it is, this step will
            confirm your connection.
          </p>
          <div className="button-row">
            <button type="button" className="primary" disabled>
              Open Revealyst
            </button>
            <button type="button" className="secondary" disabled>
              Done
            </button>
            <span className="muted">Available soon</span>
          </div>
        </section>
      )}
    </div>
  );
}
