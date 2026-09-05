import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { clearSessionCookie, setSessionCookie } from "@/lib/session";
import { jsonError } from "@/lib/api";

/**
 * POST /api/session — quick login (name + phone, no OTP for demo speed).
 * Creates the user if the phone is new, otherwise logs them in.
 */
export async function POST(req: NextRequest) {
  try {
    const { name, phone } = await req.json();
    if (!name?.trim() || !phone?.trim()) {
      return jsonError("Name and phone are required");
    }
    const cleanPhone = String(phone).replace(/[^\d+]/g, "");
    if (cleanPhone.length < 8) {
      return jsonError("Please enter a valid phone number");
    }

    const user = await prisma.user.upsert({
      where: { phone: cleanPhone },
      update: { name: name.trim() },
      create: { name: name.trim(), phone: cleanPhone },
    });

    await setSessionCookie(user.id);
    return NextResponse.json({ user: { id: user.id, name: user.name, phone: user.phone } });
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
