"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * Lightweight top progress bar for menu/page navigations.
 * Does not replace page content (avoids blank-sheet loading.tsx flashes).
 */
export function NavigationProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [active, setActive] = useState(false);
  const [visible, setVisible] = useState(false);
  const hideTimer = useRef<number | null>(null);
  const routeKey = `${pathname}?${searchParams?.toString() ?? ""}`;

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a");
      if (!anchor) return;
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;
      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return;
      try {
        const url = new URL(href, window.location.href);
        if (url.origin !== window.location.origin) return;
        if (`${url.pathname}${url.search}` === `${window.location.pathname}${window.location.search}`) return;
      } catch {
        return;
      }
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
      setVisible(true);
      setActive(true);
    };

    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  useEffect(() => {
    if (!visible) return;
    setActive(false);
    hideTimer.current = window.setTimeout(() => {
      setVisible(false);
      hideTimer.current = null;
    }, 280);
    return () => {
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
    };
  }, [routeKey, visible]);

  if (!visible) return null;

  return (
    <div
      aria-hidden="true"
      className={`nav-progress${active ? " is-active" : " is-done"}`}
    />
  );
}
