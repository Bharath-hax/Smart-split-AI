import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { jsonError, authGuard } from "@/lib/api";
import { generateGroupCode } from "@/lib/utils";

/**
 * GET /api/groups — list the signed-in user's groups with member/bill counts.
 */
export async function GET() {
  const auth = await authGuard();
  if ("response" in auth) return auth.response;
  try {
    const memberships = await prisma.membership.findMany({
      where: { userId: auth.user.id },
      include: {
        group: {
          include: {
            _count: { select: { members: true, bills: true } },
          },
        },
      },
      orderBy: { joinedAt: "desc" },
    });
    return NextResponse.json({
      groups: memberships.map((m) => ({
        id: m.group.id,
        name: m.group.name,
        code: m.group.code,
        role: m.role,
        memberCount: m.group._count.members,
        billCount: m.group._count.bills,
      })),
    });
  } catch (e) {
    return jsonError(
      `Could not load groups: ${e instanceof Error ? e.message : "unknown"}`,
      500
    );
  }
}

/**
 * POST /api/groups — create a group (creator becomes admin, gets a share code).
 */
export async function POST(req: NextRequest) {
  const auth = await authGuard();
  if ("response" in auth) return auth.response;
  try {
    const { name } = await req.json();
    if (!name?.trim()) return jsonError("Group name is required");

    // Retry on the (unlikely) code collision
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const group = await prisma.group.create({
          data: {
            name: name.trim(),
            code: generateGroupCode(),
            createdById: auth.user.id,
            members: {
              create: { userId: auth.user.id, role: "admin" },
            },
            activities: {
              create: {
                type: "group",
                actorId: auth.user.id,
                message: `${auth.user.name} created the group “${name.trim()}”`,
              },
            },
          },
        });
        return NextResponse.json({ group: { id: group.id, name: group.name, code: group.code } });
      } catch (e) {
        const msg = String(e);
        if (!msg.includes("P2002")) throw e; // P2002 = unique constraint (code)
      }
    }
    return jsonError("Could not generate a unique group code, try again", 500);
  } catch (e) {
    return jsonError(
      `Could not create group: ${e instanceof Error ? e.message : "unknown"}`,
      500
    );
  }
}
