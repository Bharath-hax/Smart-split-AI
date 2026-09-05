import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";

/**
 * POST /api/google/disconnect — clear this user's stored Google tokens so
 * reminders fall back to the in-app copyable message until they reconnect.
 */
export async function POST() {
  const user = await requireUser();
  if (!user) {
    return NextResponse.json({ error: "Not logged in" }, { status: 401 });
  }
  await prisma.user.update({
    where: { id: user.id },
    data: {
      googleEmail: null,
      googleAccessToken: null,
      googleRefreshToken: null,
      googleTokenExpiry: null,
      gmailSendGranted: false,
    },
  });
  return NextResponse.json({ ok: true });
}
