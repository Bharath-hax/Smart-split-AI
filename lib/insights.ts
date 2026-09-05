/**
 * Group analytics: anomaly detection, monthly recap, fair-split forecast,
 * and grounding-context serialization for the AI features.
 * All numbers here are computed deterministically from the DB — the LLM
 * only narrates them, it never invents them.
 */
import { CATEGORY_EMOJI, type Category } from "@/lib/categorize";

export interface GroupBillData {
  id: string;
  vendor: string;
  category: string;
  total: number;
  billDate: Date;
  uploader: { name: string };
  shares: Array<{ user: { name: string }; paid: number; share: number }>;
}

export interface GroupContext {
  groupName: string;
  members: Array<{ id: string; name: string }>;
  bills: Array<{
    vendor: string;
    category: string;
    total: number;
    date: string;
    paidBy: string;
    shares: Array<{ who: string; share: number }>;
  }>;
  netBalances: Array<{ who: string; net: number }>;
  openDebts: Array<{ from: string; to: string; amount: number; daysOld: number }>;
}

/**
 * Anomaly detection: compare a bill total against the group's rolling
 * average of previous bills. Returns the % above average (0 if normal).
 */
export function computeAnomalyPct(total: number, previousTotals: number[]): number {
  if (previousTotals.length === 0 || total <= 0) return 0;
  const avg = previousTotals.reduce((a, b) => a + b, 0) / previousTotals.length;
  if (avg <= 0) return 0;
  const pct = Math.round(((total - avg) / avg) * 100);
  return pct > 10 ? pct : 0; // only flag meaningfully-high bills
}

/**
 * Build the serialized JSON context string handed to Gemini/GPT.
 * Compact on purpose — fewer tokens, faster responses.
 */
export function buildGroupContext(ctx: GroupContext): string {
  return JSON.stringify({
    group: ctx.groupName,
    members: ctx.members.map((m) => m.name),
    bills: ctx.bills.map((b) => ({
      vendor: b.vendor,
      category: b.category,
      total: Math.round(b.total * 100) / 100,
      date: b.date,
      paidBy: b.paidBy,
      shares: b.shares.map((s) => `${s.who}:₹${Math.round(s.share * 100) / 100}`),
    })),
    net_balances: ctx.netBalances.map(
      (b) => `${b.who}:${b.net >= 0 ? "+" : ""}₹${Math.round(b.net * 100) / 100}`
    ),
    open_debts: ctx.openDebts.map(
      (d) => `${d.from} owes ${d.to} ₹${Math.round(d.amount * 100) / 100} (${d.daysOld}d old)`
    ),
  });
}

export interface MonthlyRecap {
  monthLabel: string;
  totalSpent: number;
  billCount: number;
  topCategory: Category;
  topSpender: string;
  memberCount: number;
  perPerson: Array<{ name: string; paid: number; share: number }>;
  headline: string;
}

/**
 * Deterministic monthly recap for the shareable card.
 */
export function buildMonthlyRecap(
  groupName: string,
  members: Array<{ id: string; name: string }>,
  bills: GroupBillData[],
  now: Date = new Date()
): MonthlyRecap {
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthBills = bills.filter((b) => new Date(b.billDate) >= monthStart);

  const totals = new Map<string, number>(); // category -> total
  const paidBy = new Map<string, number>();
  const shareBy = new Map<string, number>();
  let totalSpent = 0;

  for (const b of monthBills) {
    totalSpent += b.total;
    totals.set(b.category, (totals.get(b.category) ?? 0) + b.total);
    for (const s of b.shares) {
      paidBy.set(s.user.name, (paidBy.get(s.user.name) ?? 0) + s.paid);
      shareBy.set(s.user.name, (shareBy.get(s.user.name) ?? 0) + s.share);
    }
  }

  const topCategory =
    ([...totals.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] as Category) ?? "Other";
  const topSpender =
    [...paidBy.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "nobody";

  const monthLabel = now.toLocaleString("en-IN", { month: "long", year: "numeric" });
  const headline =
    monthBills.length === 0
      ? `No expenses in ${groupName} yet this month — scan the first bill!`
      : `You and your ${Math.max(members.length - 1, 0)} ${
          members.length - 1 === 1 ? "friend" : "friends"
        } spent ₹${Math.round(totalSpent).toLocaleString("en-IN")} this month, mostly on ${
          CATEGORY_EMOJI[topCategory]
        } ${topCategory.toLowerCase()}`;

  return {
    monthLabel,
    totalSpent: Math.round(totalSpent * 100) / 100,
    billCount: monthBills.length,
    topCategory,
    topSpender,
    memberCount: members.length,
    perPerson: members.map((m) => ({
      name: m.name,
      paid: Math.round((paidBy.get(m.name) ?? 0) * 100) / 100,
      share: Math.round((shareBy.get(m.name) ?? 0) * 100) / 100,
    })),
    headline,
  };
}

export interface Forecast {
  userId: string;
  name: string;
  /** projected owed-share by month end (₹) */
  projectedOwe: number;
  /** what they've already been billed this month (₹) */
  owedSoFar: number;
  /** daily average billed over the trailing 30 days (₹) */
  dailyRate: number;
  trend: "rising" | "steady" | "falling";
}

/**
 * Fair-split forecast: linear trend on the trailing 30 days of billed shares,
 * projected to month end. Simple, transparent, forward-looking.
 */
export function buildForecasts(
  members: Array<{ id: string; name: string }>,
  bills: GroupBillData[],
  now: Date = new Date()
): Forecast[] {
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
  const fifteenDaysAgo = new Date(now.getTime() - 15 * 24 * 3600 * 1000);
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysLeft = Math.max(daysInMonth - now.getDate(), 0);

  return members.map((m) => {
    let owedThisMonth = 0;
    let recent = 0; // last 15 days
    let previous = 0; // days 15-30 ago
    for (const b of bills) {
      const d = new Date(b.billDate);
      const userShare = b.shares.find((s) => s.user.name === m.name)?.share ?? 0;
      if (d >= monthStart) owedThisMonth += userShare;
      if (d >= fifteenDaysAgo) recent += userShare;
      else if (d >= thirtyDaysAgo) previous += userShare;
    }
    const dailyRate = Math.round(((recent + previous) / 30) * 100) / 100;
    const projectedOwe =
      Math.round((owedThisMonth + dailyRate * daysLeft) * 100) / 100;
    const trend: Forecast["trend"] =
      recent > previous * 1.2
        ? "rising"
        : recent < previous * 0.8
          ? "falling"
          : "steady";
    return {
      userId: m.id,
      name: m.name,
      projectedOwe,
      owedSoFar: Math.round(owedThisMonth * 100) / 100,
      dailyRate,
      trend,
    };
  });
}
