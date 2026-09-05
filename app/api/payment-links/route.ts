import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authGuard, isMember, jsonError } from "@/lib/api";
import { createPaymentLink } from "@/lib/razorpay";

/**
 * POST /api/payment-links — (re)generate Razorpay payment links for all
 * pending debts in a group. Idempotent: debts that already have a link are
 * skipped unless ?force=1.
 */
export async function POST(req: NextRequest) {
  const auth = await authGuard();
  if ("response" in auth) return auth.response;
  try {
    const { groupId, force } = await req.json();
    if (!groupId) return jsonError("groupId is required");
    if (!(await isMember(auth.user.id, groupId))) return jsonError("Not a member", 403);

    const group = await prisma.group.findUnique({
      where: { id: groupId },
      include: {
        members: { include: { user: { select: { id: true, name: true, phone: true } } } },
        debts: { where: { status: "pending" } },
      },
    });
    if (!group) return jsonError("Group not found", 404);

    const memberById = new Map(group.members.map((m) => [m.user.id, m.user]));
    const results: Array<{ debtId: string; url: string | null; mock: boolean }> = [];
    const errors: string[] = [];

    for (const debt of group.debts) {
      if (debt.paymentLinkId && !force) {
        results.push({ debtId: debt.id, url: debt.paymentUrl, mock: false });
        continue;
      }
      try {
        const debtor = memberById.get(debt.debtorId);
        const creditor = memberById.get(debt.creditorId);
        const link = await createPaymentLink({
          amount: debt.amount,
          debtorName: debtor?.name ?? "Friend",
          debtorContact: debtor?.phone,
          groupName: group.name,
          description: `${group.name}: settle ₹${debt.amount.toFixed(2)} to ${
            creditor?.name ?? "a friend"
          }`,
        });
        await prisma.debt.update({
          where: { id: debt.id },
          data: { paymentLinkId: link.id, paymentUrl: link.url },
        });
        results.push({ debtId: debt.id, url: link.url, mock: link.mock });
      } catch (e) {
        errors.push(
          `Debt ${debt.id}: ${e instanceof Error ? e.message : "unknown error"}`
        );
      }
    }

    return NextResponse.json({ results, errors });
  } catch (e) {
    return jsonError(
      `Payment link generation failed: ${e instanceof Error ? e.message : "unknown"}`,
      500
    );
  }
}
