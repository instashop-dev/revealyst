import { ImageResponse } from "next/og";

// Social-preview image for the marketing landing page. Text-only with the
// default font — no external assets/fonts — to stay portable on the Workers
// runtime (same constraints as /s/[token]/opengraph-image.tsx). Next
// auto-wires this to og:image / twitter:image for /.
export const alt =
  "Revealyst — see who's actually adopting AI, and how well";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function LandingImage() {
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
          padding: 80,
        }}
      >
        <div
          style={{
            fontSize: 30,
            letterSpacing: 6,
            color: "#71717a",
            display: "flex",
            textTransform: "uppercase",
          }}
        >
          Revealyst
        </div>
        <div
          style={{
            fontSize: 72,
            fontWeight: 700,
            lineHeight: 1.15,
            textAlign: "center",
            marginTop: 28,
            display: "flex",
          }}
        >
          See who&apos;s actually adopting AI — and how well — across all your
          AI tools.
        </div>
        <div
          style={{
            fontSize: 30,
            color: "#a1a1aa",
            marginTop: 36,
            display: "flex",
          }}
        >
          Adoption · Fluency · Efficiency — measured, not self-reported
        </div>
      </div>
    ),
    size,
  );
}
