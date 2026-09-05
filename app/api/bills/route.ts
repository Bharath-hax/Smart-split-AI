import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authGuard, isMember, jsonError } from "@/lib/api";

/**
 * GET /api/bills?groupId=... — list a group's bills with shares.
 */
export async function GET(req: NextRequest) {
  const auth = await authGuard();
  if ("response" in auth) return auth.response;
  const groupId = req.nextUrl.searchParams.get("groupId");
  if (!groupId) return jsonError("groupId is required");
  if (!(await isMember(auth.user.id, groupId))) return jsonError("Not a member", 403);

  try {
    const bills = await prisma.bill.findMany({
      where: { groupId },
      include: {
        uploader: { select: { id: true, name: true } },
        shares: { include: { user: { select: { id: true, name: true } } } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return NextResponse.json({ bills });
  } catch (e) {
    return jsonError(
      `Could not load bills: ${e instanceof Error ? e.message : "unknown"}`,
      500
    );
  }
}

interface SplitInput {
  userId: string;
  paid: number;
  share: number;
}

/**
 * POST /api/bills — save a scanned + confirmed bill with payer/split data.
 * Body: { groupId, vendor, category, total, billDate, items?, anomalyPct?,
 *         splits: [{userId, paid, share}] }
 */
export async function POST(req: NextRequest) {
  const auth = await authGuard();
  if ("response" in auth) return auth.response;
  try {
    const body = await req.json();
    const { groupId, vendor, category, total, billDate, items, anomalyPct } = body;
    const splits: SplitInput[] = Array.isArray(body.splits) ? body.splits : [];

    if (!groupId || !vendor?.trim() || typeof total !== "number" || total <= 0) {
      return jsonError("groupId, vendor and a positive total are required");
    }
    if (!(await isMember(auth.user.id, groupId))) return jsonError("Not a member", 403);

    const members = await prisma.membership.findMany({ where: { groupId } });
    const memberIds = new Set(members.map((m) => m.userId));
    const validSplits = splits.filter(
      (s) => memberIds.has(s.userId) && (s.paid > 0 || s.share > 0)
    );
    if (validSplits.length === 0) {
      return jsonError("At least one payer and one share assignment is required");
    }

    const shareSum = validSplits.reduce((a, s) => a + (Number(s.share) || 0), 0);
    if (Math.abs(shareSum - total) > Math.max(1, total * 0.02)) {
      return jsonError(
        `Shares add up to ₹${shareSum.toFixed(2)} but the bill total is ₹${total.toFixed(2)}`
      );
    }

    const bill = await prisma.bill.create({
      data: {
        groupId,
        uploaderId: auth.user.id,
        vendor: vendor.trim(),
        category: category || "Other",
        total,
        billDate: billDate ? new Date(billDate) : new Date(),
        items:
          Array.isArray(items) && items.length
            ? JSON.stringify(items)
            : undefined,
        anomalyPct: typeof anomalyPct === "number" && anomalyPct > 0 ? anomalyPct : null,
        shares: {
          create: validSplits.map((s) => ({
            userId: s.userId,
            paid: Number(s.paid) || 0,
            share: Number(s.share) || 0,
          })),
        },
      },
      include: { shares: { include: { user: { select: { name: true } } } } },
    });

    const payers = bill.shares
      .filter((s) => s.paid > 0)
      .map((s) => s.user.name)
      .join(" & ");
    await prisma.activity.create({
      data: {
        groupId,
        type: "bill",
        actorId: auth.user.id,
        message: `${payers} paid ₹${total.toFixed(0)} at ${bill.vendor} (${bill.category})`,
        meta: JSON.stringify({ billId: bill.id, category: bill.category, total }),
      },
    });

    return NextResponse.json({ bill });
  } catch (e) {
    return jsonError(
      `Could not save bill: ${e instanceof Error ? e.message : "unknown"}`,
      500
    );
  }
}
