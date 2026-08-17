import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { saveGoogleConnection } from "@/lib/google/oauth";

const ALLOWED_DOMAIN = "lyzr.ai";
// Route handlers build redirect URLs manually from `origin` — unlike
// middleware's `nextUrl`, that bypasses Next's automatic basePath
// prefixing, so it has to be added explicitly here.
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

// Server-side callback (not a client component like a static-export app
// would use) because we need to capture `session.provider_refresh_token`
// synchronously from the code exchange and persist it before it's gone —
// Supabase only surfaces it once, right here.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (!code) {
    return NextResponse.redirect(`${origin}${BASE_PATH}/login?error=auth_failed`);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.session || !data.user) {
    return NextResponse.redirect(`${origin}${BASE_PATH}/login?error=auth_failed`);
  }

  const { session, user } = data;

  // The `hd` query param only nudges Google's account picker — it does not
  // enforce the domain. Verify server-side and reject anything else.
  const email = user.email ?? "";
  if (!email.toLowerCase().endsWith(`@${ALLOWED_DOMAIN}`)) {
    await supabase.auth.signOut();
    return NextResponse.redirect(`${origin}${BASE_PATH}/login?error=auth_failed`);
  }

  if (session.provider_refresh_token) {
    // Supabase doesn't echo back which scopes Google actually granted, so we
    // record the ones this login flow always requests (see app/login/page.tsx).
    const requestedScopes = [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.compose",
    ];
    try {
      await saveGoogleConnection(user.id, session.provider_refresh_token, requestedScopes);
    } catch (err) {
      console.error("Failed to persist Google connection:", err);
      // Don't block login over this — Gmail-dependent features will just
      // fail gracefully later and prompt a re-connect.
    }
  }

  return NextResponse.redirect(`${origin}${BASE_PATH}/`);
}
