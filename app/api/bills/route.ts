import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authGuard, isMember, jsonError } from "@/lib/api";
import { createPaymentLink } from "@/lib/razorpay";
import { generateReminderMessage } from "@/lib/gemini";
import {
  sendPaymentReminderEmail,
  isMailerConfigured,
} from "@/lib/mailer";

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

    // ── Auto-detect non-payers → debts + payment links + Gmail ──
    // Every member whose share exceeds what they paid owes the difference to
    // the primary payer. We create a Debt for each, attach a (test/demo)
    // payment link, and — when email sending is configured on the server —
    // send an automatic reminder email with the "Pay now" link right away.
    const reminders: Array<{
      debtId: string;
      debtorName: string;
      channel: "email" | "in-app";
      message: string;
      error?: string;
    }> = [];
    const claimErrors: string[] = [];
    const emailEnabled = isMailerConfigured;
    const group = await prisma.group.findUnique({
      where: { id: groupId },
      select: { name: true },
    });
    const unpaidSplits = validSplits.filter(
      (s) => (Number(s.share) || 0) - (Number(s.paid) || 0) > 0.01
    );
    const primaryPayer = validSplits
      .filter((s) => (Number(s.paid) || 0) > 0)
      .sort((a, b) => (Number(b.paid) || 0) - (Number(a.paid) || 0))[0];

    if (group && primaryPayer && unpaidSplits.length > 0) {
      const members = await prisma.membership.findMany({
        where: { groupId },
        include: {
          user: { select: { id: true, name: true, email: true, phone: true } },
        },
      });
      const memberById = new Map(members.map((m) => [m.user.id, m.user]));
      const payerName = memberById.get(primaryPayer.userId)?.name ?? "a friend";

      for (const s of unpaidSplits) {
        if (s.userId === primaryPayer.userId) continue; // can't owe yourself
        const debtor = memberById.get(s.userId);
        if (!debtor) continue;
        const owing = Math.round(
          ((Number(s.share) || 0) - (Number(s.paid) || 0)) * 100
        ) / 100;
        if (owing <= 0.01) continue;

        let paymentLinkId: string | null = null;
        let paymentUrl: string | null = null;
        try {
          const link = await createPaymentLink({
            amount: owing,
            debtorName: debtor.name,
            debtorContact: debtor.phone,
            groupName: group.name,
            description: `${vendor.trim()}: settle ${owing.toFixed(2)} to ${payerName}`,
          });
          paymentLinkId = link.id;
          paymentUrl = link.url;
        } catch (e) {
          claimErrors.push(
            `Link for ${debtor.name} failed: ${
              e instanceof Error ? e.message : "unknown"
            }`
          );
        }

        const debt = await prisma.debt.create({
          data: {
            groupId,
            billId: bill.id,
            debtorId: s.userId,
            creditorId: primaryPayer.userId,
            amount: owing,
            paymentLinkId,
            paymentUrl,
          },
        });
// Automatic Gmail reminder to the non-payer (falls back to in-app)
        try {
          const gen = await generateReminderMessage(
            debtor.name,
            payerName,
            group.name,
            owing,
            0
          );
          let message = gen.data ?? "";
          const hasRealLink = paymentUrl && !paymentUrl.startsWith("#");
          if (hasRealLink) {
            message += `\n\nPay securely here: ${paymentUrl}`;
          } else if (paymentUrl) {
            message += "\n\n(Open the app to use your demo payment link.)";
          }

          let channel: "email" | "in-app" = "in-app";
          let sendError: string | undefined;

          if (emailEnabled && debtor.email) {
            const sent = await sendPaymentReminderEmail({
              toEmail: debtor.email,
              personName: debtor.name,
              amount: owing,
              paymentLink: paymentUrl,
              urgencyLevel: "gentle",
              groupName: group.name,
              creditorName: payerName,
              message,
            });
            await prisma.emailLog.create({
              data: {
                debtId: debt.id,
                toEmail: debtor.email,
                status: sent.ok ? "sent" : "failed",
                gmailMessageId: sent.messageId ?? null,
                errorMessage: sent.error ?? null,
              },
            });
            if (sent.ok) {
              channel = "email";
            } else {
              sendError = sent.error;
            }
          } else if (emailEnabled && !debtor.email) {
            sendError = "Debtor has no email on file";
          }

          await prisma.debt.update({
            where: { id: debt.id },
            data: {
              lastReminderMessage: message,
              ...(channel === "email" ? { reminderSentAt: new Date() } : {}),
            },
          });

          reminders.push({
            debtId: debt.id,
            debtorName: debtor.name,
            channel,
            message,
            error: sendError,
          });
        } catch (e) {
          claimErrors.push(
            `Auto-reminder for ${debtor.name} failed: ${
              e instanceof Error ? e.message : "unknown"
            }`
          );
        }
      }

      await prisma.activity.create({
        data: {
          groupId,
          type: "settlement",
          actorId: auth.user.id,
          message: `${auth.user.name} detected ${unpaidSplits.length} unpaid share${
            unpaidSplits.length === 1 ? "" : "s"
          } on “${bill.vendor}” and sent payment reminders`,
          meta: JSON.stringify({ billId: bill.id, unpaid: unpaidSplits.length }),
        },
      });
    }

    return NextResponse.json({
      bill,
      unpaidDetected: unpaidSplits.length,
      reminders,
      reminderErrors: claimErrors,
      notificationsConfigured: isMailerConfigured,
    });
  } catch (e) {
    return jsonError(
      `Could not save bill: ${e instanceof Error ? e.message : "unknown"}`,
      500
    );
  }
}
