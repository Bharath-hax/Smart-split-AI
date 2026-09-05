import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authGuard, isMember, jsonError } from "@/lib/api";
import { generateInsights } from "@/lib/gemini";
import {
  buildGroupContext,
  buildMonthlyRecap,
  buildForecasts,
  type GroupContext,
} from "@/lib/insights";
import { settleGroup } from "@/lib/settlement-algorithm";

/**
 * GET /api/insights?groupId=... — everything analytical for a group, in one call:
 * deterministic monthly recap + fair-split forecasts + AI insights (with
 * graceful template fallback when no AI key is set).
 */
export async function GET(req: NextRequest) {
  const auth = await authGuard();
  if ("response" in auth) return auth.response;
  const groupId = req.nextUrl.searchParams.get("groupId");
  if (!groupId) return jsonError("groupId is required");
  if (!(await isMember(auth.user.id, groupId))) return jsonError("Not a member", 403);

  try {
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
          take: 120,
        },
      },
    });
    if (!group) return jsonError("Group not found", 404);

    const members = group.members.map((m) => ({ id: m.user.id, name: m.user.name }));
    const recap = buildMonthlyRecap(group.name, members, group.bills);
    const forecasts = buildForecasts(members, group.bills);

    // Grounding context for the AI insights
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
    const pendingDebts = await prisma.debt.findMany({
      where: { groupId, status: "pending" },
      include: {
        debtor: { select: { name: true } },
        creditor: { select: { name: true } },
      },
    });
    const ctx: GroupContext = {
      groupName: group.name,
      members,
      bills: group.bills.map((b) => ({
        vendor: b.vendor,
        category: b.category,
        total: b.total,
        date: b.billDate.toISOString().slice(0, 10),
        paidBy: b.uploader.name,
        shares: b.shares.map((s) => ({ who: s.user.name, share: s.share })),
      })),
      netBalances: balances.map((b) => ({ who: b.name, net: b.net })),
      openDebts: pendingDebts.map((d) => ({
        from: d.debtor.name,
        to: d.creditor.name,
        amount: d.amount,
        daysOld: Math.floor((Date.now() - d.createdAt.getTime()) / 86400000),
      })),
    };

    const ai = await generateInsights(buildGroupContext(ctx));

    return NextResponse.json({
      recap,
      forecasts,
      insights: ai.data ?? [],
      aiEngine: ai.error ? "fallback" : "ai",
    });
  } catch (e) {
    return jsonError(
      `Insights failed: ${e instanceof Error ? e.message : "unknown"}`,
      500
    );
  }
}
