import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { jsonError, authGuard } from "@/lib/api";

/**
 * POST /api/groups/join — join a group by its 6-character share code.
 */
export async function POST(req: NextRequest) {
  const auth = await authGuard();
  if ("response" in auth) return auth.response;
  try {
    const { code } = await req.json();
    if (!code?.trim()) return jsonError("Group code is required");

    const group = await prisma.group.findUnique({
      where: { code: code.trim().toUpperCase() },
    });
    if (!group) return jsonError("No group found with that code", 404);

    await prisma.membership.upsert({
      where: { groupId_userId: { groupId: group.id, userId: auth.user.id } },
      update: {},
      create: { groupId: group.id, userId: auth.user.id },
    });

    // Only log the join activity the first time
    const existingActivity = await prisma.activity.findFirst({
      where: { groupId: group.id, type: "join", actorId: auth.user.id },
    });
    if (!existingActivity) {
      await prisma.activity.create({
        data: {
          groupId: group.id,
          type: "join",
          actorId: auth.user.id,
          message: `${auth.user.name} joined the group`,
        },
      });
    }

    return NextResponse.json({ group: { id: group.id, name: group.name, code: group.code } });
  } catch (e) {
    return jsonError(
      `Could not join group: ${e instanceof Error ? e.message : "unknown"}`,
      500
    );
  }
}
