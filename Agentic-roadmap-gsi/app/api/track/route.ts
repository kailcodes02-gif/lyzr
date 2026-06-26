import { NextResponse } from "next/server";
import { mergeActivity } from "@/lib/store";
import type { Activity } from "@/lib/types";

export const runtime = "nodejs";

/**
 * POST /api/track — merge a client activity blob into a signup record.
 * Body: { sessionId, activity }. Unauthenticated (the client owns its own
 * sessionId); writes are clamped + deduped in mergeActivity, and only ever
 * touch an existing record. Does not count against limits.
 */
export async function POST(req: Request) {
  let body: { sessionId?: string; activity?: Partial<Activity> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  if (!body.sessionId || !body.activity || typeof body.activity !== "object") {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  try {
    await mergeActivity(body.sessionId, body.activity);
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
