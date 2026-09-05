/**
 * Central email sender - fully-automatic payment reminders via Nodemailer +
 * a single dedicated Gmail account authenticated with an App Password.
 *
 * No user ever needs to connect Google or be a Cloud Console test user:
 * the app itself is the sender ("SplitSettle AI" <NOTIFICATION_EMAIL>).
 *
 * Setup (no OAuth consent screen, no test users, no Cloud Console):
 *  1. Pick one Gmail account for the app (dedicated is nicer).
 *  2. On it: Google Account -> Security -> 2-Step Verification -> ON.
 *  3. Google Account -> Security -> App Passwords -> generate one (app: Mail).
 *  4. Set NOTIFICATION_EMAIL + NOTIFICATION_EMAIL_APP_PASSWORD env vars.
 */

import nodemailer from "nodemailer";
import { generateReminderMessage } from "@/lib/gemini";

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.NOTIFICATION_EMAIL,
    pass: process.env.NOTIFICATION_EMAIL_APP_PASSWORD,
  },
});

/** The single gate for email delivery - server-side config, not per-user auth. */
export const isMailerConfigured = !!(
  process.env.NOTIFICATION_EMAIL && process.env.NOTIFICATION_EMAIL_APP_PASSWORD
);

/** Rupee sign, ASCII-safe for any file encoding. */
const RS = "\u20B9";

export interface ReminderEmailInput {
  toEmail: string;
  personName: string;
  amount: number;
  paymentLink: string | null;
  urgencyLevel: "gentle" | "neutral" | "firm";
  groupName: string;
  creditorName: string;
  /** Pre-generated plain-text reminder (skips another Gemini call when set) */
  message?: string;
}

export interface ReminderEmailResult {
  ok: boolean;
  /** Nodemailer message id on success */
  messageId?: string;
  /** "not_configured" when NOTIFICATION_EMAIL / APP_PASSWORD are missing */
  reason?: string;
  error?: string;
}

export function formatINR(n: number): string {
  return `${RS}${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
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
      <p style="margin:0 0 4px;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:1px">SplitSettle AI \u00B7 ${esc(opts.groupName)}</p>
      <h2 style="margin:0 0 16px;font-size:20px">Hi ${esc(opts.personName)}, you owe ${esc(opts.amount)}</h2>
      <div style="white-space:pre-wrap;line-height:1.6;font-size:14px">${esc(opts.bodyText)}</div>
      ${payBtn}
      ${linkNote}
      <p style="margin:24px 0 0;font-size:11px;color:#9ca3af;border-top:1px solid #f3f4f6;padding-top:12px">
        Sent automatically by SplitSettle AI for the &ldquo;${esc(opts.groupName)}&rdquo; group \u00B7 settled to ${esc(opts.creditorName)}
      </p>
    </div>
  </div>
</body></html>`;
}

/**
 * Generate (Gemini) and send a payment reminder email from the app's
 * dedicated account. Never throws.
 */
export async function sendPaymentReminderEmail(
  input: ReminderEmailInput
): Promise<ReminderEmailResult> {
  if (!isMailerConfigured) {
    return {
      ok: false,
      reason: "not_configured",
      error:
        "Email reminders aren't configured on the server (NOTIFICATION_EMAIL / NOTIFICATION_EMAIL_APP_PASSWORD)",
    };
  }

  try {
    // AI-written body (Gemini -> template chain inside lib/gemini), unchanged
    const daysByUrgency =
      input.urgencyLevel === "firm"
        ? 6
        : input.urgencyLevel === "neutral"
          ? 3
          : 0;
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

    const amountStr = formatINR(input.amount);
    const info = await transporter.sendMail({
      from: `"SplitSettle AI" <${process.env.NOTIFICATION_EMAIL}>`,
      to: input.toEmail,
      subject: `Reminder: You owe ${amountStr} in ${input.groupName}`,
      text: `${bodyText}\n\n${
        input.paymentLink ? `Pay here: ${input.paymentLink}` : "Open SplitSettle AI to pay."
      }`,
      html: buildHtml({
        bodyText,
        personName: input.personName,
        groupName: input.groupName,
        amount: amountStr,
        paymentLink: input.paymentLink,
        creditorName: input.creditorName,
      }),
    });
    return { ok: true, messageId: info.messageId };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown email send error",
    };
  }
}