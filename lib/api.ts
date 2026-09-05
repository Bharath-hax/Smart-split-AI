import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";

/**
 * Standard JSON error response.
 */
export function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * Resolve the logged-in user or return a 401 response.
 * Usage: `const auth = await authGuard(); if ("response" in auth) return auth.response;`
 */
export async function authGuard(): Promise<
  { user: NonNullable<Awaited<ReturnType<typeof requireUser>>> } | { response: NextResponse }
> {
  const user = await requireUser();
  if (!user) return { response: jsonError("Not signed in", 401) };
  return { user };
}

/**
 * Verify the user is a member of the given group; return the membership or null.
 */
export async function isMember(userId: string, groupId: string) {
  try {
    return await prisma.membership.findUnique({
      where: { groupId_userId: { groupId, userId } },
    });
  } catch {
    return null;
  }
}
