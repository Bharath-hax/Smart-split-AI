/**
 * Razorpay payment-link client (Test/Sandbox mode only).
 * Gracefully degrades to mock links when no keys are configured so the
 * whole flow stays demoable without credentials.
 */
import { createHmac, timingSafeEqual } from "crypto";

interface RazorpayPaymentLink {
  id: string;
  short_url?: string;
  [key: string]: unknown;
}

/** Treat obvious placeholder values as unset. */
function isPlaceholder(v: string | undefined): boolean {
  if (!v) return true;
  return /xxxx|your_|change_me|placeholder/i.test(v);
}

/** Are real Razorpay credentials configured? */
export function razorpayConfigured(): boolean {
  return (
    !isPlaceholder(process.env.RAZORPAY_KEY_ID) &&
    !isPlaceholder(process.env.RAZORPAY_KEY_SECRET)
  );
}

/**
 * Create a Razorpay test-mode payment link.
 * Returns { id, url, mock } — mock=true when credentials are absent and a
 * placeholder link is generated instead.
 */
export async function createPaymentLink(params: {
  amount: number; // rupees
  debtorName: string;
  debtorContact?: string | null;
  groupName: string;
  description: string;
}): Promise<{ id: string; url: string; mock: boolean }> {
  const amountPaise = Math.round(params.amount * 100);

  if (!razorpayConfigured()) {
    // Mock mode — keeps the demo flow working without keys
    return {
      id: `mock_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      url: `#mock-pay-${amountPaise}`,
      mock: true,
    };
  }

  try {
    const Razorpay = (await import("razorpay")).default;
    const client = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID!,
      key_secret: process.env.RAZORPAY_KEY_SECRET!,
    });

    const link = (await client.paymentLink.create({
      amount: amountPaise,
      currency: "INR",
      accept_partial: false,
      description: params.description.slice(0, 200),
      customer: {
        name: params.debtorName,
        contact: params.debtorContact || undefined,
      },
      notify: { sms: Boolean(params.debtorContact), email: false },
      reminder_enable: true,
      notes: { group: params.groupName },
    })) as unknown as RazorpayPaymentLink;

    return {
      id: link.id,
      url: link.short_url || `https://rzp.io/i/${link.id}`,
      mock: false,
    };
  } catch (e) {
    throw new Error(
      `Razorpay payment link creation failed: ${e instanceof Error ? e.message : String(e)}`
    );
  }
}

/**
 * Verify a Razorpay webhook signature (X-Razorpay-Signature header).
 * signature = HMAC-SHA256(rawRequestBody, RAZORPAY_WEBHOOK_SECRET).
 */
export function verifyWebhookSignature(
  rawBody: string,
  signature: string | null
): boolean {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret || !signature) return false;
  try {
    const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
    return (
      signature.length === expected.length &&
      timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
    );
  } catch {
    return false;
  }
}
