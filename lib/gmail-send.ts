/**
 * Gmail API email sender — fully-automatic payment reminders, delivered as
 * clean HTML email from the bill-creator's own connected Gmail account.
 *
 * Flow:
 *  1. Message body is written by Gemini (tone scales with urgency), with a
 *     deterministic-template fallback already built into
 *     generateReminderMessage — so the email content never fails to generate.
 *  2. Body is wrapped in a tidy HTML email (group name, amount, "Pay Now"
 *     button → Razorpay payment link) + a plain-text alternative.
 *  3. Sent via Gmail API users.messages.send with a base64url MIME payload,
 *     authenticated as the sender (OAuth tokens stored on their User row).
 *
 * Failures never throw — they return { ok: false, ... }. A missing/revoked
 * gmail.send permission returns needsReconnect=true so the UI can say:
 * "Email notifications need Gmail permission — reconnect in Profile".
 */

import {
  getValidGoogleAccessToken,
  type GoogleAuthUser,
} from "@/lib/google-auth";
import { generateReminderMessage } from "@/lib/gemini";

export interface ReminderEmailInput {
  /** id of the signed-in user sending the reminder (their Gmail is used) */
  senderUserId: string;
  toEmail: string;
  personName: string;
  amount: number;
  paymentLink: string | null;
  urgencyLevel: "gentle" | "nudge" | "firm";
  groupName: string;
  creditorName: string;
  /** Pre-generated plain-text reminder (skips another Gemini call when set) */
  message?: string;
}

export interface ReminderEmailResult {
  ok: boolean;
  /** Gmail message id on success */
  gmailMessageId?: string;
  /** true when the Gmail connection exists but gmail.send was never granted (or was revoked) */
  needsReconnect?: boolean;
  error?: string;
}

export const NEEDS_RECONNECT_MESSAGE =
  "Email notifications need Gmail permission — reconnect in Profile";

export function formatINR(n: number): string {
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Build the HTML email around the AI-written plain-text body. */
function buildHtml(opts: {
  bodyText: string;
  personName: string;
  groupName: string;
  amount: string;
  paymentLink: string | null;
  creditorName: string;
}): string {
  const payBtn = opts.paymentLink
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0"><tr><td style="border-radius:10px;background:#4f46e5">
         <a href="${esc(opts.paymentLink)}" style="display:inline-block;padding:12px 28px;font-family:Arial,sans-serif;font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:10px">Pay ${esc(opts.amount)} Now</a>
       </td></tr></table>`
    : "";
  const linkNote = opts.paymentLink
    ? `Or copy this link into your browser:<br><a href="${esc(opts.paymentLink)}" style="color:#4f46e5">${esc(opts.paymentLink)}</a>`
    : "";
  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#f4f4f7">
  <div style="max-width:520px;margin:0 auto;padding:24px;font-family:Arial,Helvetica,sans-serif;color:#1f2937">
    <div style="background:#ffffff;border-radius:14px;padding:28px;border:1px solid #e5e7eb">
      <p style="margin:0 0 4px;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:1px">SplitSettle AI · ${esc(opts.groupName)}</p>
      <h2 style="margin:0 0 16px;font-size:20px">Hi ${esc(opts.personName)}, a quick reminder 👋</h2>
      <p style="margin:0 0 12px;font-size:22px;font-weight:bold;color:#111827">You owe ${esc(opts.amount)} in ${esc(opts.groupName)}</p>
      <p style="margin:0 0 8px;font-size:15px;line-height:1.6;white-space:pre-line">${esc(opts.bodyText)}</p>
      ${payBtn}
      ${linkNote ? `<p style="margin:10px 0 0;font-size:12px;color:#6b7280;line-height:1.5">${linkNote}</p>` : ""}
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0" />
      <p style="margin:0;font-size:12px;color:#9ca3af">Settle up in the fewest payments — sent by ${esc(opts.creditorName)} via SplitSettle AI.</p>
    </div>
  </div>
</body></html>`;
}

/** Encode a MIME message as base64url (Gmail API wire format). */
function toBase64UrlMime(opts: {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
}): string {
  const mime = [
    `From: ${opts.from}`,
    `To: ${opts.to}`,
    `Subject: ${opts.subject}`,
    "MIME-Version: 1.0",
    'Content-Type: multipart/alternative; boundary="ss-boundary"',
    "",
    "--ss-boundary",
    "Content-Type: text/plain; charset=UTF-8",
    "",
    opts.text,
    "",
    "--ss-boundary",
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    opts.html,
    "",
    "--ss-boundary--",
  ].join("\r\n");
  return Buffer.from(mime, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Detect the specific "user hasn't granted gmail.send" failure so the UI can
 * show "Email notifications need Gmail permission — reconnect in Profile"
 * instead of a generic error.
 */
function isScopeError(status: number, body: string): boolean {
  if (status === 401) return true;
  if (status === 403) {
    const b = body.toLowerCase();
    return (
      b.includes("insufficient") ||
      b.includes("access not granted") ||
      b.includes("permission") ||
      b.includes("scope") ||
      b.includes("forbidden")
    );
  }
  return false;
}

/**
 * Generate (Gemini) and send a payment reminder email via the Gmail API.
 * Never throws.
 */
export async function sendPaymentReminderEmail(
  sender: GoogleAuthUser & { id: string; name: string },
  input: ReminderEmailInput
): Promise<ReminderEmailResult> {
  try {
    // 0. Is the sender connected with send permission?
    if (!sender.gmailSendGranted) {
      return { ok: false, needsReconnect: true, error: NEEDS_RECONNECT_MESSAGE };
    }
    const accessToken = await getValidGoogleAccessToken(sender);
    if (!accessToken) {
      return { ok: false, needsReconnect: true, error: NEEDS_RECONNECT_MESSAGE };
    }

    // 1. AI-written body (Gemini → template chain inside lib/gemini)
    const daysByUrgency =
      input.urgencyLevel === "firm" ? 6 : input.urgencyLevel === "nudge" ? 3 : 0;
    let bodyText = input.message?.trim() || "";
    if (!bodyText) {
      const gen = await generateReminderMessage(
        input.personName,
        input.creditorName,
        input.groupName,
        input.amount,
        daysByUrgency
      );
      bodyText = gen.data ?? "";
    }
    if (!bodyText) {
      bodyText = `Hi ${input.personName}! Gentle nudge: you owe ${formatINR(
        input.amount
      )} in ${input.groupName}. Please settle when you get a chance.`;
    }

    // 2. Build the HTML email + MIME payload
    const amountStr = formatINR(input.amount);
    const subject = `Reminder: You owe ${amountStr} in ${input.groupName}`;
    const html = buildHtml({
      bodyText,
      personName: input.personName,
      groupName: input.groupName,
      amount: amountStr,
      paymentLink: input.paymentLink,
      creditorName: input.creditorName,
    });
    const from = sender.googleEmail || "me";
    const raw = toBase64UrlMime({
      from,
      to: input.toEmail,
      subject,
      text: `${bodyText}\n\n${input.paymentLink ? `Pay here: ${input.paymentLink}` : "Open SplitSettle AI to pay."}`,
      html,
    });

    // 3. Send via Gmail API (users.messages.send)
    const res = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ raw }),
      }
    );
    if (!res.ok) {
      const text = await res.text();
      if (isScopeError(res.status, text)) {
        return { ok: false, needsReconnect: true, error: NEEDS_RECONNECT_MESSAGE };
      }
      return {
        ok: false,
        error: `Gmail API ${res.status}: ${text.slice(0, 200)}`,
      };
    }
    const data = (await res.json()) as { id?: string };
    return { ok: true, gmailMessageId: data.id };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown Gmail send error",
    };
  }
}
