"use client";

import { CheckCircle2, LogOut, Mail, MailWarning, Moon, Sun, Wallet } from "lucide-react";
import { useTheme } from "next-themes";
import { useRouter } from "next/navigation";
import * as React from "react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";

/**
 * Profile tab: identity card, quick stats, Gmail connection (for automatic
 * payment reminder emails), theme toggle, logout.
 */
export function ProfileScreen({
  name,
  phone,
  groupCount,
  billCount,
  gmailConnected,
  gmailEmail,
  googleConfigured,
  gmailStatus,
}: {
  name: string;
  phone: string;
  groupCount: number;
  billCount: number;
  gmailConnected: boolean;
  gmailEmail: string | null;
  googleConfigured: boolean;
  gmailStatus: string | null;
}) {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  const [disconnecting, setDisconnecting] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  async function logout() {
    await fetch("/api/session", { method: "DELETE" });
    router.push("/login");
    router.refresh();
  }

  async function disconnectGmail() {
    setDisconnecting(true);
    try {
      await fetch("/api/google/disconnect", { method: "POST" });
      router.refresh();
    } finally {
      setDisconnecting(false);
    }
  }

  const gmailNotice =
    gmailStatus === "connected"
      ? "Gmail connected — automatic payment reminder emails are on."
      : gmailStatus === "no-send-scope"
        ? "Gmail connected but without send permission — reconnect to enable reminders."
        : gmailStatus === "denied"
          ? "Gmail permission was declined — reminders will be in-app only."
          : gmailStatus === "not-configured"
            ? "Google OAuth isn't configured on the server (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)."
            : gmailStatus === "error"
              ? "Couldn't connect Gmail — please try again."
              : null;

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

      {/* Gmail connection — powers automatic payment reminder emails */}
      <div className="rounded-2xl border bg-card p-4 shadow-sm">
        <div className="flex items-center gap-3">
          {gmailConnected ? (
            <CheckCircle2 className="h-5 w-5 text-success" />
          ) : (
            <MailWarning className="h-5 w-5 text-muted-foreground" />
          )}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Gmail for reminders</p>
            <p className="truncate text-xs text-muted-foreground">
              {gmailConnected
                ? `Connected as ${gmailEmail}`
                : googleConfigured
                  ? "Connect to send automatic payment reminder emails"
                  : "Server-side Google OAuth not configured"}
            </p>
          </div>
        </div>
        {gmailNotice && (
          <p className="mt-2 rounded-lg bg-accent p-2 text-xs text-accent-foreground">
            {gmailNotice}
          </p>
        )}
        {googleConfigured &&
          (gmailConnected ? (
            <Button
              variant="outline"
              size="sm"
              className="mt-3 w-full"
              onClick={disconnectGmail}
              disabled={disconnecting}
            >
              {disconnecting ? "Disconnecting…" : "Disconnect Gmail"}
            </Button>
          ) : (
            <a href="/api/google/connect" className="tap-highlight-none mt-3 block">
              <Button size="sm" className="w-full">
                <Mail className="h-4 w-4" /> Connect Gmail
              </Button>
            </a>
          ))}
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
