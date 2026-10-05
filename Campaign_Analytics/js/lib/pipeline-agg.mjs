// Pure helpers for the HubSpot pipeline view (GSI/SI conversations). No DOM, no fetch,
// so they run under `node --test` (tests/frontend/pipeline-agg.test.mjs).
// Everything here works on the row shapes of ca_hs_deals and ca_hs_deal_history
// (supabase/004_deals.sql) as returned by GET /api/ca/hubspot/deals.

export const BUCKETS = ['conversation', 'demo', 'won', 'lost'];
export const BUCKET_LABELS = { conversation: 'In conversation', demo: 'Demo', won: 'Won', lost: 'Lost' };
// Bucket colours live in the shared palette (js/palette.mjs); re-exported here for the views and tests.
import { BUCKET_COLORS } from '../palette.mjs';
export { BUCKET_COLORS };
export const MOTIONS = ['New Business', 'Expansion', 'Partnership', 'POC'];
const OPEN = new Set(['conversation', 'demo']);

export const isOpen = d => OPEN.has(d.bucket);
export const amountOf = d => Number(d.amount) || 0;
export const partnerOf = d => d.partner || 'Unknown';
export const bucketOf = d => (BUCKETS.includes(d.bucket) ? d.bucket : 'conversation');

/** Calendar day in IST for a timestamp, '' when missing. */
export const dayIST = ts => ts ? new Date(new Date(ts).getTime() + 330 * 60000).toISOString().slice(0, 10) : '';
export const inRange = (ts, from, to) => { const d = dayIST(ts); return !!d && (!from || d >= from) && (!to || d <= to); };

/** 'Q3 2026' for an ISO date or timestamp; the key sorts by time. */
export function quarterOf(iso) {
  if (!iso) return null;
  const d = new Date(String(iso).length === 10 ? iso + 'T00:00:00Z' : iso);
  if (isNaN(d.getTime())) return null;
  return `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${d.getUTCFullYear()}`;
}
export const quarterKey = q => { const m = /^Q(\d) (\d{4})$/.exec(q || ''); return m ? `${m[2]}-${m[1]}` : ''; };
/** Projected close quarter: close date, else the create date. */
export const dealQuarter = d => quarterOf(d.close_date) || quarterOf(d.created_at) || 'No date';

// ---- filters ------------------------------------------------------------------------------
const isAccenture = d => /accenture/i.test(d.partner || '');
/** mode: 'all' | 'accenture' | 'other'; partner narrows further when set. */
export function filterDeals(deals, { mode = 'all', partner = '' } = {}) {
  return deals.filter(d => (mode === 'all' || (mode === 'accenture' ? isAccenture(d) : !isAccenture(d))) && (!partner || partnerOf(d) === partner));
}
export function searchDeals(deals, q) {
  const s = String(q || '').trim().toLowerCase();
  if (!s) return deals;
  return deals.filter(d => [d.name, d.partner, d.company_raw, d.substage, d.stage_label, d.motion_label, d.forecast, d.pipeline_label].some(v => String(v || '').toLowerCase().includes(s)));
}
export function sortDeals(deals, key, dir = 1) {
  const g = { amount: amountOf, partner: partnerOf, stage: d => BUCKETS.indexOf(bucketOf(d)) + ' ' + (d.substage || ''), close_date: d => d.close_date || '', created_at: d => d.created_at || '' }[key] || (d => d[key] ?? '');
  return [...deals].sort((a, b) => { const x = g(a), y = g(b); return (x < y ? -1 : x > y ? 1 : 0) * dir || String(a.name || '').localeCompare(String(b.name || '')); });
}
export const partners = deals => [...new Set(deals.map(partnerOf))].sort((a, b) => a.localeCompare(b));

// ---- headline numbers ---------------------------------------------------------------------
export function kpis(deals) {
  const k = { total: deals.length, ongoing: 0, demos: 0, wins: 0, losses: 0, customers: 0, closed_acv: 0, open_acv: 0, open_with_amount: 0, won_with_amount: 0 };
  const customers = new Set();
  for (const d of deals) {
    const a = amountOf(d), b = bucketOf(d);
    if (OPEN.has(b)) { k.ongoing++; k.open_acv += a; if (a) k.open_with_amount++; }
    if (b === 'demo') k.demos++;
    if (b === 'won') { k.wins++; k.closed_acv += a; if (a) k.won_with_amount++; if (d.partner) customers.add(d.partner); }
    if (b === 'lost') k.losses++;
  }
  k.customers = customers.size;
  return k;
}

// ---- breakdowns (each row carries a count per bucket and a total) ---------------------------
const blank = () => Object.fromEntries(BUCKETS.map(b => [b, 0]));
function groupBy(deals, keyOf) {
  const m = new Map();
  for (const d of deals) {
    const k = keyOf(d);
    if (!m.has(k)) m.set(k, { key: k, ...blank(), total: 0, amount: 0, open_acv: 0, closed_acv: 0 });
    const r = m.get(k), b = bucketOf(d), a = amountOf(d);
    r[b]++; r.total++; r.amount += a;
    if (OPEN.has(b)) r.open_acv += a; else if (b === 'won') r.closed_acv += a;
  }
  return [...m.values()];
}
/** Deals by projected close quarter, in time order. */
export const byQuarter = deals => groupBy(deals, dealQuarter).sort((a, b) => (quarterKey(a.key) || '9999').localeCompare(quarterKey(b.key) || '9999'));
/** Top partners by deal count. */
export const byPartner = (deals, limit = 14) => groupBy(deals, partnerOf).sort((a, b) => b.total - a.total || a.key.localeCompare(b.key)).slice(0, limit);
/** By motion (dealtype label), in the report's order, then any other label. */
export function byMotion(deals) {
  const rows = groupBy(deals, d => d.motion_label || 'Direct');
  const rank = k => { const i = MOTIONS.indexOf(k); return i < 0 ? MOTIONS.length : i; };
  return rows.sort((a, b) => rank(a.key) - rank(b.key) || b.total - a.total);
}
/** Share of each bucket. */
export function stageMix(deals) {
  const g = Object.fromEntries(groupBy(deals, bucketOf).map(r => [r.key, r]));
  const total = deals.length || 1;
  return BUCKETS.map(b => ({ bucket: b, label: BUCKET_LABELS[b], count: g[b] ? g[b].total : 0, share: (g[b] ? g[b].total : 0) / total * 100, amount: g[b] ? g[b].amount : 0 }));
}
/** Sub-stages (HubSpot stage labels) grouped under their bucket, biggest first within a bucket. */
export function bySubstage(deals) {
  const m = new Map();
  for (const d of deals) {
    const k = d.substage || d.stage_label || 'Unknown stage';
    if (!m.has(k)) m.set(k, { substage: k, bucket: bucketOf(d), count: 0, amount: 0 });
    const r = m.get(k); r.count++; r.amount += amountOf(d);
  }
  return [...m.values()].sort((a, b) => BUCKETS.indexOf(a.bucket) - BUCKETS.indexOf(b.bucket) || b.count - a.count || a.substage.localeCompare(b.substage));
}
/** Closed vs open ACV by partner, top N by total money (deals without an amount are left out). */
export function acvByPartner(deals, limit = 12) {
  const m = new Map();
  for (const d of deals) {
    const a = amountOf(d); if (!a) continue;
    const b = bucketOf(d);
    if (b === 'lost') continue;
    const k = partnerOf(d);
    if (!m.has(k)) m.set(k, { partner: k, closed: 0, open: 0, total: 0 });
    const r = m.get(k);
    if (b === 'won') r.closed += a; else r.open += a;
    r.total += a;
  }
  return [...m.values()].sort((a, b) => b.total - a.total).slice(0, limit);
}

// ---- what changed --------------------------------------------------------------------------
/**
 * History rows in [from,to] (IST days) joined to their deals, grouped by kind.
 * -> { new:[], stage:[], amount:[], closed:[], counts:{new, stage, amount, won, lost, amount_delta} }
 */
export function changesIn(history, deals, from, to) {
  const byId = new Map(deals.map(d => [String(d.hs_id), d]));
  const out = { new: [], stage: [], amount: [], closed: [], counts: { new: 0, stage: 0, amount: 0, won: 0, lost: 0, amount_delta: 0 } };
  for (const h of history) {
    if (!inRange(h.at, from, to)) continue;
    const d = byId.get(String(h.hs_id)) || {};
    const row = { ...h, name: d.name || 'Deal ' + h.hs_id, partner: partnerOf(d), bucket: d.bucket || null, substage: d.substage || null, deal_amount: amountOf(d) };
    if (h.kind === 'new') { out.new.push(row); out.counts.new++; }
    else if (h.kind === 'stage') { out.stage.push(row); out.counts.stage++; }
    else if (h.kind === 'amount') { out.amount.push(row); out.counts.amount++; out.counts.amount_delta += (Number(h.to_value) || 0) - (Number(h.from_value) || 0); }
    else if (h.kind === 'closed') { out.closed.push(row); if (h.to_value === 'won') out.counts.won++; else out.counts.lost++; }
  }
  const newest = (a, b) => (a.at < b.at ? 1 : -1);
  for (const k of ['new', 'stage', 'amount', 'closed']) out[k].sort(newest);
  return out;
}
/** Change counts for the current range and the comparison range (prev = {from,to} or null). */
export function compareChanges(history, deals, from, to, prev) {
  const cur = changesIn(history, deals, from, to).counts;
  const before = prev ? changesIn(history, deals, prev.from, prev.to).counts : null;
  return { cur, prev: before };
}

// ---- Claude input ----------------------------------------------------------------------------
/** Compact aggregates for the AI read-out. */
export function insightInput(deals, history, { from, to, prev, mode, partner }) {
  const ch = changesIn(history, deals, from, to);
  return {
    range: { from, to }, filter: { mode, partner: partner || null },
    kpis: kpis(deals),
    quarters: byQuarter(deals).map(({ key, conversation, demo, won, lost, total, open_acv, closed_acv }) => ({ quarter: key, conversation, demo, won, lost, total, open_acv, closed_acv })),
    partners: byPartner(deals, 20).map(({ key, conversation, demo, won, lost, total, open_acv, closed_acv }) => ({ partner: key, conversation, demo, won, lost, total, open_acv, closed_acv })),
    motions: byMotion(deals).map(({ key, total, amount, open_acv, closed_acv, won, lost }) => ({ motion: key, total, amount, open_acv, closed_acv, won, lost })),
    substages: bySubstage(deals).map(({ substage, bucket, count, amount }) => ({ substage, bucket, count, amount })),
    changes: {
      counts: ch.counts,
      new: ch.new.slice(0, 15).map(r => ({ deal: r.name, partner: r.partner, stage: r.to_value, amount: r.amount })),
      moved: ch.stage.slice(0, 15).map(r => ({ deal: r.name, partner: r.partner, from: r.from_value, to: r.to_value, amount: r.amount })),
      closed: ch.closed.slice(0, 15).map(r => ({ deal: r.name, partner: r.partner, result: r.to_value, amount: r.amount })),
    },
    compare: compareChanges(history, deals, from, to, prev),
  };
}
