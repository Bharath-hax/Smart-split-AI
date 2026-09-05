"use client";

import { motion } from "framer-motion";
import { Activity, Home, ScanLine, User, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/home", label: "Home", icon: Home },
  { href: "/groups", label: "Groups", icon: Users },
  { href: "/scan", label: "Scan", icon: ScanLine, center: true },
  { href: "/activity", label: "Activity", icon: Activity },
  { href: "/profile", label: "Profile", icon: User },
];

/**
 * Instagram/PhonePe-style bottom tab bar with a raised center Scan button.
 */
export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="mx-auto flex max-w-[430px] items-stretch justify-around px-2 pb-[env(safe-area-inset-bottom,0px)]">
        {TABS.map((tab) => {
          const active = pathname.startsWith(tab.href);
          const Icon = tab.icon;

          if (tab.center) {
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className="tap-highlight-none relative -top-4 flex flex-col items-center"
                aria-label="Scan a bill"
              >
                <motion.div
                  whileTap={{ scale: 0.9 }}
                  className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-xl shadow-primary/40"
                >
                  <Icon className="h-7 w-7" />
                </motion.div>
                <span className="mt-0.5 text-[10px] font-medium text-muted-foreground">
                  {tab.label}
                </span>
              </Link>
            );
          }

          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                "tap-highlight-none flex flex-1 flex-col items-center gap-0.5 py-2.5",
                active ? "text-primary" : "text-muted-foreground"
              )}
            >
              <Icon className={cn("h-5 w-5", active && "stroke-[2.5]")} />
              <span className="text-[10px] font-medium">{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
