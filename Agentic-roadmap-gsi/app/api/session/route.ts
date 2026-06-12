import { NextResponse } from "next/server";
import { createRecord } from "@/lib/store";
import { EMAIL_RE, isFreeEmail } from "@/lib/email";
import type { IntakeData } from "@/lib/types";

export const runtime = "nodejs";

const MESSAGES: Record<string, string> = {
  domain_daily:
    "Your organization has reached its limit of 10 assessments today. Please try again tomorrow.",
  email_daily:
    "You've reached the limit of 2 assessments per day for this email. Please try again tomorrow.",
  email_weekly:
    "You've reached the limit of 5 assessments this week for this email. Please try again next week.",
};

export async function POST(req: Request) {
  let body: { email?: string; intake?: IntakeData };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const email = (body.email ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "Please enter a valid work email." }, { status: 400 });
  }
  if (isFreeEmail(email)) {
    return NextResponse.json(
      { error: "Please use your work email — personal providers like Gmail, Outlook, and Yahoo aren't supported." },
      { status: 400 },
    );
  }
  if (!body.intake) {
    return NextResponse.json({ error: "Missing intake." }, { status: 400 });
  }

  const res = await createRecord(email, body.intake);
  if (!res.ok) {
    return NextResponse.json(
      { error: MESSAGES[res.reason ?? ""] ?? "Assessment limit reached.", reason: res.reason },
      { status: 429 },
    );
  }

  return NextResponse.json({ sessionId: res.id });
}
