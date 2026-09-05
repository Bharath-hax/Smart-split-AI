/**
 * Minimum-transaction settlement engine.
 *
 * Computes each member's net balance (paid - owed) across all bills, then
 * produces the fewest possible transfers using the classic greedy
 * "match largest debtor to largest creditor" algorithm
 * (minimum cash-flow graph settlement).
 */

export interface MemberBalance {
  userId: string;
  name: string;
  /** net > 0 => is owed money (creditor); net < 0 => owes money (debtor) */
  net: number;
}

export interface Transfer {
  fromId: string;
  fromName: string;
  toId: string;
  toName: string;
  amount: number;
}

export interface RawContribution {
  userId: string;
  name: string;
  /** amount the user actually paid for the bill */
  paid: number;
  /** amount the user owes for the bill (their share) */
  share: number;
}

const EPSILON = 0.01; // ignore sub-paisa dust

/**
 * Aggregate per-bill contributions into net balances per person.
 * net = sum(paid) - sum(share). A perfect settlement means every net ≈ 0.
 */
export function computeBalances(contributions: RawContribution[]): MemberBalance[] {
  const byUser = new Map<string, MemberBalance>();
  for (const c of contributions) {
    let entry = byUser.get(c.userId);
    if (!entry) {
      entry = { userId: c.userId, name: c.name, net: 0 };
      byUser.set(c.userId, entry);
    }
    entry.net += c.paid - c.share;
  }
  // Round to 2 decimals to kill float dust
  for (const b of byUser.values()) {
    b.net = Math.round(b.net * 100) / 100;
  }
  return Array.from(byUser.values());
}

/**
 * Greedy minimum-transaction settlement.
 *
 * Sort creditors and debtors by magnitude, then repeatedly settle the largest
 * debtor against the largest creditor. For n people this produces at most n-1
 * transfers (vs. up to O(n^2) naive pairwise refunds), and in practice far fewer.
 */
export function simplifyDebts(balances: MemberBalance[]): Transfer[] {
  const creditors = balances
    .filter((b) => b.net > EPSILON)
    .map((b) => ({ ...b, remaining: b.net }))
    .sort((a, b) => b.remaining - a.remaining);

  const debtors = balances
    .filter((b) => b.net < -EPSILON)
    .map((b) => ({ ...b, remaining: -b.net }))
    .sort((a, b) => b.remaining - a.remaining);

  const transfers: Transfer[] = [];
  let i = 0; // creditor pointer
  let j = 0; // debtor pointer

  while (i < creditors.length && j < debtors.length) {
    const amount = Math.min(creditors[i].remaining, debtors[j].remaining);
    if (amount > EPSILON) {
      transfers.push({
        fromId: debtors[j].userId,
        fromName: debtors[j].name,
        toId: creditors[i].userId,
        toName: creditors[i].name,
        amount: Math.round(amount * 100) / 100,
      });
    }
    creditors[i].remaining -= amount;
    debtors[j].remaining -= amount;
    if (creditors[i].remaining <= EPSILON) i++;
    if (debtors[j].remaining <= EPSILON) j++;
  }

  return transfers;
}

/**
 * Convenience: aggregate contributions AND simplify in one call.
 */
export function settleGroup(contributions: RawContribution[]): {
  balances: MemberBalance[];
  transfers: Transfer[];
} {
  const balances = computeBalances(contributions);
  const transfers = simplifyDebts(balances);
  return { balances, transfers };
}
