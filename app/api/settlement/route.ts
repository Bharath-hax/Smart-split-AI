import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authGuard, isMember, jsonError } from "@/lib/api";
import { settleGroup, type RawContribution } from "@/lib/settlement-algorithm";
import { createPaymentLink, razorpayConfigured } from "@/lib/razorpay";

/**
 * GET /api/settlement?groupId=... — compute net balances + the minimal
 * transfer plan (the "before → after" graph data), plus persisted debts.
 */
export async function GET(req: NextRequest) {
  const auth = await authGuard();
  if ("response" in auth) return auth.response;
  const groupId = req.nextUrl.searchParams.get("groupId");
  if (!groupId) return jsonError("groupId is required");
  if (!(await isMember(auth.user.id, groupId))) return jsonError("Not a member", 403);

  try {
    const shares = await prisma.billShare.findMany({
      where: { bill: { groupId } },
      include: { user: { select: { id: true, name: true } } },
    });
    const contributions: RawContribution[] = shares.map((s) => ({
      userId: s.user.id,
      name: s.user.name,
      paid: s.paid,
      share: s.share,
    }));

    const { balances, transfers } = settleGroup(contributions);

    const debts = await prisma.debt.findMany({
      where: { groupId },
      include: {
        debtor: { select: { id: true, name: true } },
        creditor: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    // Naive pairwise count for the "before" number in the graph
    const owing = balances.filter((b) => b.net < -0.01).length;
    const owed = balances.filter((b) => b.net > 0.01).length;
    const naiveCount = owing * owed;

    return NextResponse.json({
      balances,
      transfers,
      debts,
      stats: { naiveCount, minimalCount: transfers.length },
      razorpayEnabled: razorpayConfigured(),
    });
  } catch (e) {
    return jsonError(
      `Settlement computation failed: ${e instanceof Error ? e.message : "unknown"}`,
      500
    );
  }
}

/**
 * POST /api/settlement — persist the minimal transfer plan as Debts and
 * (optionally) create Razorpay payment links for each.
 * Body: { groupId, createLinks?: boolean }
 * Existing pending debts are replaced so the plan is always fresh.
 */
export async function POST(req: NextRequest) {
  const auth = await authGuard();
  if ("response" in auth) return auth.response;
  try {
    const { groupId, createLinks } = await req.json();
    if (!groupId) return jsonError("groupId is required");
    if (!(await isMember(auth.user.id, groupId))) return jsonError("Not a member", 403);

    const group = await prisma.group.findUnique({
      where: { id: groupId },
      include: {
        members: { include: { user: { select: { id: true, name: true, phone: true } } } },
      },
    });
    if (!group) return jsonError("Group not found", 404);

    const shares = await prisma.billShare.findMany({
      where: { bill: { groupId } },
      include: { user: { select: { id: true, name: true } } },
    });
    const { transfers } = settleGroup(
      shares.map((s) => ({
        userId: s.user.id,
        name: s.user.name,
        paid: s.paid,
        share: s.share,
      }))
    );

    if (transfers.length === 0) {
      return NextResponse.json({ created: 0, message: "Everyone is settled up! 🎉" });
    }

    // Replace pending debts with the fresh minimal plan (paid ones are history)
    await prisma.debt.deleteMany({ where: { groupId, status: "pending" } });

    const memberById = new Map(group.members.map((m) => [m.user.id, m.user]));
    let created = 0;
    const errors: string[] = [];

    for (const t of transfers) {
      let paymentLinkId: string | null = null;
      let paymentUrl: string | null = null;

      if (createLinks) {
        try {
          const link = await createPaymentLink({
            amount: t.amount,
            debtorName: t.fromName,
            debtorContact: memberById.get(t.fromId)?.phone,
            groupName: group.name,
            description: `${group.name}: settle ₹${t.amount} to ${t.toName}`,
          });
          paymentLinkId = link.id;
          paymentUrl = link.url;
        } catch (e) {
          errors.push(
            `Link for ${t.fromName}→${t.toName} failed: ${
              e instanceof Error ? e.message : "unknown"
            }`
          );
        }
      }

      await prisma.debt.create({
        data: {
          groupId,
          debtorId: t.fromId,
          creditorId: t.toId,
          amount: t.amount,
          paymentLinkId,
          paymentUrl,
        },
      });
      created++;
    }

    await prisma.activity.create({
      data: {
        groupId,
        type: "settlement",
        actorId: auth.user.id,
        message: `${auth.user.name} settled up the group — ${created} payment${
          created === 1 ? "" : "s"
        } needed (down from ${group.members.length * group.members.length} possible)`,
        meta: JSON.stringify({ created }),
      },
    });

    return NextResponse.json({ created, errors });
  } catch (e) {
    return jsonError(
      `Settlement failed: ${e instanceof Error ? e.message : "unknown"}`,
      500
    );
  }
}
