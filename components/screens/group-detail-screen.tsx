"use client";

import { motion } from "framer-motion";
import {
  Bell,
  CheckCircle2,
  Copy,
  ExternalLink,
  Loader2,
  MessageCircleHeart,
  Receipt,
  RefreshCw,
  Wand2,
  XCircle,
} from "lucide-react";
import * as React from "react";
import { ChatSheet } from "@/components/chat-sheet";
import { EmptyState, ErrorBanner } from "@/components/empty-state";
import { RecapCard } from "@/components/recap-card";
import { BalanceList, SettlementGraph } from "@/components/settlement-graph";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CATEGORY_EMOJI, CATEGORY_STYLES, type Category } from "@/lib/categorize";
import type { Forecast, MonthlyRecap } from "@/lib/insights";
import type { MemberBalance, Transfer } from "@/lib/settlement-algorithm";
import { cn, formatINR, formatINRShort } from "@/lib/utils";

interface GroupInfo {
  id: string;
  name: string;
  code: string;
}
interface BillItem {
  id: string;
  vendor: string;
  category: string;
  total: number;
  date: string;
  paidBy: string;
  anomalyPct: number | null;
  shares: Array<{ userId: string; name: string; paid: number; share: number }>;
}
interface Debt {
  id: string;
  amount: number;
  status: string;
  paymentUrl: string | null;
  lastReminderMessage: string | null;
  reminderSentAt: string | null;
  lastEmail?: {
    status: string;
    toEmail: string;
    error: string | null;
    sentAt: string;
  } | null;
  createdAt: string;
  settledAt: string | null;
  debtor: { id: string; name: string };
  creditor: { id: string; name: string };
}
interface SettlementData {
  balances: MemberBalance[];
  transfers: Transfer[];
  debts: Debt[];
  stats: { naiveCount: number; minimalCount: number };
  razorpayEnabled: boolean;
}

/**
 * Group detail — balances, the minimal settlement plan with before→after
 * graph, payment links, smart reminders, recap card, and the AI coach.
 */
export function GroupDetailScreen({
  group,
  members,
  bills,
}: {
  group: GroupInfo;
  members: Array<{ id: string; name: string }>;
  bills: BillItem[];
}) {
  const [settlement, setSettlement] = React.useState<SettlementData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [settling, setSettling] = React.useState(false);
  const [chatOpen, setChatOpen] = React.useState(false);
  const [recap, setRecap] = React.useState<MonthlyRecap | null>(null);
  const [insights, setInsights] = React.useState<string[]>([]);
  const [reminderFor, setReminderFor] = React.useState<string | null>(null);
  const [reminderMsg, setReminderMsg] = React.useState<string | null>(null);
  const [copiedCode, setCopiedCode] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      const res = await fetch(`/api/settlement?groupId=${group.id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not load settlement");
      setSettlement(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, [group.id]);

  // Initial load + 5s polling for live webhook updates
  React.useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  // Recap + AI insights (once)
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/insights?groupId=${group.id}`);
        const data = await res.json();
        if (!cancelled && res.ok) {
          setRecap(data.recap);
          setInsights(data.insights ?? []);
        }
      } catch {
        /* non-fatal */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [group.id]);

  async function settleUp(createLinks: boolean) {
    setSettling(true);
    setError(null);
    try {
      const res = await fetch("/api/settlement", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId: group.id, createLinks }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Settlement failed");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Settlement failed");
    } finally {
      setSettling(false);
    }
  }

  async function generateLinks() {
    setSettling(true);
    try {
      await fetch("/api/payment-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId: group.id, force: true }),
      });
      await load();
    } finally {
      setSettling(false);
    }
  }

  async function remind(debtId: string) {
    setReminderFor(debtId);
    setReminderMsg(null);
    try {
      const res = await fetch("/api/reminders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ debtId }),
      });
      const data = await res.json();
      if (res.ok) setReminderMsg(data.message);
    } catch {
      setReminderMsg("Could not generate a reminder right now.");
    }
  }

  function copyCode() {
    navigator.clipboard.writeText(group.code).catch(() => {});
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 1500);
  }

  return (
    <div className="space-y-5">
      {/* Header + share code */}
      <div>
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-extrabold tracking-tight">{group.name}</h1>
          <Button variant="outline" size="sm" onClick={() => setChatOpen(true)}>
            <MessageCircleHeart className="h-4 w-4 text-primary" /> Ask AI
          </Button>
        </div>
        <button
          onClick={copyCode}
          className="tap-highlight-none mt-1 flex items-center gap-1.5 text-xs text-muted-foreground"
        >
          Invite code:{" "}
          <span className="font-mono font-bold text-primary">{group.code}</span>
          {copiedCode ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-success" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </button>
      </div>

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : error ? (
        <ErrorBanner message={error} />
      ) : settlement ? (
        <SettlementBody
          group={group}
          settlement={settlement}
          bills={bills}
          recap={recap}
          insights={insights}
          settling={settling}
          onSettle={settleUp}
          onLinks={generateLinks}
          onRemind={remind}
          reminderFor={reminderFor}
          reminderMsg={reminderMsg}
          onRefresh={load}
        />
      ) : null}

      <ChatSheet open={chatOpen} onClose={() => setChatOpen(false)} groupId={group.id} />
    </div>
  );
}

/**
 * Main body of the group screen once settlement data has loaded.
 */
function SettlementBody({
  settlement,
  bills,
  recap,
  insights,
  settling,
  onSettle,
  onLinks,
  onRemind,
  reminderFor,
  reminderMsg,
  onRefresh,
}: {
  group: GroupInfo;
  settlement: SettlementData;
  bills: BillItem[];
  recap: MonthlyRecap | null;
  insights: string[];
  settling: boolean;
  onSettle: (createLinks: boolean) => void;
  onLinks: () => void;
  onRemind: (debtId: string) => void;
  reminderFor: string | null;
  reminderMsg: string | null;
  onRefresh: () => void;
}) {
  return (
    <>
      {recap && <RecapCard recap={recap} />}

      {/* Balances + settle-up only make sense once real bills exist; a fresh
          group with 0 bills should NOT claim "everyone is settled up". */}
      {bills.length > 0 && (
        <>
          <div className="rounded-2xl border bg-card p-4 shadow-sm">
            <h2 className="mb-3 font-bold">Net balances</h2>
            <BalanceList balances={settlement.balances} />
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-bold">Settle up</h2>
              <button
                onClick={onRefresh}
                className="tap-highlight-none flex items-center gap-1 text-xs text-muted-foreground"
              >
                <RefreshCw className="h-3.5 w-3.5" /> live · 5s
              </button>
            </div>
            <SettlementGraph
              balances={settlement.balances}
              transfers={settlement.transfers}
              naiveCount={settlement.stats.naiveCount}
            />
            {settlement.transfers.length > 0 && (
              <div className="flex gap-2">
                <Button className="flex-1" disabled={settling} onClick={() => onSettle(true)}>
                  {settling ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Wand2 className="h-4 w-4" />
                  )}
                  Settle up {settlement.razorpayEnabled ? "(Razorpay)" : "(demo links)"}
                </Button>
                {settlement.debts.some((d) => d.status === "pending" && !d.paymentUrl) && (
                  <Button variant="outline" disabled={settling} onClick={onLinks}>
                    <ExternalLink className="h-4 w-4" /> Get links
                  </Button>
                )}
              </div>
            )}
          </div>
        </>
      )}

      <DebtList
        debts={settlement.debts}
        onRemind={onRemind}
        reminderFor={reminderFor}
        reminderMsg={reminderMsg}
      />

      {insights.length > 0 && (
        <div className="rounded-2xl border bg-card p-4 shadow-sm">
          <h2 className="mb-2 flex items-center gap-2 font-bold">
            <MessageCircleHeart className="h-4 w-4 text-primary" /> AI insights
          </h2>
          <ul className="space-y-2">
            {insights.map((ins, i) => (
              <li key={i} className="text-sm leading-relaxed text-muted-foreground">
                ✦ {ins}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <h2 className="mb-2 font-bold">Bills ({bills.length})</h2>
        {bills.length === 0 ? (
          <div className="rounded-2xl border border-dashed">
            <EmptyState
              icon={Receipt}
              title="No bills yet"
              subtitle="Scan the first receipt and let the AI do the rest."
            />
          </div>
        ) : (
          <div className="space-y-2">
            {bills.map((b, i) => (
              <motion.div
                key={b.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i * 0.05, 0.4) }}
                className="rounded-2xl border bg-card p-4 shadow-sm"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary text-lg">
                      {CATEGORY_EMOJI[(b.category as Category) ?? "Other"]}
                    </div>
                    <div>
                      <p className="font-semibold leading-tight">{b.vendor}</p>
                      <p className="text-xs text-muted-foreground">
                        {b.paidBy} paid ·{" "}
                        {new Date(b.date).toLocaleDateString("en-IN")}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-bold">{formatINRShort(b.total)}</p>
                    <Badge className={CATEGORY_STYLES[(b.category as Category) ?? "Other"]}>
                      {b.category}
                    </Badge>
                  </div>
                </div>
                {b.anomalyPct != null && (
                  <div className="mt-2 rounded-lg bg-warning/10 px-3 py-1.5 text-xs font-medium text-warning">
                    ⚠️ Flagged {b.anomalyPct}% above the group&apos;s average
                  </div>
                )}
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

/**
 * Pending + settled debts with payment links and AI smart reminders
 * (tone varies with how overdue the debt is).
 */
function DebtList({
  debts,
  onRemind,
  reminderFor,
  reminderMsg,
}: {
  debts: Debt[];
  onRemind: (debtId: string) => void;
  reminderFor: string | null;
  reminderMsg: string | null;
}) {
  const [copied, setCopied] = React.useState(false);
  const [copiedAuto, setCopiedAuto] = React.useState<string | null>(null);

  async function copyReminder() {
    if (reminderMsg) {
      await navigator.clipboard.writeText(reminderMsg).catch(() => {});
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }

  async function copyAutoMessage(debtId: string, message: string) {
    await navigator.clipboard.writeText(message).catch(() => {});
    setCopiedAuto(debtId);
    setTimeout(() => setCopiedAuto(null), 1500);
  }

  if (debts.length === 0) return null;

  return (
    <div className="space-y-2">
      <h2 className="font-bold">Payment links</h2>
      {debts.map((d) => {
        const daysOld = Math.floor(
          (Date.now() - new Date(d.createdAt).getTime()) / 86400000
        );
        const paid = d.status === "paid";
        return (
          <div key={d.id} className="rounded-2xl border bg-card p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Avatar name={d.debtor.name} id={d.debtor.id} />
                <div>
                  <p className="text-sm font-semibold">
                    {d.debtor.name} → {d.creditor.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {paid
                      ? `settled ${d.settledAt ? new Date(d.settledAt).toLocaleDateString("en-IN") : ""}`
                      : `${daysOld === 0 ? "today" : `${daysOld}d old`}`}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-bold">{formatINR(d.amount)}</span>
                {paid ? (
                  <CheckCircle2 className="h-5 w-5 text-success" />
                ) : d.paymentUrl && !d.paymentUrl.startsWith("#") ? (
                  <a
                    href={d.paymentUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="tap-highlight-none"
                  >
                    <Button size="sm">Pay</Button>
                  </a>
                ) : (
                  <Badge className="bg-secondary text-secondary-foreground">demo link</Badge>
                )}
              </div>
            </div>

            {!paid && (
              <div className="mt-3">
                {reminderFor === d.id && reminderMsg ? (
                  <div className="rounded-xl bg-accent p-3 text-sm text-accent-foreground">
                    <p className="leading-relaxed">{reminderMsg}</p>
                    <button
                      onClick={copyReminder}
                      className="tap-highlight-none mt-2 flex items-center gap-1 text-xs font-semibold text-primary"
                    >
                      {copied ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                      {copied ? "Copied!" : "Copy message"}
                    </button>
                  </div>
                ) : d.lastEmail?.status === "sent" ? (
                  <div className="flex items-center gap-1.5 text-xs font-medium text-success">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Emailed {d.lastEmail.toEmail}
                    {d.settledAt ? "" : " — re-send below if needed"}
                  </div>
                ) : d.lastEmail?.status === "failed" ? (
                  <div className="rounded-xl bg-accent p-3 text-xs text-accent-foreground">
                    <p className="flex items-center gap-1.5 font-medium text-destructive">
                      <XCircle className="h-3.5 w-3.5" />
                      Failed to send reminder email
                    </p>
                    {d.lastEmail.error && (
                      <p className="mt-1 leading-relaxed text-muted-foreground">
                        {d.lastEmail.error}
                      </p>
                    )}
                  </div>
                ) : d.lastReminderMessage ? (
                  <div className="rounded-xl bg-accent p-3 text-sm text-accent-foreground">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Auto-reminder (Gmail not connected — copy to send)
                    </p>
                    <p className="mt-1 leading-relaxed">{d.lastReminderMessage}</p>
                    <button
                      onClick={() => copyAutoMessage(d.id, d.lastReminderMessage!)}
                      className="tap-highlight-none mt-2 flex items-center gap-1 text-xs font-semibold text-primary"
                    >
                      {copiedAuto === d.id ? (
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                      {copiedAuto === d.id ? "Copied!" : "Copy message"}
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => onRemind(d.id)}
                    disabled={reminderFor === d.id}
                    className="tap-highlight-none flex items-center gap-1 text-xs font-medium text-primary disabled:opacity-50"
                  >
                    {reminderFor === d.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Bell className="h-3.5 w-3.5" />
                    )}
                    Smart reminder{daysOld >= 5 ? " (firm)" : daysOld >= 2 ? " (nudge)" : " (gentle)"}
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
