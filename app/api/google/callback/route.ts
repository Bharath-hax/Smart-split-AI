import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import {
  exchangeCodeForTokens,
  scopeIncludesSend,
} from "@/lib/google-auth";

/**
 * GET /api/google/callback — Google redirects back here after consent.
 * Exchanges the code for tokens, stores them on the User row, then sends
 * the user back to their Profile with a status flag.
 */
export async function GET(req: NextRequest) {
  const user = await requireUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  const url = new URL(req.url);
  const error = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  if (error || !code) {
    // e.g. user cancelled the consent screen
    return NextResponse.redirect(
      new URL(`/profile?gmail=denied${error ? `&reason=${error}` : ""}`, req.url)
    );
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    const granted = scopeIncludesSend(tokens.scope);
    await prisma.user.update({
      where: { id: user.id },
      data: {
        googleEmail: tokens.googleEmail ?? null,
        googleAccessToken: tokens.accessToken,
        googleRefreshToken: tokens.refreshToken ?? user.googleRefreshToken, // Google only re-issues refresh tokens on prompt=consent
        googleTokenExpiry: new Date(Date.now() + tokens.expiresInSec * 1000),
        gmailSendGranted: granted,
      },
    });
    return NextResponse.redirect(
      new URL(`/profile?gmail=${granted ? "connected" : "no-send-scope"}`, req.url)
    );
  } catch {
    return NextResponse.redirect(new URL("/profile?gmail=error", req.url));
  }
}
