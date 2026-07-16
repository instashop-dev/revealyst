"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

// Thin wrapper so the root layout (a server component) can mount next-themes'
// client provider (U0.8). Dark tokens already exist; sonner reads the theme via
// `useTheme`. `attribute="class"` toggles a root `.dark` class — the supported
// path for Tailwind v4 `@theme inline` tokens (a ROOT class swap, not a
// section-scoped `.dark`, which is the case the CLAUDE.md note warns about).
export function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
