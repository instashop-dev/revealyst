"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

/**
 * U5 a11y — client-side navigation in the app shell (a sidebar link click)
 * swaps the page content but leaves keyboard focus stranded on the clicked
 * link, so screen-reader users get no announcement of the new page. This tiny
 * listener moves focus to the `#main-content` landmark (the same target the
 * skip link already points at, now `tabIndex={-1}` so it can receive
 * programmatic focus) whenever the pathname changes.
 *
 * It deliberately skips the FIRST render: on a fresh load / hard nav the
 * browser's own focus (and the skip link) should stand, and stealing focus to
 * <main> on initial paint would be jarring. Programmatic `.focus()` does not
 * trigger `:focus-visible`, so no focus ring flashes — the move is announced,
 * not decorated (the inset carries `outline-none` as a belt-and-braces guard).
 *
 * Renders nothing; it is a behavior-only leaf mounted once in the (app) layout.
 */
export function RouteFocusManager() {
  const pathname = usePathname();
  const isFirst = useRef(true);

  useEffect(() => {
    if (isFirst.current) {
      isFirst.current = false;
      return;
    }
    const main = document.getElementById("main-content");
    // Guard: never yank focus out of an open dialog/sheet (its own focus trap
    // owns focus during a navigation it triggered) — only move it when focus is
    // on the body/a stale link, the stranded-focus case this fixes.
    const active = document.activeElement;
    // Any open overlay that legitimately owns focus — Base UI renders
    // role="dialog" on Dialog/Sheet/Popover popups, "alertdialog" on
    // AlertDialog, "menu"/"listbox" on Menu/Select. Keep this list in sync
    // with the overlay roles actually in the tree (U5 review finding: a
    // dialog-only selector under-delivered the comment's claim).
    if (
      active &&
      active.closest(
        "[role='dialog'],[role='alertdialog'],[role='menu'],[role='listbox']",
      )
    ) {
      return;
    }
    main?.focus();
  }, [pathname]);

  return null;
}
