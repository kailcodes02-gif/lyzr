import { NextResponse } from "next/server";
import { getRecord, listRecords } from "@/lib/store";
import type { LeadRecord } from "@/lib/store";

export const runtime = "nodejs";

/**
 * GET /api/admin/leads — list every signup (newest first).
 *   ?format=csv     spreadsheet export
 *   ?id=<sessionId> full record (intake + assessment) for one signup
 *
 * Protected by ADMIN_TOKEN. Pass it as `Authorization: Bearer <token>`,
 * `x-admin-token: <token>`, or `?token=<token>`. If ADMIN_TOKEN is unset the
 * endpoint is disabled (404) so it can never be left wide open by accident.
 */
function row(r: LeadRecord) {
  const q = r.intake?.quick;
  const a = r.assessment;
  const industry = q?.company?.industry === "other" ? q?.company?.industryOther || "Other" : (q?.company?.industry ?? "");
  const nearTerm = a ? a.opportunities.filter((o) => o.lane !== "not_now").reduce((s, o) => s + o.annualValueUSD, 0) : 0;
  return {
    email: r.email,
    domain: r.domain,
    company: q?.company?.name ?? "",
    industry,
    size: q?.company?.size ?? "",
    country: q?.market?.countryName ?? "",
    functions: (q?.functions ?? []).join("|"),
    priorityPain: q?.priorityPain ?? "",
    maturityStage: a?.maturityStage ?? "",
    maturityScore: a?.maturityScore ?? "",
    agents: a?.opportunities?.length ?? 0,
    moneySaved: nearTerm,
    extraUseCases: (q?.extraUseCases ?? []).length,
    customRequests: (q?.customRequests ?? []).length,
    deepened: (r.intake?.completedDeepen ?? []).length,
    completedAssessment: a ? "yes" : "no",
    createdAt: new Date(r.createdAt).toISOString(),
    updatedAt: new Date(r.updatedAt).toISOString(),
    sessionId: r.id,
  };
}

export async function GET(req: Request) {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const url = new URL(req.url);
  const provided =
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    req.headers.get("x-admin-token") ??
    url.searchParams.get("token") ??
    "";
  if (provided !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Full record for one signup (intake + assessment).
  const id = url.searchParams.get("id");
  if (id) {
    const rec = await getRecord(id);
    if (!rec) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ record: rec });
  }

  const records = await listRecords();
  const rows = records.map(row);

  if (url.searchParams.get("format") === "csv") {
    const headers = Object.keys(rows[0] ?? { email: "" });
    const escape = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = [
      headers.join(","),
      ...rows.map((r) => headers.map((h) => escape((r as Record<string, unknown>)[h])).join(",")),
    ].join("\n");
    return new NextResponse(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="leads.csv"`,
      },
    });
  }

  return NextResponse.json({ count: rows.length, leads: rows });
}
