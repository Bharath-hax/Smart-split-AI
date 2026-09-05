"use client";

import { motion } from "framer-motion";
import { usePathname } from "next/navigation";
import * as React from "react";

/**
 * Wraps tab screens in the mobile width container with smooth
 * enter transitions on route change.
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <motion.main
      key={pathname}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: "easeOut" }}
      className="mx-auto min-h-dvh w-full max-w-[430px] px-4 pt-4 safe-bottom"
    >
      {children}
    </motion.main>
  );
}
