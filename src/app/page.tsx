import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 p-8 text-center">
      <div className="flex size-12 items-center justify-center rounded-xl bg-primary font-heading text-xl font-bold text-primary-foreground">
        R
      </div>
      <div className="flex max-w-xl flex-col gap-3">
        <h1 className="font-heading text-4xl font-semibold tracking-tight">
          Revealyst
        </h1>
        <p className="text-balance text-lg text-muted-foreground">
          See who&apos;s actually adopting AI — and how well — across all your
          AI tools.
        </p>
      </div>
      <Button size="lg" render={<Link href="/sign-in" />}>
        Sign in
        <ArrowRight data-icon="inline-end" />
      </Button>
    </main>
  );
}
