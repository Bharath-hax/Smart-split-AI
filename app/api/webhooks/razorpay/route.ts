import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyWebhookSignature } from "@/lib/razorpay";

/**
 * POST /api/webhooks/razorpay — Razorpay webhook listener.
 * Verifies the HMAC-SHA256 signature against RAZORPAY_WEBHOOK_SECRET and, on
 * `payment_link.paid`, flips the matching Debt to status "paid" and logs an
 * Activity entry (the dashboard picks it up on its next poll).
 */
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-razorpay-signature");

  if (!verifyWebhookSignature(rawBody, signature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  try {
    const event = JSON.parse(rawBody);
    const type = event?.event as string | undefined;

    if (type === "payment_link.paid") {
      const entity = event?.payload?.payment_link?.entity;
      const linkId = entity?.id as string | undefined;
      if (!linkId) {
        return NextResponse.json({ error: "Missing payment_link id" }, { status: 400 });
      }

      const debt = await prisma.debt.findUnique({
        where: { paymentLinkId: linkId },
        include: {
          debtor: { select: { name: true } },
          creditor: { select: { name: true } },
          group: { select: { id: true, name: true } },
        },
      });

      if (debt && debt.status !== "paid") {
        await prisma.debt.update({
          where: { id: debt.id },
          data: { status: "paid", settledAt: new Date() },
        });
        await prisma.activity.create({
          data: {
            groupId: debt.group.id,
            type: "payment",
            message: `${debt.debtor.name} settled ₹${debt.amount.toFixed(0)} with ${
              debt.creditor.name
            } in ${debt.group.name} ✅`,
            meta: JSON.stringify({ debtId: debt.id, amount: debt.amount }),
          },
        });
      }

      return NextResponse.json({ ok: true, processed: true, linkId });
    }

    // Other event types are acknowledged but ignored
    return NextResponse.json({ ok: true, processed: false, event: type ?? "unknown" });
  } catch (e) {
    return NextResponse.json(
      { error: `Webhook processing failed: ${e instanceof Error ? e.message : "unknown"}` },
      { status: 500 }
    );
  }
}
