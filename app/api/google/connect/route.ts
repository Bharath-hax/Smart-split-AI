import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { buildGoogleAuthUrl, googleOAuthConfigured } from "@/lib/google-auth";

/**
 * GET /api/google/connect — start the OAuth flow: redirect the signed-in
 * user to Google's consent screen to grant gmail.send (+ userinfo.email).
 */
export async function GET(req: NextRequest) {
  const user = await requireUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  if (!googleOAuthConfigured()) {
    return NextResponse.redirect(
      new URL("/profile?gmail=not-configured", req.url)
    );
  }
  return NextResponse.redirect(buildGoogleAuthUrl(user.id));
}
