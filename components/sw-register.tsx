"use client";

import { useEffect } from "react";

/**
 * Registers the PWA service worker (public/sw.js) for offline shell +
 * installability. No-ops in dev/unsupported browsers.
 */
export function SWRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* non-fatal */
    });
  }, []);
  return null;
}
