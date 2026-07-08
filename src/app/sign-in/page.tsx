"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { AlertCircle, MailCheck } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { authClient } from "@/lib/auth-client";

type Mode = "sign-in" | "sign-up" | "forgot";

export default function SignInPage() {
  return (
    <Suspense>
      <SignInForm />
    </Suspense>
  );
}

function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Post-auth destination (e.g. an invite link round-trip). Same-origin
  // paths only — anything else falls back to the dashboard.
  const rawNext = searchParams.get("next");
  const next =
    rawNext && rawNext.startsWith("/") && !rawNext.startsWith("//")
      ? rawNext
      : "/dashboard";
  const [mode, setMode] = useState<Mode>("sign-in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  // A success/info panel (verification sent, reset link sent).
  const [info, setInfo] = useState<string | null>(null);
  // Set when sign-in is blocked on an unverified email — enables the resend.
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function switchMode(nextMode: Mode) {
    setMode(nextMode);
    setError(null);
    setInfo(null);
    setUnverifiedEmail(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);
    setUnverifiedEmail(null);

    if (mode === "forgot") {
      const result = await authClient.requestPasswordReset({
        email,
        redirectTo: "/reset-password",
      });
      setBusy(false);
      if (result.error) {
        setError(result.error.message ?? "Something went wrong");
      } else {
        setInfo("If that email has an account, we've sent a password reset link.");
      }
      return;
    }

    if (mode === "sign-up") {
      const result = await authClient.signUp.email({
        name,
        email,
        password,
        callbackURL: next,
      });
      setBusy(false);
      if (result.error) {
        setError(result.error.message ?? "Something went wrong");
      } else {
        // Email verification is required — do NOT route into the app.
        setInfo(
          `Check your inbox — we sent a confirmation link to ${email}. Confirm your email to finish signing up.`,
        );
      }
      return;
    }

    const result = await authClient.signIn.email({ email, password });
    setBusy(false);
    if (result.error) {
      if (result.error.code === "EMAIL_NOT_VERIFIED") {
        setUnverifiedEmail(email);
        setError(null);
      } else {
        setError(result.error.message ?? "Something went wrong");
      }
    } else {
      router.push(next);
    }
  }

  async function resendVerification() {
    if (!unverifiedEmail) return;
    setBusy(true);
    const result = await authClient.sendVerificationEmail({
      email: unverifiedEmail,
      callbackURL: next,
    });
    setBusy(false);
    if (result.error) {
      setError(result.error.message ?? "Could not resend the confirmation email");
    } else {
      setInfo(`Confirmation email resent to ${unverifiedEmail}.`);
      setUnverifiedEmail(null);
    }
  }

  const title =
    mode === "sign-up"
      ? "Create your account"
      : mode === "forgot"
        ? "Reset your password"
        : "Welcome back";
  const description =
    mode === "sign-up"
      ? "Every account starts as a personal workspace — free forever."
      : mode === "forgot"
        ? "Enter your email and we'll send you a reset link."
        : "Sign in to your Revealyst workspace.";

  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {info && (
            <Alert>
              <MailCheck />
              <AlertTitle>{info}</AlertTitle>
            </Alert>
          )}
          {unverifiedEmail && (
            <Alert>
              <MailCheck />
              <AlertTitle>Verify your email to continue</AlertTitle>
              <AlertDescription>
                We sent a confirmation link to {unverifiedEmail}. Didn&apos;t get
                it?{" "}
                <Button
                  type="button"
                  variant="link"
                  className="h-auto p-0"
                  disabled={busy}
                  onClick={resendVerification}
                >
                  Resend confirmation
                </Button>
              </AlertDescription>
            </Alert>
          )}
          <form onSubmit={submit} className="flex flex-col gap-4">
            <FieldGroup>
              {mode === "sign-up" && (
                <Field>
                  <FieldLabel htmlFor="name">Name</FieldLabel>
                  <Input
                    id="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoComplete="name"
                  />
                </Field>
              )}
              <Field>
                <FieldLabel htmlFor="email">Email</FieldLabel>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  required
                />
              </Field>
              {mode !== "forgot" && (
                <Field>
                  <FieldLabel htmlFor="password">Password</FieldLabel>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete={
                      mode === "sign-up" ? "new-password" : "current-password"
                    }
                    required
                    minLength={8}
                  />
                  {mode === "sign-in" && (
                    <Button
                      type="button"
                      variant="link"
                      className="mr-auto h-auto p-0 text-xs"
                      onClick={() => switchMode("forgot")}
                    >
                      Forgot password?
                    </Button>
                  )}
                </Field>
              )}
            </FieldGroup>
            {error && (
              <Alert variant="destructive">
                <AlertCircle />
                <AlertTitle>{error}</AlertTitle>
              </Alert>
            )}
            <Button type="submit" disabled={busy}>
              {busy && <Spinner data-icon="inline-start" />}
              {mode === "sign-up"
                ? "Create account"
                : mode === "forgot"
                  ? "Send reset link"
                  : "Sign in"}
            </Button>
          </form>
          {mode !== "forgot" && (
            <>
              <div className="flex items-center gap-3">
                <Separator className="flex-1" />
                <span className="text-xs text-muted-foreground">or</span>
                <Separator className="flex-1" />
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  authClient.signIn.social({
                    provider: "github",
                    callbackURL: next,
                  })
                }
              >
                Sign in with GitHub
              </Button>
            </>
          )}
        </CardContent>
        <CardFooter className="flex flex-col gap-2">
          {mode === "forgot" ? (
            <Button
              type="button"
              variant="link"
              className="mx-auto"
              onClick={() => switchMode("sign-in")}
            >
              Back to sign in
            </Button>
          ) : (
            <Button
              type="button"
              variant="link"
              className="mx-auto"
              onClick={() =>
                switchMode(mode === "sign-in" ? "sign-up" : "sign-in")
              }
            >
              {mode === "sign-in"
                ? "No account? Create one"
                : "Have an account? Sign in"}
            </Button>
          )}
          <p className="text-center text-xs text-muted-foreground">
            By continuing you agree to our{" "}
            <Link href="/legal/terms" className="underline hover:text-foreground">
              Terms
            </Link>{" "}
            and{" "}
            <Link
              href="/legal/privacy"
              className="underline hover:text-foreground"
            >
              Privacy Policy
            </Link>
            .
          </p>
        </CardFooter>
      </Card>
    </main>
  );
}
