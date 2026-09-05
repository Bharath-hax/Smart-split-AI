import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";

const COOKIE_NAME = "ss_session";
const DEV_SECRET = "dev_only_fallback_secret";

/**
 * Get the session signing secret from env (falls back to a dev-only value).
 */
function secret(): string {
  return process.env.SESSION_SECRET || DEV_SECRET;
}

/**
 * Create a signed session token for a user id: "<userId>.<hmac>".
 */
export function signSession(userId: string): string {
  const sig = createHmac("sha256", secret()).update(userId).digest("hex");
  return `${userId}.${sig}`;
}

/**
 * Verify a signed session token and return the userId, or null if invalid.
 */
export function verifySession(token: string | undefined | null): string | null {
  if (!token) return null;
  const idx = token.lastIndexOf(".");
  if (idx <= 0) return null;
  const userId = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  const expected = createHmac("sha256", secret()).update(userId).digest("hex");
  try {
    if (
      sig.length === expected.length &&
      timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
    ) {
      return userId;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Set the session cookie for a user (httpOnly, 30 days).
 */
export async function setSessionCookie(userId: string): Promise<void> {
  const store = await cookies();
  store.set(COOKIE_NAME, signSession(userId), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  });
}

/**
 * Clear the session cookie (logout).
 */
export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

/**
 * Get the currently logged-in user (or null). Verifies the cookie signature
 * and loads the user from the DB.
 */
export async function getCurrentUser() {
  const store = await cookies();
  const userId = verifySession(store.get(COOKIE_NAME)?.value);
  if (!userId) return null;
  try {
    return await prisma.user.findUnique({ where: { id: userId } });
  } catch {
    return null;
  }
}

/**
 * Get the current user or throw a 401-style error for API routes.
 * Returns the user or null — callers decide how to respond.
 */
export async function requireUser() {
  return getCurrentUser();
}
