import { NextRequest, NextResponse } from "next/server";

// Every route handler in this app is wrapped in this — an uncaught throw
// inside a route handler otherwise bubbles up as an empty/HTML response
// (Next's default error page), which breaks `await res.json()` on the
// client with a confusing "Unexpected end of JSON input" instead of showing
// the real error.
export function withErrorHandling(
  handler: (request: NextRequest) => Promise<NextResponse>
) {
  return async (request: NextRequest): Promise<NextResponse> => {
    try {
      return await handler(request);
    } catch (err) {
      console.error(err);
      const message = err instanceof Error ? err.message : "Unexpected error";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  };
}
