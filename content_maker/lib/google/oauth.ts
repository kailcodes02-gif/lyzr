import { createServiceClient } from "@/lib/supabase/server";
import { encryptText, decryptText } from "@/lib/security/crypto";

const TOKEN_URL = "https://oauth2.googleapis.com/token";

interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  token_type: string;
}

// Called once, from the auth callback, right after Google issues a
// provider_refresh_token (access_type=offline + prompt=consent at login).
// Supabase does not persist or auto-refresh this for us — we own it from here on.
export async function saveGoogleConnection(
  userId: string,
  refreshToken: string,
  scopes: string[]
) {
  const supabase = await createServiceClient();
  const { error } = await supabase.from("google_connections").upsert({
    user_id: userId,
    encrypted_refresh_token: encryptText(refreshToken),
    scopes,
    connected_at: new Date().toISOString(),
  });
  if (error) throw new Error(`Failed to save Google connection: ${error.message}`);
}

async function refreshAccessToken(refreshToken: string): Promise<GoogleTokenResponse> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET are not set");
  }

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Google token refresh failed: ${response.status} - ${errorText}`);
  }

  return response.json();
}

// Mints a fresh short-lived Gmail access token for this user on demand.
// Access tokens aren't cached/stored — they expire in ~1hr, so we just
// refresh on every server-side Gmail call rather than tracking expiry.
export async function getValidAccessToken(userId: string): Promise<string> {
  const supabase = await createServiceClient();
  const { data, error } = await supabase
    .from("google_connections")
    .select("encrypted_refresh_token")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error(`Failed to load Google connection: ${error.message}`);
  if (!data) throw new Error("No Google connection found for this user — please sign in again.");

  const refreshToken = decryptText(data.encrypted_refresh_token);
  const tokens = await refreshAccessToken(refreshToken);
  return tokens.access_token;
}
