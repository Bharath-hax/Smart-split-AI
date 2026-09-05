"use client";

import { Share2, Copy, Check } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { CATEGORY_EMOJI } from "@/lib/categorize";
import type { MonthlyRecap } from "@/lib/insights";
import { formatINR } from "@/lib/utils";

/**
 * Shareable monthly recap card ("You and your 3 roommates spent ₹42,000…").
 * Uses the Web Share API with copy-to-clipboard fallback.
 */
export function RecapCard({ recap }: { recap: MonthlyRecap }) {
  const [copied, setCopied] = React.useState(false);
  const [shared, setShared] = React.useState(false);

  async function share() {
    const text = `${recap.headline}\n\n${recap.billCount} ${recap.billCount === 1 ? "bill" : "bills"} • top spender: ${recap.topSpender}\n— SplitSettle AI`;
    try {
      if (navigator.share) {
        await navigator.share({ title: `${recap.monthLabel} recap`, text });
        setShared(true);
        setTimeout(() => setShared(false), 2000);
      } else {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      /* user cancelled */
    }
  }

  return (
    <div className="overflow-hidden rounded-3xl bg-gradient-to-br from-primary to-violet-900 p-5 text-white shadow-xl shadow-primary/30">
      <p className="text-xs font-medium uppercase tracking-wider text-white/70">
        {recap.monthLabel} recap
      </p>
      <p className="mt-2 text-xl font-bold leading-snug">{recap.headline}</p>

      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-white/10 py-2.5">
          <p className="text-lg font-bold">{formatINR(recap.totalSpent).replace(".00", "")}</p>
          <p className="text-[10px] text-white/70">spent</p>
        </div>
        <div className="rounded-xl bg-white/10 py-2.5">
          <p className="text-lg font-bold">{recap.billCount}</p>
          <p className="text-[10px] text-white/70">bills</p>
        </div>
        <div className="rounded-xl bg-white/10 py-2.5">
          <p className="text-lg font-bold">
            {CATEGORY_EMOJI[recap.topCategory]}
          </p>
          <p className="text-[10px] text-white/70">{recap.topCategory.toLowerCase()}</p>
        </div>
      </div>

      {recap.perPerson.length > 0 && (
        <div className="mt-4 space-y-1.5 text-sm">
          {recap.perPerson.map((p) => (
            <div key={p.name} className="flex justify-between text-white/85">
              <span>{p.name}</span>
              <span className="font-medium">paid {formatINR(p.paid).replace(".00", "")}</span>
            </div>
          ))}
        </div>
      )}

      <Button
        variant="secondary"
        size="sm"
        onClick={share}
        className="mt-4 w-full bg-white/15 text-white hover:bg-white/25"
      >
        {shared ? (
          <Check className="h-4 w-4" />
        ) : copied ? (
          <Check className="h-4 w-4" />
        ) : (
          <Share2 className="h-4 w-4" />
        )}
        {shared ? "Shared!" : copied ? "Copied!" : "Share recap"}
        {!shared && !copied && <Copy className="hidden" />}
      </Button>
    </div>
  );
}
