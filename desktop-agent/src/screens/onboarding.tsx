// Onboarding stepper (spec §19.2) — Wave M1: static copy only. The copy is
// the spec's, verbatim. Sign-in does not exist until M2, so the "Open
// browser" button is disabled ("Available soon") and no step performs any
// action. Steps are clickable so the flow can be previewed.

import { useState } from "react";

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
          <p>Supported sources found:</p>
          <ul>
            <li>Claude Code — Ready to connect.</li>
            <li>
              Claude Desktop — Installed; detailed conversation sync is not
              available in Phase 1.
            </li>
          </ul>
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
            This computer is connected. Revealyst will run quietly in the
            background. Prompt text is not uploaded in Analytics Only mode.
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
