import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getApiContext } from "@/lib/api-context";
import { trackLaunchEvent } from "@/lib/launch-events";
import { resolveShareCard } from "@/lib/share-card";

// Public, unauthenticated score card (ADR 0008). The token is the capability;
// a revoked/unknown token 404s. Renders a resilient HTML card so the link
// works even where the OG preview image doesn't; opengraph-image.tsx supplies
// the social-preview image for this same route.
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const { db } = getApiContext();
  const card = await resolveShareCard(db, token);
  if (!card) {
    return { title: "Revealyst" };
  }
  const title =
    card.value !== null
      ? `${card.publicLabel}: ${card.scoreLabel} ${card.value}`
      : `${card.publicLabel} on Revealyst`;
  return {
    title,
    description: "Measured AI adoption, fluency, and efficiency — via Revealyst.",
    openGraph: { title },
    twitter: { card: "summary_large_image", title },
  };
}

export default async function ShareCardPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const { db } = getApiContext();
  const card = await resolveShareCard(db, token);
  if (!card) {
    notFound();
  }
  // §15 share-card virality: name + score slug + host only — never the
  // token, label, or any identifier (src/lib/launch-events.ts privacy rule;
  // crawler-unfurl conflation documented there too).
  await trackLaunchEvent("share_card_view", card.scoreSlug);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 p-6">
      <div className="flex w-full max-w-md flex-col items-center gap-6 rounded-2xl border bg-card p-10 text-center shadow-sm">
        <div className="flex size-10 items-center justify-center rounded-lg bg-primary font-heading text-base font-bold text-primary-foreground">
          R
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium text-muted-foreground">
            {card.publicLabel}
          </span>
          <span className="text-lg text-muted-foreground">{card.scoreLabel}</span>
        </div>
        {card.value !== null ? (
          <div className="flex items-end justify-center gap-1">
            <span className="font-heading text-7xl font-semibold tabular-nums">
              {card.value}
            </span>
            <span className="pb-3 text-lg text-muted-foreground">/ 100</span>
          </div>
        ) : (
          <p className="text-muted-foreground">Score being computed.</p>
        )}
        <p className="text-xs text-muted-foreground">
          Measured across real AI-tool usage — not self-reported.
        </p>
      </div>
      <Button
        variant="outline"
        nativeButton={false}
        render={<Link href="/" />}
      >
        Measure your own AI fluency
        <ArrowRight data-icon="inline-end" />
      </Button>
    </main>
  );
}
