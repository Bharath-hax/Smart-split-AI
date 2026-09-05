import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authGuard, isMember, jsonError } from "@/lib/api";
import { answerGroupQuestion } from "@/lib/gemini";
import { buildGroupContext, type GroupContext } from "@/lib/insights";
import { settleGroup } from "@/lib/settlement-algorithm";

/**
 * POST /api/chat — AI Spending Coach.
 * Loads the group's real bills/balances/debts from the DB, serializes them as
 * compact grounding context, and asks Gemini (or GPT-4o-mini) to answer the
 * user's question using ONLY those numbers.
 */
export async function POST(req: NextRequest) {
  const auth = await authGuard();
  if ("response" in auth) return auth.response;
  try {
    const { groupId, question } = await req.json();
    if (!groupId || !question?.trim()) {
      return jsonError("groupId and question are required");
    }
    if (!(await isMember(auth.user.id, groupId))) return jsonError("Not a member", 403);

    const group = await prisma.group.findUnique({
      where: { id: groupId },
      include: {
        members: { include: { user: { select: { id: true, name: true } } } },
        bills: {
          include: {
            uploader: { select: { name: true } },
            shares: { include: { user: { select: { name: true } } } },
          },
          orderBy: { billDate: "desc" },
          take: 60,
        },
        debts: {
          where: { status: "pending" },
          include: {
            debtor: { select: { name: true } },
            creditor: { select: { name: true } },
          },
        },
      },
    });
    if (!group) return jsonError("Group not found", 404);

    const shares = await prisma.billShare.findMany({
      where: { bill: { groupId } },
      include: { user: { select: { id: true, name: true } } },
    });
    const { balances } = settleGroup(
      shares.map((s) => ({
        userId: s.user.id,
        name: s.user.name,
        paid: s.paid,
        share: s.share,
      }))
    );

    const ctx: GroupContext = {
      groupName: group.name,
      members: group.members.map((m) => ({ id: m.user.id, name: m.user.name })),
      bills: group.bills.map((b) => ({
        vendor: b.vendor,
        category: b.category,
        total: b.total,
        date: b.billDate.toISOString().slice(0, 10),
        paidBy: b.uploader.name,
        shares: b.shares.map((s) => ({ who: s.user.name, share: s.share })),
      })),
      netBalances: balances.map((b) => ({ who: b.name, net: b.net })),
      openDebts: group.debts.map((d) => ({
        from: d.debtor.name,
        to: d.creditor.name,
        amount: d.amount,
        daysOld: Math.floor((Date.now() - d.createdAt.getTime()) / 86400000),
      })),
    };

    const result = await answerGroupQuestion(question.trim(), buildGroupContext(ctx));
    if (!result.ok || !result.data) {
      return jsonError(result.error || "The coach is unavailable right now", 502);
    }
    return NextResponse.json({ answer: result.data });
  } catch (e) {
    return jsonError(
      `Chat failed: ${e instanceof Error ? e.message : "unknown"}`,
      500
    );
  }
}
