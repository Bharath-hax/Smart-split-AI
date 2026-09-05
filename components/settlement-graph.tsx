"use client";

import { motion } from "framer-motion";
import { ArrowRight, Minus } from "lucide-react";
import { formatINRShort } from "@/lib/utils";
import type { Transfer, MemberBalance } from "@/lib/settlement-algorithm";

/**
 * The "before → after" settlement visual: shows the O(n²) naive pairwise
 * debt count collapsing into the minimal transaction plan.
 */
export function SettlementGraph({
  balances,
  transfers,
  naiveCount,
}: {
  balances: MemberBalance[];
  transfers: Transfer[];
  naiveCount: number;
}) {
  const totalDebt = transfers.reduce((a, t) => a + t.amount, 0);

  if (transfers.length === 0) {
    return (
      <div className="rounded-2xl bg-success/10 p-5 text-center text-sm font-medium text-success">
        🎉 Everyone is settled up — zero payments needed!
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-center gap-3 rounded-2xl bg-accent p-3 text-xs font-medium text-accent-foreground">
        <span>{naiveCount} possible payments</span>
        <ArrowRight className="h-4 w-4" />
        <span className="rounded-full bg-primary px-2 py-0.5 font-bold text-primary-foreground">
          only {transfers.length} needed
        </span>
      </div>

      <div className="space-y-2">
        {transfers.map((t, i) => (
          <motion.div
            key={`${t.fromId}-${t.toId}-${i}`}
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.08 }}
            className="flex items-center gap-2 rounded-xl border bg-card p-3"
          >
            <span className="truncate text-sm font-semibold">{t.fromName}</span>
            <div className="mx-1 flex flex-1 items-center">
              <div className="h-px flex-1 border-t border-dashed border-muted-foreground/40" />
              <ArrowRight className="mx-1 h-4 w-4 shrink-0 text-primary" />
              <div className="h-px flex-1 border-t border-dashed border-muted-foreground/40" />
            </div>
            <span className="truncate text-sm font-semibold">{t.toName}</span>
            <span className="ml-1 rounded-lg bg-primary/10 px-2 py-1 text-sm font-bold text-primary">
              {formatINRShort(t.amount)}
            </span>
          </motion.div>
        ))}
      </div>

      <p className="text-center text-xs text-muted-foreground">
        Total flow: {formatINRShort(totalDebt)} — minimal cash-flow settlement
      </p>
    </div>
  );
}

/**
 * Compact per-person net balance list (owes / gets back).
 */
export function BalanceList({ balances }: { balances: MemberBalance[] }) {
  if (balances.length === 0) return null;
  return (
    <div className="space-y-1.5">
      {balances.map((b) => (
        <div key={b.userId} className="flex items-center justify-between text-sm">
          <span className="font-medium">{b.name}</span>
          {Math.abs(b.net) < 0.01 ? (
            <span className="text-muted-foreground flex items-center gap-1">
              <Minus className="h-3.5 w-3.5" /> even
            </span>
          ) : b.net > 0 ? (
            <span className="font-semibold text-success">
              gets {formatINRShort(b.net)}
            </span>
          ) : (
            <span className="font-semibold text-destructive">
              owes {formatINRShort(-b.net)}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
