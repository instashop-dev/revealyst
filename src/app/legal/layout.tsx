import Link from "next/link";

// Public, unauthenticated legal pages (outside the (app) auth shell) — the
// linkable Terms/Privacy URLs that self-serve signup and Paddle MoR onboarding
// (W3-M) require. Static content only.

export default function LegalLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <main className="mx-auto min-h-dvh max-w-3xl px-6 py-12">
      <div className="mb-8 flex items-center justify-between gap-4">
        <Link
          href="/"
          className="flex items-center gap-2 text-sm font-semibold"
        >
          <span className="flex size-7 items-center justify-center rounded-lg bg-primary font-heading text-sm font-bold text-primary-foreground">
            R
          </span>
          Revealyst
        </Link>
        <nav className="flex gap-4 text-sm text-muted-foreground">
          <Link href="/legal/terms" className="hover:text-foreground">
            Terms
          </Link>
          <Link href="/legal/privacy" className="hover:text-foreground">
            Privacy
          </Link>
          <Link
            href="/legal/what-we-collect"
            className="hover:text-foreground"
          >
            What we collect
          </Link>
        </nav>
      </div>

      <article className="[&_a]:font-medium [&_a]:text-primary [&_a]:underline [&_h1]:mb-2 [&_h1]:font-heading [&_h1]:text-3xl [&_h1]:font-semibold [&_h1]:tracking-tight [&_h2]:mt-8 [&_h2]:mb-3 [&_h2]:text-lg [&_h2]:font-semibold [&_li]:mb-1 [&_p]:mb-4 [&_p]:text-sm [&_p]:leading-relaxed [&_p]:text-muted-foreground [&_ul]:mb-4 [&_ul]:ml-5 [&_ul]:list-disc [&_ul]:text-sm [&_ul]:text-muted-foreground">
        {children}
      </article>
    </main>
  );
}
