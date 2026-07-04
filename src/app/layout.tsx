import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Revealyst",
  description:
    "See who's actually adopting AI — and how well — across all your AI tools.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
