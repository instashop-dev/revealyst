import { ImageResponse } from "next/og";
import { getApiContext } from "@/lib/api-context";
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

  const label = card?.publicLabel ?? "Revealyst";
  const scoreLabel = card?.scoreLabel ?? "AI Fluency";
  const value = card && card.value !== null ? String(card.value) : "—";

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
        <div style={{ fontSize: 52, color: "#a1a1aa", display: "flex", marginTop: 8 }}>
          {scoreLabel}
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", marginTop: 12 }}>
          <span style={{ fontSize: 220, fontWeight: 700, lineHeight: 1 }}>
            {value}
          </span>
          <span style={{ fontSize: 56, color: "#a1a1aa", paddingBottom: 32 }}>
            /100
          </span>
        </div>
        <div style={{ fontSize: 28, color: "#71717a", display: "flex", marginTop: 24 }}>
          Measured across real AI-tool usage · revealyst
        </div>
      </div>
    ),
    size,
  );
}
