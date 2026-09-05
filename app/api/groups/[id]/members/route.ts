import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authGuard, isMember, jsonError } from "@/lib/api";

/**
 * GET /api/groups/[id]/members — member list for payer/split pickers.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authGuard();
  if ("response" in auth) return auth.response;
  const { id } = await params;
  if (!(await isMember(auth.user.id, id))) return jsonError("Not a member", 403);

  try {
    const memberships = await prisma.membership.findMany({
      where: { groupId: id },
      include: { user: { select: { id: true, name: true } } },
    });
    return NextResponse.json({
      members: memberships.map((m) => m.user),
    });
  } catch (e) {
    return jsonError(
      `Could not load members: ${e instanceof Error ? e.message : "unknown"}`,
      500
    );
  }
}
