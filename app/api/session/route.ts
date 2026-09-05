import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { clearSessionCookie, setSessionCookie } from "@/lib/session";
import { jsonError } from "@/lib/api";

/**
 * POST /api/session — quick login (name + phone + email, no OTP for demo speed).
 * Creates the user if the phone is new, otherwise logs them in.
 * Email is required (validated format) — it's how auto reminders get delivered.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function POST(req: NextRequest) {
  try {
    const { name, phone, email } = await req.json();
    if (!name?.trim() || !phone?.trim()) {
      return jsonError("Name and phone are required");
    }
    const cleanEmail = String(email ?? "").trim().toLowerCase();
    if (!cleanEmail || !EMAIL_RE.test(cleanEmail)) {
      return jsonError("A valid email is required (used for payment reminders)");
    }
    const cleanPhone = String(phone).replace(/[^\d+]/g, "");
    if (cleanPhone.length < 8) {
      return jsonError("Please enter a valid phone number");
    }

    const user = await prisma.user.upsert({
      where: { phone: cleanPhone },
      update: { name: name.trim(), email: cleanEmail },
      create: { name: name.trim(), phone: cleanPhone, email: cleanEmail },
    });

    await setSessionCookie(user.id);
    return NextResponse.json({
      user: { id: user.id, name: user.name, phone: user.phone, email: user.email },
    });
  } catch (e) {
    return jsonError(
      `Login failed: ${e instanceof Error ? e.message : "unknown error"}`,
      500
    );
  }
}

/**
 * DELETE /api/session — logout.
 */
export async function DELETE() {
  await clearSessionCookie();
  return NextResponse.json({ ok: true });
}
