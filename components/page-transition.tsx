"use client";

import { motion } from "framer-motion";
import { Download, Smartphone } from "lucide-react";
import { usePathname } from "next/navigation";
import * as React from "react";

/**
 * Wraps tab screens in the mobile width container with a header
 * (featuring the "Get App" APK download button) and smooth enter
 * transitions on route change.
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[430px] flex-col">
      {/* Header with Get App button */}
      <header className="sticky top-0 z-30 flex items-center justify-between bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Smartphone className="h-4 w-4" />
          </div>
          <span className="text-sm font-bold tracking-tight">SplitSettle</span>
        </div>
        <a
          href="/downloads/smartsplit.apk"
          download
          className="tap-highlight-none flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/20"
          aria-label="Get App — download APK"
        >
          <Download className="h-3.5 w-3.5" />
          Get App
        </a>
      </header>

      <motion.main
        key={pathname}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22, ease: "easeOut" }}
        className="flex-1 px-4 pt-1 safe-bottom"
      >
        {children}
      </motion.main>
    </div>
  );
}
