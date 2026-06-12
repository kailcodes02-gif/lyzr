import { NextResponse } from "next/server";
import { buildAssessment } from "@/lib/content";
import { enrichWithClaude } from "@/lib/ai";
import { getRecord, saveAssessment } from "@/lib/store";
import type { IntakeData } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Resume a saved assessment by session id (saved state per account). */
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("session");
  if (!id) return NextResponse.json({ error: "Missing session" }, { status: 400 });
  const rec = await getRecord(id);
  if (!rec || !rec.assessment) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ intake: rec.intake, assessment: rec.assessment });
}

/** Generate (or recompute on Deepen) the assessment. Does NOT count against limits. */
export async function POST(req: Request) {
  let body: { intake?: IntakeData; sessionId?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  if (!body.intake) {
    return NextResponse.json({ error: "Missing intake" }, { status: 400 });
  }

  const intake = body.intake;
  const base = buildAssessment(intake);

  let result = base;
  try {
    result = await enrichWithClaude(intake, base);
  } catch (err) {
    console.error("Claude enrichment failed, serving deterministic:", err);
    result = base;
  }

  if (body.sessionId) {
    try {
      await saveAssessment(body.sessionId, intake, result);
    } catch (err) {
      console.error("Failed to persist assessment:", err);
    }
  }

  return NextResponse.json(result);
}
