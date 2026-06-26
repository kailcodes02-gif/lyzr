"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, Download, Loader2, RefreshCw, Search, X } from "lucide-react";
import { Logo } from "@/components/ui";
import { formatUSD } from "@/lib/utils";
import { FUNCTIONS } from "@/lib/content";
import type { Activity, Assessment, IntakeData, Lane } from "@/lib/types";

type LeadRow = {
  email: string;
  domain: string;
  company: string;
  industry: string;
  size: string;
  country: string;
  functions: string;
  priorityPain: string;
  maturityStage: string;
  maturityScore: number | string;
  agents: number;
  moneySaved: number;
  extraUseCases: number;
  customRequests: number;
  deepened: number;
  completedAssessment: string;
  source: string;
  screensVisited: number;
  viewedBlueprint: string;
  createdAt: string;
  updatedAt: string;
  sessionId: string;
};

type FullRecord = {
  id: string;
  email: string;
  domain: string;
  createdAt: number;
  updatedAt: number;
  intake: IntakeData;
  assessment?: Assessment;
  activity?: Activity;
};

const funcLabel = (v: string) => FUNCTIONS.find((f) => f.value === v)?.label ?? v;
const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
};

export default function AdminPage() {
  const [token, setToken] = useState<string | null>(null);
  const [tokenInput, setTokenInput] = useState("");
  const [leads, setLeads] = useState<LeadRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [detail, setDetail] = useState<FullRecord | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async (tok: string) => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/admin/leads", { headers: { authorization: `Bearer ${tok}` } });
      if (r.status === 401) {
        setError("Invalid admin token.");
        setToken(null);
        try {
          sessionStorage.removeItem("admin_token");
        } catch {}
        setLoading(false);
        return;
      }
      if (r.status === 404) {
        setError("Admin endpoint is disabled — set the ADMIN_TOKEN env var on the deployment.");
        setLoading(false);
        return;
      }
      const d = (await r.json()) as { leads?: LeadRow[] };
      setLeads(d.leads ?? []);
    } catch {
      setError("Network error.");
    }
    setLoading(false);
  }, []);

  // Pick up a saved token or one passed via ?token=.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URLSearchParams(window.location.search);
    const fromUrl = url.get("token");
    let tok: string | null = null;
    try {
      tok = fromUrl || sessionStorage.getItem("admin_token");
    } catch {
      tok = fromUrl;
    }
    if (tok) {
      try {
        sessionStorage.setItem("admin_token", tok);
      } catch {}
      setToken(tok);
      load(tok);
    }
  }, [load]);

  function submitToken() {
    const t = tokenInput.trim();
    if (!t) return;
    try {
      sessionStorage.setItem("admin_token", t);
    } catch {}
    setToken(t);
    load(t);
  }

  async function openDetail(sessionId: string) {
    if (!token) return;
    setDetailLoading(true);
    setDetail(null);
    try {
      const r = await fetch(`/api/admin/leads?id=${encodeURIComponent(sessionId)}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (r.ok) {
        const d = (await r.json()) as { record?: FullRecord };
        if (d.record) setDetail(d.record);
      }
    } catch {
      /* ignore */
    }
    setDetailLoading(false);
  }

  const filtered = useMemo(() => {
    if (!leads) return [];
    const q = query.trim().toLowerCase();
    if (!q) return leads;
    return leads.filter((l) =>
      [l.email, l.company, l.domain, l.country, l.industry, l.functions, l.source].some((v) =>
        String(v).toLowerCase().includes(q),
      ),
    );
  }, [leads, query]);

  const completedCount = useMemo(() => (leads ?? []).filter((l) => l.completedAssessment === "yes").length, [leads]);

  /* ---- token gate ---- */
  if (!token) {
    return (
      <main className="grid min-h-screen place-items-center px-6">
        <div className="w-full max-w-sm">
          <Logo className="mb-6" />
          <h1 className="font-display text-xl font-semibold text-fg">Admin · Signups</h1>
          <p className="mt-1 text-sm text-muted">Enter the admin token to view signups.</p>
          <input
            type="password"
            autoFocus
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitToken()}
            placeholder="ADMIN_TOKEN"
            className="mt-4 h-11 w-full rounded-xl border border-border-strong bg-surface-2 px-3.5 text-sm text-fg outline-none transition-colors placeholder:text-faint focus:border-accent/60"
          />
          <button
            onClick={submitToken}
            className="mt-3 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-ink text-sm font-semibold text-white transition-all hover:bg-[#3a322c]"
          >
            View signups <ArrowRight className="h-4 w-4" />
          </button>
          {error && <p className="mt-3 text-xs text-critical">{error}</p>}
        </div>
      </main>
    );
  }

  /* ---- dashboard ---- */
  return (
    <main className="mx-auto max-w-7xl px-5 pb-24">
      <header className="flex flex-wrap items-center justify-between gap-3 py-6">
        <div className="flex items-center gap-3">
          <Logo />
          <span className="hidden h-5 w-px bg-border sm:block" />
          <span className="font-display text-sm font-medium text-muted">Signups</span>
          {leads && (
            <span className="rounded-full border border-border-strong px-2.5 py-0.5 text-xs text-muted">
              {leads.length} total · {completedCount} completed
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search email, company, country…"
              className="h-9 w-56 rounded-full border border-border-strong bg-surface-2 pl-8 pr-3 text-sm text-fg outline-none transition-colors placeholder:text-faint focus:border-accent/60"
            />
          </div>
          <button
            onClick={() => token && load(token)}
            className="grid h-9 w-9 place-items-center rounded-full border border-border-strong text-muted transition-all hover:border-accent/50 hover:text-accent"
            title="Refresh"
          >
            <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
          </button>
          <a
            href={`/api/admin/leads?format=csv&token=${encodeURIComponent(token)}`}
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border-strong px-3.5 text-sm font-medium text-fg transition-all hover:border-accent/50 hover:text-accent"
          >
            <Download className="h-4 w-4" /> CSV
          </a>
        </div>
      </header>

      {error && <p className="mb-4 text-sm text-critical">{error}</p>}

      {loading && !leads ? (
        <div className="flex items-center gap-3 py-20 text-muted">
          <Loader2 className="h-5 w-5 animate-spin text-accent" /> Loading signups…
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-surface">
          <table className="w-full min-w-[920px] text-left text-sm">
            <thead>
              <tr className="border-b border-border text-[0.7rem] uppercase tracking-wide text-faint">
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Company</th>
                <th className="px-4 py-3 font-medium">Industry</th>
                <th className="px-4 py-3 font-medium">Country</th>
                <th className="px-4 py-3 font-medium">Source</th>
                <th className="px-4 py-3 font-medium">Functions</th>
                <th className="px-4 py-3 font-medium">Maturity</th>
                <th className="px-4 py-3 text-right font-medium">Agents</th>
                <th className="px-4 py-3 text-right font-medium">Money saved</th>
                <th className="px-4 py-3 text-center font-medium">Done</th>
                <th className="px-4 py-3 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((l) => (
                <tr
                  key={l.sessionId}
                  onClick={() => openDetail(l.sessionId)}
                  className="cursor-pointer border-b border-border transition-colors last:border-0 hover:bg-surface-2/50"
                >
                  <td className="px-4 py-3 font-medium text-fg">{l.email}</td>
                  <td className="px-4 py-3 text-muted">{l.company || "—"}</td>
                  <td className="px-4 py-3 text-muted">{l.industry || "—"}</td>
                  <td className="px-4 py-3 text-muted">{l.country || "—"}</td>
                  <td className="px-4 py-3 text-muted">{l.source || "direct"}</td>
                  <td className="px-4 py-3 text-muted">
                    {l.functions ? l.functions.split("|").map(funcLabel).join(", ") : "—"}
                  </td>
                  <td className="px-4 py-3 text-muted">
                    {l.maturityStage ? `${l.maturityStage} (${l.maturityScore})` : "—"}
                  </td>
                  <td className="num px-4 py-3 text-right text-muted">{l.agents || "—"}</td>
                  <td className="num px-4 py-3 text-right font-medium text-accent">
                    {l.moneySaved ? `${formatUSD(l.moneySaved)}/yr` : "—"}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={l.completedAssessment === "yes" ? "text-build" : "text-faint"}>
                      {l.completedAssessment === "yes" ? "✓" : "—"}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-faint">{fmtDate(l.createdAt)}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-4 py-16 text-center text-sm text-faint">
                    {leads && leads.length ? "No signups match your search." : "No signups yet."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {(detail || detailLoading) && (
        <LeadDetail record={detail} loading={detailLoading} onClose={() => setDetail(null)} />
      )}
    </main>
  );
}

/* ------------------------------------------------------------------ */
/* Detail drawer                                                      */
/* ------------------------------------------------------------------ */

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  if (v === "" || v == null) return null;
  return (
    <div className="flex justify-between gap-4 py-1 text-sm">
      <span className="shrink-0 text-faint">{k}</span>
      <span className="text-right text-fg">{v}</span>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-border py-3">
      <div className="mb-1 text-[0.7rem] font-semibold uppercase tracking-wide text-accent">{title}</div>
      {children}
    </div>
  );
}

const LANE_NAME: Record<Lane, string> = { build_now: "Build Now", fix_first: "Fix Next", not_now: "Not Now" };

function LeadDetail({ record, loading, onClose }: { record: FullRecord | null; loading: boolean; onClose: () => void }) {
  const q = record?.intake?.quick;
  const a = record?.assessment;
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 animate-fade bg-ink/30 backdrop-blur-[2px]" onClick={onClose} />
      <div className="animate-slide-in absolute right-0 top-0 flex h-full w-full max-w-lg flex-col border-l border-border bg-surface shadow-2xl">
        <div className="flex items-start justify-between border-b border-border px-6 py-4">
          <div className="min-w-0">
            <div className="truncate font-display text-base font-semibold text-fg">{record?.email ?? "Loading…"}</div>
            {record && (
              <div className="text-xs text-faint">
                Created {fmtDate(new Date(record.createdAt).toISOString())} · Updated{" "}
                {fmtDate(new Date(record.updatedAt).toISOString())}
              </div>
            )}
          </div>
          <button onClick={onClose} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading || !record || !q ? (
            <div className="flex items-center gap-2 py-10 text-muted">
              <Loader2 className="h-4 w-4 animate-spin text-accent" /> Loading…
            </div>
          ) : (
            <>
              <a
                href={`/roadmap?s=${encodeURIComponent(record.id)}`}
                target="_blank"
                rel="noreferrer"
                className="mb-2 inline-flex h-9 items-center gap-1.5 rounded-full bg-ink px-4 text-sm font-semibold text-white transition-all hover:bg-[#3a322c]"
              >
                Open their roadmap <ArrowRight className="h-4 w-4" />
              </a>

              <Group title="Activity (lifetime)">
                <Row k="Screens visited" v={record.activity?.screens?.length ? record.activity.screens.join(", ") : "—"} />
                <Row
                  k="Blueprints viewed"
                  v={record.activity?.blueprints?.length ? record.activity.blueprints.join(", ") : "none"}
                />
                <Row
                  k="UTM / source"
                  v={
                    record.activity && Object.keys(record.activity.utm ?? {}).length
                      ? Object.entries(record.activity.utm)
                          .map(([k, val]) => `${k.replace(/^utm_/, "")}=${val}`)
                          .join(" · ")
                      : record.activity?.referrer
                        ? `referrer: ${record.activity.referrer}`
                        : "direct / unknown"
                  }
                />
                {record.activity && (
                  <Row
                    k="Seen"
                    v={`${fmtDate(new Date(record.activity.firstSeen).toISOString())} → ${fmtDate(new Date(record.activity.lastSeen).toISOString())}`}
                  />
                )}
              </Group>

              <Group title="Profile">
                <Row k="Company" v={q.company.name} />
                <Row k="Industry" v={q.company.industry === "other" ? q.company.industryOther || "Other" : q.company.industry} />
                <Row k="Size" v={q.company.size} />
                <Row k="Market" v={q.market ? `${q.market.countryName} (×${q.market.mult})` : ""} />
                <Row k="Priority pain" v={q.priorityPain} />
              </Group>

              {q.processFreeText && (
                <Group title="Process to automate (free-text)">
                  <p className="text-sm leading-relaxed text-muted">{q.processFreeText}</p>
                </Group>
              )}

              <Group title="Functions chosen">
                <p className="text-sm text-fg">{q.functions.map(funcLabel).join(", ") || "—"}</p>
              </Group>

              {(q.extraUseCases.length > 0 || q.customRequests.length > 0 || (record.intake.completedDeepen?.length ?? 0) > 0) && (
                <Group title="Engagement">
                  <Row k="Catalog use cases added" v={q.extraUseCases.length || ""} />
                  <Row k="Custom requests" v={q.customRequests.length ? q.customRequests.join("; ") : ""} />
                  <Row k="Dimensions deepened" v={record.intake.completedDeepen?.length || ""} />
                </Group>
              )}

              <Group title="Data & tech">
                <Row k="Data location" v={(q.data.location ?? []).join(", ")} />
                <Row k="Data structure" v={q.data.structure} />
                <Row k="Data quality" v={q.data.quality} />
                <Row k="Systems" v={(q.tech.systems ?? []).join(", ")} />
                <Row k="Deployment" v={q.tech.deployment} />
                <Row k="Existing AI" v={q.tech.existingAI} />
              </Group>

              <Group title="Team & strategy">
                <Row k="Team size" v={q.team.size} />
                <Row k="Skill mix" v={q.team.skill} />
                <Row k="AI experience" v={q.team.aiExperience} />
                <Row k="Timeline" v={q.strategy.timeline} />
                <Row k="Budget" v={q.strategy.budget} />
                <Row k="Compliance" v={q.governance.compliance} />
              </Group>

              <Group title="Reality-check gates">
                <Row k="Champion" v={q.gates.champion} />
                <Row k="Use case" v={q.gates.useCase} />
                <Row k="Data sources" v={q.gates.dataSources} />
                <Row k="Success metric" v={q.gates.successMetric} />
              </Group>

              {a ? (
                <Group title="Roadmap generated">
                  <Row k="Maturity" v={`${a.maturityStage} (${a.maturityScore}/100)`} />
                  <Row k="Source" v={a.source} />
                  <Row k="Total agents" v={a.opportunities.length} />
                  <div className="mt-2 space-y-1.5">
                    {(["build_now", "fix_first", "not_now"] as Lane[]).map((lane) => {
                      const items = a.opportunities.filter((o) => o.lane === lane);
                      if (!items.length) return null;
                      return (
                        <div key={lane} className="rounded-lg border border-border bg-surface-2/40 p-2.5">
                          <div className="mb-1 text-xs font-medium text-fg">
                            {LANE_NAME[lane]} ({items.length})
                          </div>
                          {items.map((o) => (
                            <div key={o.id} className="flex justify-between gap-3 text-xs text-muted">
                              <span className="truncate">{o.name}</span>
                              <span className="num shrink-0 text-accent">{formatUSD(o.annualValueUSD)}/yr</span>
                            </div>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                </Group>
              ) : (
                <Group title="Roadmap generated">
                  <p className="text-sm text-faint">No roadmap generated — they didn&apos;t complete the assessment.</p>
                </Group>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
