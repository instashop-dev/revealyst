// Onboarding stepper (spec §19.2). Wave M2 lights up the Sign in step: it runs
// the real browser-based PKCE pairing (`beginSignIn`) and reflects the stored
// keychain token via `isSignedIn`. Source detection (step 3) stays an honest
// placeholder — it is not built until M5.
//
// Honesty rule (invariant b / W3-N: rendered UI copy is a claim surface):
// "signed in" renders only when the keychain actually holds a device token;
// "sources found" and any "syncing" claim stay unrendered because nothing
// backs them yet. The spec copy is kept below as ONBOARDING_TARGET_COPY so
// later waves light it up from real state.

import { useEffect, useState } from "react";

import { beginSignIn, isSignedIn } from "../lib/agent";

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

  const [signedIn, setSignedIn] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);

  // Reflect any existing keychain token on mount.
  useEffect(() => {
    let active = true;
    isSignedIn()
      .then((value) => {
        if (active) setSignedIn(value);
      })
      .catch(() => {
        // No signal available yet — treat as not signed in.
      });
    return () => {
      active = false;
    };
  }, []);

  async function handleSignIn() {
    setSigningIn(true);
    setSignInError(null);
    try {
      const ok = await beginSignIn();
      if (ok) {
        setSignedIn(true);
      } else {
        setSignInError("Sign-in didn't finish. Please try again.");
      }
    } catch (error) {
      setSignInError(
        typeof error === "string" ? error : "Sign-in didn't finish. Please try again.",
      );
    } finally {
      setSigningIn(false);
    }
  }

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
          {signedIn ? (
            <p>This computer is signed in to Revealyst.</p>
          ) : (
            <>
              <p>Your browser will open so you can securely connect this computer.</p>
              <div className="button-row">
                <button
                  type="button"
                  className="primary"
                  onClick={handleSignIn}
                  disabled={signingIn}
                >
                  {signingIn ? "Waiting for your browser…" : "Open browser"}
                </button>
              </div>
              {signInError && (
                <p className="muted" role="alert">
                  {signInError}
                </p>
              )}
            </>
          )}
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
                The default. It takes effect when collection arrives — prompt
                text will not be uploaded in this mode.
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
          {signedIn ? (
            <p>
              This computer is signed in. Finding your AI tools and syncing
              usage arrive in a later update.
            </p>
          ) : (
            <p>Complete the &ldquo;Sign in&rdquo; step to connect this computer.</p>
          )}
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
