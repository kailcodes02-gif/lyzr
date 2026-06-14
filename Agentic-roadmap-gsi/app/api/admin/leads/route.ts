import { NextResponse } from "next/server";
import { listRecords } from "@/lib/store";

export const runtime = "nodejs";

/**
 * GET /api/admin/leads — list every signup (newest first).
 *
 * Protected by ADMIN_TOKEN. Pass it as `Authorization: Bearer <token>`,
 * `x-admin-token: <token>`, or `?token=<token>`. If ADMIN_TOKEN is unset the
 * endpoint is disabled (404) so it can never be left wide open by accident.
 *
 * `?format=csv` returns a spreadsheet-friendly export; default is JSON.
 */
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

  const records = await listRecords();
  const rows = records.map((r) => ({
    email: r.email,
    domain: r.domain,
    company: r.intake?.quick?.company?.name ?? "",
    industry: r.intake?.quick?.company?.industry ?? "",
    size: r.intake?.quick?.company?.size ?? "",
    priorityPain: r.intake?.quick?.priorityPain ?? "",
    maturityStage: r.assessment?.maturityStage ?? "",
    maturityScore: r.assessment?.maturityScore ?? "",
    completedAssessment: r.assessment ? "yes" : "no",
    createdAt: new Date(r.createdAt).toISOString(),
    sessionId: r.id,
  }));

  if (url.searchParams.get("format") === "csv") {
    const headers = Object.keys(rows[0] ?? { email: "" });
    const escape = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = [
      headers.join(","),
      ...rows.map((row) => headers.map((h) => escape((row as Record<string, unknown>)[h])).join(",")),
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
