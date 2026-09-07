import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getValidAccessToken } from "@/lib/google/oauth";
import { searchContactSuggestions, listFrequentContacts } from "@/lib/google/gmail";
import { withErrorHandling } from "@/lib/api/with-error-handling";

// GET ?q=<partial>      → typed-prefix search (existing autosuggest)
// GET ?frequent=1       → broad pull of who the user actually emails most,
//                         no typed query needed — "suggest from my inbox"
export const GET = withErrorHandling(async (request: NextRequest) => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let accessToken: string;
  try {
    accessToken = await getValidAccessToken(user.id);
  } catch (err) {
    console.error("gmail/contacts: failed to get access token:", err);
    return NextResponse.json({
      suggestions: [],
      gmailConnected: false,
      error: err instanceof Error ? err.message : "Gmail isn't connected.",
    });
  }

  try {
    const frequent = request.nextUrl.searchParams.get("frequent");
    if (frequent) {
      const suggestions = await listFrequentContacts(accessToken);
      return NextResponse.json({ suggestions });
    }

    const query = request.nextUrl.searchParams.get("q") ?? "";
    const suggestions = await searchContactSuggestions(accessToken, query);
    return NextResponse.json({ suggestions });
  } catch (err) {
    console.error("gmail/contacts: search failed:", err);
    return NextResponse.json({
      suggestions: [],
      gmailConnected: true,
      error: err instanceof Error ? err.message : "Gmail search failed.",
    });
  }
});
