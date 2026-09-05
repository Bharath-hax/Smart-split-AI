/**
 * Google OAuth 2.0 helper — Gmail send permission for auto reminders.
 *
 * Uses a "Web application" OAuth client. The user (bill creator) connects
 * their own Gmail from the Profile screen, granting the `gmail.send` scope
 * (plus userinfo.email so we know which address we're sending from).
 * Tokens are stored on the User row; access tokens are refreshed on demand.
 *
 * Setup (Google Cloud Console):
 *  1. Enable the Gmail API for the project.
 *  2. OAuth consent screen → add scope https://www.googleapis.com/auth/gmail.send
 *     (app stays in "Testing" mode → add your Google accounts as test users).
 *  3. Credentials → OAuth client ID (Web application) → Authorized redirect URI:
 *     {NEXT_PUBLIC_APP_URL}/api/google/callback   (e.g. http://localhost:3000/api/google/callback)
 */

export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
const USERINFO_EMAIL_SCOPE = "https://www.googleapis.com/auth/userinfo.email";

/** Treat obvious placeholder values as unset. */
function isPlaceholder(v: string | undefined): boolean {
  if (!v) return true;
  return /your_|change_me|placeholder|xxxx/i.test(v);
}

export function googleOAuthConfigured(): boolean {
  return (
    !isPlaceholder(process.env.GOOGLE_CLIENT_ID) &&
    !isPlaceholder(process.env.GOOGLE_CLIENT_SECRET)
  );
}

function appUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000")
  );
}

function redirectUri(): string {
  return `${appUrl()}/api/google/callback`;
}

/** The Google OAuth consent URL the user is redirected to. */
export function buildGoogleAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: `${GMAIL_SEND_SCOPE} ${USERINFO_EMAIL_SCOPE}`,
    // offline → refresh token; prompt=consent → re-issue refresh token even if
    // the user granted before (needed since we only get it on first consent)
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export interface GoogleTokens {
  accessToken: string;
  refreshToken?: string;
  expiresInSec: number;
  scope: string;
  googleEmail?: string;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

/** Exchange the ?code= from the OAuth callback for tokens. */
export async function exchangeCodeForTokens(code: string): Promise<GoogleTokens> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: redirectUri(),
      grant_type: "authorization_code",
    }),
  });
  const data = (await res.json()) as TokenResponse;
  if (!res.ok || !data.access_token) {
    throw new Error(
      `Google token exchange failed: ${data.error || res.status} ${data.error_description || ""}`.trim()
    );
  }
  const tokens: GoogleTokens = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresInSec: data.expires_in ?? 3600,
    scope: data.scope ?? "",
  };
  // Figure out which Gmail address we're sending from
  try {
    const ui = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });
    if (ui.ok) {
      const info = (await ui.json()) as { email?: string };
      tokens.googleEmail = info.email;
    }
  } catch {
    // non-fatal — the address is cosmetic
  }
  return tokens;
}

/** Refresh an expired access token using the stored refresh token. */
export async function refreshAccessToken(refreshToken: string): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      grant_type: "refresh_token",
    }),
  });
  const data = (await res.json()) as TokenResponse;
  if (!res.ok || !data.access_token) {
    throw new Error(
      `Google token refresh failed: ${data.error || res.status}`.trim()
    );
  }
  return data.access_token;
}

/** Does the granted scope string include gmail.send? */
export function scopeIncludesSend(scope: string): boolean {
  return scope.split(" ").includes(GMAIL_SEND_SCOPE);
}

export interface GoogleAuthUser {
  googleEmail: string | null;
  googleAccessToken: string | null;
  googleRefreshToken: string | null;
  googleTokenExpiry: Date | null;
  gmailSendGranted: boolean;
}

/**
 * Get a valid access token for the user, refreshing if needed.
 * Returns null when the user never connected Gmail.
 */
export async function getValidGoogleAccessToken(
  user: GoogleAuthUser
): Promise<string | null> {
  if (!user.googleAccessToken || !user.gmailSendGranted) return null;
  const stillValid =
    user.googleTokenExpiry && user.googleTokenExpiry.getTime() - 60_000 > Date.now();
  if (stillValid) return user.googleAccessToken;
  if (!user.googleRefreshToken) return null; // can't refresh → needs reconnect
  try {
    const fresh = await refreshAccessToken(user.googleRefreshToken);
    return fresh;
  } catch {
    return null; // refresh revoked/expired → needs reconnect
  }
}
