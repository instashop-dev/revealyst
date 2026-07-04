"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";

export default function SignInPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const result =
      mode === "sign-up"
        ? await authClient.signUp.email({ name, email, password })
        : await authClient.signIn.email({ email, password });
    setBusy(false);
    if (result.error) {
      setError(result.error.message ?? "Something went wrong");
    } else {
      router.push("/dashboard");
    }
  }

  return (
    <main>
      <h1>Revealyst</h1>
      <form onSubmit={submit} className="auth-form">
        {mode === "sign-up" && (
          <input
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
          />
        )}
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={
            mode === "sign-up" ? "new-password" : "current-password"
          }
          required
          minLength={8}
        />
        <button type="submit" disabled={busy}>
          {mode === "sign-up" ? "Create account" : "Sign in"}
        </button>
        {error && <p className="error">{error}</p>}
      </form>
      <button
        type="button"
        className="link"
        onClick={() => setMode(mode === "sign-in" ? "sign-up" : "sign-in")}
      >
        {mode === "sign-in"
          ? "No account? Create one"
          : "Have an account? Sign in"}
      </button>
      <button
        type="button"
        className="link"
        onClick={() => authClient.signIn.social({ provider: "github" })}
      >
        Sign in with GitHub
      </button>
    </main>
  );
}
