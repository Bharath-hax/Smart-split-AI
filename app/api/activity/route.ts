import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authGuard, isMember, jsonError } from "@/lib/api";

/**
 * GET /api/activity?groupId=...&limit=... — chronological feed for a group
 * ("X paid for Y", "Z settled ₹500 with A", ...). Polled by the UI for the
 * live feel.
 */
export async function GET(req: NextRequest) {
  const auth = await authGuard();
  if ("response" in auth) return auth.response;
  const groupId = req.nextUrl.searchParams.get("groupId");
  if (!groupId) return jsonError("groupId is required");
  if (!(await isMember(auth.user.id, groupId))) return jsonError("Not a member", 403);

  try {
    const limit = Math.min(
      Number(req.nextUrl.searchParams.get("limit")) || 30,
      100
    );
    const activities = await prisma.activity.findMany({
      where: { groupId },
      include: { actor: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return NextResponse.json({ activities });
  } catch (e) {
    return jsonError(
      `Could not load activity: ${e instanceof Error ? e.message : "unknown"}`,
      500
    );
  }
}
