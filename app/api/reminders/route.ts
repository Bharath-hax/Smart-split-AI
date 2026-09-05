import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authGuard, jsonError } from "@/lib/api";
import { generateReminderMessage } from "@/lib/gemini";

/**
 * POST /api/reminders — generate a smart, personalized nudge for a debt.
 * Tone automatically scales with how overdue it is (gentle → firm).
 * Body: { debtId }. Returns the message; the UI shows it with copy/share
 * buttons since WhatsApp isn't wired up.
 */
export async function POST(req: NextRequest) {
  const auth = await authGuard();
  if ("response" in auth) return auth.response;
  try {
    const { debtId } = await req.json();
    if (!debtId) return jsonError("debtId is required");

    const debt = await prisma.debt.findUnique({
      where: { id: debtId },
      include: {
        debtor: { select: { name: true } },
        creditor: { select: { id: true, name: true } },
        group: { select: { name: true } },
      },
    });
    if (!debt) return jsonError("Debt not found", 404);

    // Only the creditor (or any group member) can nudge
    if (debt.creditor.id !== auth.user.id) {
      const member = await prisma.membership.findUnique({
        where: {
          groupId_userId: { groupId: debt.groupId, userId: auth.user.id },
        },
      });
      if (!member) return jsonError("Not allowed", 403);
    }

    const daysOverdue = Math.max(
      0,
      Math.floor((Date.now() - debt.createdAt.getTime()) / 86400000)
    );
    const result = await generateReminderMessage(
      debt.debtor.name,
      debt.creditor.name,
      debt.group.name,
      debt.amount,
      daysOverdue
    );
    if (!result.ok || !result.data) {
      return jsonError(result.error || "Could not generate reminder", 502);
    }
    return NextResponse.json({ message: result.data, daysOverdue });
  } catch (e) {
    return jsonError(
      `Reminder failed: ${e instanceof Error ? e.message : "unknown"}`,
      500
    );
  }
}
