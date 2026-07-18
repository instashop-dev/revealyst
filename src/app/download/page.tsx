import type { Metadata } from "next";
import Link from "next/link";
import { Apple, ArrowRight, Download, EyeOff, MonitorDown } from "lucide-react";
import { latestStableDownloads } from "@/lib/desktop-releases";
import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// Public marketing page on revealyst.com (classifyPath → "marketing"). Build-
// time prerendered: everything derives from the static DESKTOP_RELEASES
// registry, so there is no per-request data. Cross-host links to the app
// (app.revealyst.com/sign-in, /settings/devices) are plain <a> — a client-side
// RSC nav would be 308'd cross-origin and CORS-blocked; same-host links
// (/legal/*, /) stay <Link>.

export const metadata: Metadata = {
  title: "Download the Revealyst desktop app",
  description:
    "Install the Revealyst desktop app for macOS and Windows. It syncs supported AI-usage analytics from your computer in the background — your prompt text is never uploaded.",
};

const STEPS = [
  {
    title: "Install it",
    body: "Download the app for your computer and open it. It lives quietly in your menu bar or system tray.",
  },
  {
    title: "Sign in through your browser",
    body: "The app opens Revealyst in your browser so you can securely connect this computer — no passwords typed into the app.",
  },
  {
    title: "It syncs in the background",
    body: "Supported AI-usage analytics sync automatically. Manage your connected computers anytime under Settings → Devices.",
  },
];

export default function DownloadPage() {
  const release = latestStableDownloads();

  return (
    <main className="flex min-h-dvh flex-col">
      <section className="dark relative overflow-hidden bg-background text-foreground">
        <div
          aria-hidden
          className="absolute inset-0 bg-[radial-gradient(circle_at_center,var(--muted-foreground)_1px,transparent_1px)] [background-size:28px_28px] opacity-[0.13]"
        />
        <div
          aria-hidden
          className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,transparent_30%,var(--background)_85%)]"
        />
        <div className="relative mx-auto flex w-full max-w-5xl flex-col gap-14 px-6 pt-20 pb-24 md:pt-28">
          <nav className="flex items-center justify-between">
            <Link href="/" className="flex items-center gap-3">
              <BrandMark />
              <span className="font-heading text-lg font-semibold">
                Revealyst
              </span>
            </Link>
            <Button
              variant="ghost"
              nativeButton={false}
              render={<a href="/sign-in" />}
            >
              Sign in
            </Button>
          </nav>

          <div className="flex max-w-2xl flex-col gap-6">
            <span className="font-mono text-xs tracking-widest text-muted-foreground uppercase">
              Desktop app · macOS &amp; Windows
            </span>
            <h1 className="font-heading text-4xl font-semibold tracking-tight text-balance md:text-5xl">
              Connect this computer to Revealyst.
            </h1>
            <p className="text-lg text-muted-foreground text-pretty">
              The desktop app securely syncs supported AI-usage analytics from
              your computer in the background. Your prompt text is never
              uploaded &mdash; only the counts and signals that power your
              analytics.
            </p>

            {release ? (
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-3">
                  {release.downloads.map((d) => (
                    <Button
                      key={d.key}
                      size="lg"
                      nativeButton={false}
                      render={
                        // Absolute HTTPS artifact URL from the signed release.
                        <a href={d.url} download />
                      }
                    >
                      {d.key.startsWith("darwin") ? (
                        <Apple aria-hidden />
                      ) : (
                        <MonitorDown aria-hidden />
                      )}
                      Download for {d.label}
                    </Button>
                  ))}
                </div>
                <p className="text-sm text-muted-foreground">
                  Version {release.version} · signed &amp; notarized
                </p>
              </div>
            ) : (
              <Card className="max-w-md bg-background/60">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Download className="size-4" aria-hidden />
                    Downloads are coming soon
                  </CardTitle>
                  <CardDescription>
                    The signed macOS and Windows installers aren&apos;t
                    published yet. In the meantime you can set up the Revealyst
                    agent from Settings &rarr; Devices after you sign in.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Button
                    nativeButton={false}
                    render={<a href="/sign-in" />}
                  >
                    Go to Revealyst <ArrowRight aria-hidden />
                  </Button>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-5xl px-6 py-16 md:py-20">
        <h2 className="font-heading text-2xl font-semibold tracking-tight">
          How it works
        </h2>
        <ol className="mt-8 grid gap-6 md:grid-cols-3">
          {STEPS.map((step, i) => (
            <li key={step.title}>
              <Card className="h-full">
                <CardHeader>
                  <div className="font-mono text-xs text-muted-foreground">
                    Step {i + 1}
                  </div>
                  <CardTitle className="text-lg">{step.title}</CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground text-pretty">
                  {step.body}
                </CardContent>
              </Card>
            </li>
          ))}
        </ol>

        <Card className="mt-10 max-w-2xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <EyeOff className="size-4" aria-hidden />
              What leaves your computer
            </CardTitle>
            <CardDescription className="text-pretty">
              The app runs in Analytics Only mode: it uploads counts, timing
              buckets, model names, which AI apps you use, and the kind of task
              (guessed on your computer) &mdash; the words you type never leave
              your computer, and neither do your responses, files, or
              credentials.{" "}
              <Link
                href="/legal/what-we-collect"
                className="font-medium text-foreground underline underline-offset-4"
              >
                See exactly what we collect
              </Link>
              .
            </CardDescription>
          </CardHeader>
        </Card>
      </section>

      <footer className="border-t">
        <div className="mx-auto flex w-full max-w-5xl flex-col items-center justify-between gap-4 px-6 py-10 text-sm text-muted-foreground md:flex-row">
          <Link href="/" className="flex items-center gap-2 hover:text-foreground">
            <BrandMark size="sm" />
            <span>Revealyst</span>
          </Link>
          <div className="flex gap-6">
            <Link href="/legal/terms" className="hover:text-foreground">
              Terms
            </Link>
            <Link href="/legal/privacy" className="hover:text-foreground">
              Privacy
            </Link>
            <a href="/sign-in" className="hover:text-foreground">
              Sign in
            </a>
          </div>
        </div>
      </footer>
    </main>
  );
}
