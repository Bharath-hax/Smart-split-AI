import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authGuard, isMember, jsonError } from "@/lib/api";
import { settleGroup, type RawContribution } from "@/lib/settlement-algorithm";
import { createPaymentLink, razorpayConfigured } from "@/lib/razorpay";
import { generateReminderMessage } from "@/lib/gemini";
import {
  sendPaymentReminderEmail,
  NEEDS_RECONNECT_MESSAGE,
} from "@/lib/gmail-send";
import { googleOAuthConfigured } from "@/lib/google-auth";

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
        emailLogs: { orderBy: { createdAt: "desc" }, take: 1 },
      },
      orderBy: { createdAt: "desc" },
    });

    // Surface the latest email delivery attempt per debt for the UI chip
    const debtsWithEmail = debts.map((debt) => {
      const log = debt.emailLogs[0];
      const { emailLogs, ...rest } = debt;
      return {
        ...rest,
        lastEmail: log
          ? {
              status: log.status,
              toEmail: log.toEmail,
              error: log.errorMessage,
              sentAt: log.createdAt.toISOString(),
            }
          : null,
      };
    });

    // Naive pairwise count for the "before" number in the graph
    const owing = balances.filter((b) => b.net < -0.01).length;
    const owed = balances.filter((b) => b.net > 0.01).length;
    const naiveCount = owing * owed;

    return NextResponse.json({
      balances,
      transfers,
      debts: debtsWithEmail,
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
        members: {
          include: { user: { select: { id: true, name: true, phone: true, email: true } } },
        },
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
    const createdDebts: Array<{
      id: string;
      debtorName: string;
      creditorName: string;
      amount: number;
      email: string | null;
      paymentUrl: string | null;
    }> = [];

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

      const debt = await prisma.debt.create({
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
      createdDebts.push({
        id: debt.id,
        debtorName: t.fromName,
        creditorName: t.toName,
        amount: t.amount,
        email: memberById.get(t.fromId)?.email ?? null,
        paymentUrl,
      });
    }

    // ── Fully-automatic smart EMAIL reminders ─────────────────────────────
    // Fires the instant payment links exist (part of this same save action —
    // no button click per debtor). Each email is written by Gemini and sent
    // via the Gmail API from the bill-creator's own connected Gmail account.
    // If the sender hasn't connected Gmail (or a debtor has no email on
    // file), the message is stored and shown in-app as a copyable fallback.
    const sender = await prisma.user.findUnique({
      where: { id: auth.user.id },
      select: {
        id: true,
        name: true,
        googleEmail: true,
        googleAccessToken: true,
        googleRefreshToken: true,
        googleTokenExpiry: true,
        gmailSendGranted: true,
      },
    });
    const gmailConnected = Boolean(
      sender?.gmailSendGranted && sender?.googleAccessToken
    );

    const reminders: Array<{
      debtId: string;
      debtorName: string;
      channel: "email" | "in-app";
      message: string;
      error?: string;
    }> = [];

    for (const d of createdDebts) {
      try {
        const gen = await generateReminderMessage(
          d.debtorName,
          d.creditorName,
          group.name,
          d.amount,
          0 // brand-new debt → gentle tone
        );
        let message = gen.data ?? "";
        const hasRealLink =
          d.paymentUrl && !d.paymentUrl.startsWith("#");
        if (hasRealLink) {
          message += `\n\nPay securely here: ${d.paymentUrl}`;
        } else if (d.paymentUrl) {
          message += "\n\n(Open the app to use your demo payment link.)";
        }

        let channel: "email" | "in-app" = "in-app";
        let sendError: string | undefined;

        if (gmailConnected && d.email && sender) {
          const sent = await sendPaymentReminderEmail(sender, {
            senderUserId: sender.id,
            toEmail: d.email,
            personName: d.debtorName,
            amount: d.amount,
            paymentLink: d.paymentUrl,
            urgencyLevel: "gentle",
            groupName: group.name,
            creditorName: d.creditorName,
            message,
          });
          await prisma.emailLog.create({
            data: {
              debtId: d.id,
              toEmail: d.email,
              status: sent.ok ? "sent" : "failed",
              gmailMessageId: sent.gmailMessageId ?? null,
              errorMessage: sent.error ?? null,
            },
          });
          if (sent.ok) {
            channel = "email";
          } else {
            sendError = sent.error;
          }
        } else if (gmailConnected && !d.email) {
          sendError = "Debtor has no email on file";
        } else if (!gmailConnected && googleOAuthConfigured()) {
          sendError = NEEDS_RECONNECT_MESSAGE;
        }

        await prisma.debt.update({
          where: { id: d.id },
          data: {
            lastReminderMessage: message,
            ...(channel === "email" ? { reminderSentAt: new Date() } : {}),
          },
        });

        reminders.push({
          debtId: d.id,
          debtorName: d.debtorName,
          channel,
          message,
          error: sendError,
        });
      } catch (e) {
        // Never let reminder failures break the settlement response
        errors.push(
          `Auto-reminder for ${d.debtorName} failed: ${
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
        message: `${auth.user.name} settled up the group — ${created} payment${
          created === 1 ? "" : "s"
        } needed (down from ${group.members.length * group.members.length} possible)`,
        meta: JSON.stringify({ created }),
      },
    });

    return NextResponse.json({
      created,
      errors,
      reminders,
      gmailConnected,
      googleConfigured: googleOAuthConfigured(),
    });
  } catch (e) {
    return jsonError(
      `Settlement failed: ${e instanceof Error ? e.message : "unknown"}`,
      500
    );
  }
}
