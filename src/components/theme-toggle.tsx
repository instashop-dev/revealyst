"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { Monitor, Moon, Sun } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

// U0.8 theme switcher: a compact three-state (System / Light / Dark) segmented
// control for the sidebar footer. Keyboard accessible (real toggle buttons),
// text + icon so state is never conveyed by colour alone, and each segment
// reaches the ≥44px minimum touch target via the toggle's default padding.
//
// next-themes persists the choice (localStorage) and re-applies the root `.dark`
// class; sonner already reads the same context, so toasts follow the theme.

const OPTIONS = [
  { value: "system", label: "System", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
] as const;

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);

  // next-themes only knows the persisted/system value on the client. Render an
  // inert placeholder of the same footprint on the server / first paint to
  // avoid a hydration mismatch on the pressed state, then swap in the live
  // control once mounted.
  React.useEffect(() => {
    setMounted(true);
  }, []);

  const active = mounted ? (theme ?? "system") : "system";

  return (
    <ToggleGroup
      value={[active]}
      onValueChange={(value) => {
        const next = value[0];
        // Ignore the empty array a re-click of the active segment produces —
        // one theme is always selected.
        if (next === "system" || next === "light" || next === "dark") {
          setTheme(next);
        }
      }}
      variant="outline"
      size="sm"
      spacing={0}
      aria-label="Colour theme"
      className="w-full"
    >
      {OPTIONS.map((opt) => (
        <ToggleGroupItem
          key={opt.value}
          value={opt.value}
          aria-label={opt.label}
          disabled={!mounted}
          className="min-h-11 flex-1 gap-1.5 text-xs"
        >
          <opt.icon className="size-4" />
          <span>{opt.label}</span>
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
