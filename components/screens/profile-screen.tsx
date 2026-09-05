"use client";

import { LogOut, Moon, ScanLine, Sun, Wallet } from "lucide-react";
import { useTheme } from "next-themes";
import { useRouter } from "next/navigation";
import * as React from "react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";

/**
 * Profile tab: identity card, quick stats, theme toggle, logout.
 */
export function ProfileScreen({
  name,
  phone,
  groupCount,
  billCount,
}: {
  name: string;
  phone: string;
  groupCount: number;
  billCount: number;
}) {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  async function logout() {
    await fetch("/api/session", { method: "DELETE" });
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-extrabold tracking-tight">Profile</h1>

      {/* Identity card */}
      <div className="flex items-center gap-4 rounded-2xl border bg-card p-4 shadow-sm">
        <Avatar name={name || "You"} id={phone} className="h-14 w-14 text-lg" />
        <div>
          <p className="font-bold">{name}</p>
          <p className="text-sm text-muted-foreground">{phone}</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl border bg-card p-4 text-center shadow-sm">
          <p className="text-2xl font-extrabold text-primary">{groupCount}</p>
          <p className="text-xs text-muted-foreground">groups</p>
        </div>
        <div className="rounded-2xl border bg-card p-4 text-center shadow-sm">
          <p className="text-2xl font-extrabold text-primary">{billCount}</p>
          <p className="text-xs text-muted-foreground">bills split</p>
        </div>
      </div>

      {/* Settings */}
      <div className="divide-y rounded-2xl border bg-card shadow-sm">
        <button
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          className="tap-highlight-none flex w-full items-center gap-3 p-4 text-sm font-medium"
        >
          {mounted && theme === "dark" ? (
            <Sun className="h-5 w-5 text-primary" />
          ) : (
            <Moon className="h-5 w-5 text-primary" />
          )}
          {mounted && theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        </button>
        <a
          href="/manifest.json"
          target="_blank"
          className="tap-highlight-none flex w-full items-center gap-3 p-4 text-sm font-medium"
        >
          <ScanLine className="h-5 w-5 text-primary" />
          Install app (Add to Home Screen)
        </a>
        <div className="flex items-center gap-3 p-4 text-sm text-muted-foreground">
          <Wallet className="h-5 w-5" />
          Payments run in Razorpay test mode — no real money moves.
        </div>
      </div>

      <Button variant="outline" className="w-full" onClick={logout}>
        <LogOut className="h-4 w-4" /> Log out
      </Button>

      <p className="text-center text-xs text-muted-foreground">
        SplitSettle AI · minimal-transaction settlement engine
      </p>
    </div>
  );
}
