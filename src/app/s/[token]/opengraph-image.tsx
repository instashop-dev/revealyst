import { ImageResponse } from "next/og";
import { getApiContext } from "@/lib/api-context";
import { trackLaunchEvent } from "@/lib/launch-events";
import { resolveShareCard } from "@/lib/share-card";

// Social-preview image for a public share card (ADR 0008). Text-only with the
// default font — no external assets/fonts — to stay portable on the Workers
// runtime. Next auto-wires this to og:image / twitter:image for /s/[token].
export const dynamic = "force-dynamic";
export const alt = "AI score card — Revealyst";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function ShareCardImage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  // `await` returns the value whether params is a Promise (Next 15 pages) or a
  // plain object (image-route convention) — robust to either.
  const { token } = await params;
  const { db } = getApiContext();
  const card = await resolveShareCard(db, token);
  if (card) {
    // §15: OG-image fetches ≈ link unfurls in socials/chat. Slug + host only —
    // never the token or label (src/lib/launch-events.ts privacy rule).
    await trackLaunchEvent("share_card_og_view", card.scoreSlug);
  }

  const label = card?.publicLabel ?? "Revealyst";
  const scoreLabel = card?.scoreLabel ?? "AI Fluency";
  // §7.1 band-first: the level is the hero; the raw number is a small footnote.
  const bandLabel = card?.band?.label ?? "On Revealyst";
  const measured =
    card && card.value !== null ? `${card.value} / 100 measured` : "Score being computed";

  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#0b0b0f",
          color: "#fafafa",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ fontSize: 40, color: "#a1a1aa", display: "flex" }}>
          {label}
        </div>
        <div style={{ fontSize: 44, color: "#a1a1aa", display: "flex", marginTop: 8 }}>
          {scoreLabel}
        </div>
        <div style={{ display: "flex", marginTop: 16 }}>
          <span style={{ fontSize: 150, fontWeight: 700, lineHeight: 1 }}>
            {bandLabel}
          </span>
        </div>
        <div style={{ fontSize: 34, color: "#a1a1aa", display: "flex", marginTop: 20 }}>
          {measured}
        </div>
        <div style={{ fontSize: 28, color: "#71717a", display: "flex", marginTop: 24 }}>
          Measured across real AI-tool usage · revealyst
        </div>
      </div>
    ),
    size,
  );
}
