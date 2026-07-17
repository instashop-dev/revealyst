// Onboarding stepper (spec §19.2). Wave M2 lit up the Sign in step (real
// browser-based PKCE pairing via `beginSignIn`, reflected by `isSignedIn`).
// This change makes the last two steps real too: Sources runs a LOCAL presence
// check on this computer (`detectSources`), and Finish completes setup —
// hiding the window to the tray and marking the first run done
// (`finishOnboarding`), optionally opening the web app (`openRevealyst`).
//
// Honesty rule (invariant b / W3-N: rendered UI copy is a claim surface):
// "signed in" renders only when the keychain actually holds a device token;
// "we found <source>" renders only for a source the local check actually
// found; an empty result shows a reassuring empty state, never a fabricated
// "found". Source detection is presence-only — it uploads nothing and reads no
// prompt text.

import { useEffect, useState } from "react";

import {
  beginSignIn,
  detectSources,
  finishOnboarding,
  isSignedIn,
  openRevealyst,
  type DetectedSource,
} from "../lib/agent";

const STEPS = ["Welcome", "Sign in", "Sources", "Privacy mode", "Finish"] as const;

export default function OnboardingScreen() {
  const [step, setStep] = useState(0);
  const next = () => setStep((s) => Math.min(s + 1, STEPS.length - 1));

  const [signedIn, setSignedIn] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);

  // Sources step: the result of the local presence check. `null` = not checked
  // yet (or still checking).
  const [sources, setSources] = useState<DetectedSource[] | null>(null);
  const [checkingSources, setCheckingSources] = useState(false);

  // Finish step: an in-flight completion (open/hide) so the buttons can't be
  // double-clicked.
  const [finishing, setFinishing] = useState(false);

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

  // Run the local source check whenever the user is on the Sources step. Cheap:
  // one in-process command, no network. Re-runs on each visit so a source that
  // appears mid-setup is picked up.
  useEffect(() => {
    if (step !== 2) return;
    let active = true;
    setCheckingSources(true);
    detectSources()
      .then((found) => {
        if (active) setSources(found);
      })
      .catch(() => {
        // Outside Tauri (tests/dev) or a read error — treat as none found
        // (honest empty state, never a fabricated "found").
        if (active) setSources([]);
      })
      .finally(() => {
        if (active) setCheckingSources(false);
      });
    return () => {
      active = false;
    };
  }, [step]);

  async function handleFinish(openApp: boolean) {
    setFinishing(true);
    try {
      if (openApp) {
        // Best-effort: a failure to open the browser must NOT block finishing
        // setup, so swallow its error independently of the hide below.
        await openRevealyst().catch(() => {});
      }
      await finishOnboarding();
    } catch {
      // Even if hiding fails, the agent keeps running in the tray — there is
      // nothing to surface to the user here.
    } finally {
      setFinishing(false);
    }
  }

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
          <h2>Sources</h2>
          <p>
            Revealyst checks this computer for supported AI tools. This check
            runs on your computer — nothing is uploaded.
          </p>
          {sources === null && checkingSources ? (
            <p className="muted">Checking this computer…</p>
          ) : sources && sources.length > 0 ? (
            <ul className="sources">
              {sources.map((source) => (
                <li key={source.name}>We found {source.name} on this computer.</li>
              ))}
            </ul>
          ) : (
            <p className="muted">
              No supported AI tools found on this computer yet — that&rsquo;s
              okay. You can finish setup now, and Revealyst will pick one up
              automatically once it appears.
            </p>
          )}
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
            <>
              <p>
                This computer is connected. Revealyst will keep running quietly
                in the background — you can close this window any time.
              </p>
              <p className="muted">
                In Analytics Only mode, your prompt text is never uploaded.
              </p>
              <div className="button-row">
                <button
                  type="button"
                  className="primary"
                  onClick={() => handleFinish(true)}
                  disabled={finishing}
                >
                  Open Revealyst
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => handleFinish(false)}
                  disabled={finishing}
                >
                  Done
                </button>
              </div>
            </>
          ) : (
            <>
              <p>Complete the &ldquo;Sign in&rdquo; step to connect this computer.</p>
              <div className="button-row">
                <button type="button" className="primary" disabled>
                  Open Revealyst
                </button>
                <button type="button" className="secondary" disabled>
                  Done
                </button>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}
