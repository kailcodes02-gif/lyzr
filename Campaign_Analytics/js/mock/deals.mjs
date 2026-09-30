// Demo HubSpot deals: ~60 made-up GSI/SI conversations across ~15 partners, generated
// deterministically (seeded PRNG) in the shape of ca_hs_deals / ca_hs_deal_history
// (supabase/004_deals.sql). Deal names, amounts and dates are invented; the partners are
// the GSI account names the rest of the demo uses. mock.mjs serves `dealsGet` for
// GET hubspot/deals and `dealsSyncPost` for POST hubspot/deals-sync.
import { kpis } from '../lib/pipeline-agg.mjs';

// ---- seeded PRNG ---------------------------------------------------------------------------
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const rnd = mulberry32(20261001);
const pick = arr => arr[Math.floor(rnd() * arr.length)];
const weighted = pairs => { const tot = pairs.reduce((a, p) => a + p[1], 0); let r = rnd() * tot; for (const [v, w] of pairs) { r -= w; if (r <= 0) return v; } return pairs[pairs.length - 1][0]; };
const between = (a, b) => new Date(a + (b - a) * rnd());
const iso = d => d.toISOString();
const day = d => d.toISOString().slice(0, 10);

// ---- vocab ----------------------------------------------------------------------------------
const PARTNERS = [['Accenture', 18], ['Deloitte', 5], ['Tata Consultancy Services', 5], ['Infosys', 4], ['Wipro', 4], ['KPMG', 3], ['EY', 3], ['PwC', 3], ['Capgemini', 3], ['Cognizant', 3], ['HCLTech', 2], ['Tech Mahindra', 2], ['LTIMindtree', 2], ['Genpact', 2], ['McKinsey & Company', 1]];
const TOPICS = ['Agentic support desk for a retail bank', 'Claims triage agents', 'KYC document agents', 'Sales research copilots', 'Contract review agents for legal ops', 'Order-to-cash reconciliation agents', 'HR helpdesk automation', 'Agent studio for the innovation lab', 'Procurement intake agents', 'IT service desk deflection', 'Underwriting summaries', 'Marketing content factory', 'Field service knowledge agents', 'Finance close assistants', 'Patient intake agents for a hospital group', 'Supplier onboarding agents', 'Regulatory monitoring agents', 'Agentic commerce pilot', 'Collections outreach agents', 'Data quality agents for a telco'];
const PIPELINES = { 'p-studio': 'Studio Deals', 'p-partner': 'Partner Deals' };
const STAGES = {
  conversation: [['s-disc', 'Discovery Call'], ['s-qual', 'Qualification'], ['s-pipe', 'Pipeline'], ['s-stall', 'Stalled']],
  demo: [['s-sol', 'Solution Validation'], ['s-prop', 'Proposal'], ['s-neg', 'Negotiation'], ['s-legal', 'Legal & Contracts'], ['s-best', 'Best Case'], ['s-commit', 'Commit']],
  won: [['s-won', 'Closed Won']],
  lost: [['s-lost', 'Closed Lost']],
};
const STAGE_LABEL = Object.fromEntries(Object.values(STAGES).flat());
const MOTIONS = [['newbusiness', 'New Business', 55], ['Land & Expand', 'Expansion', 20], ['Partnership', 'Partnership', 15], ['POC', 'POC', 10]];
const FORECAST = { conversation: [['Pipeline', 6], ['Not forecasted', 3], ['Nurture', 1]], demo: [['Best case', 4], ['Commit', 3], ['Upside', 2], ['Pipeline', 1]], won: [['Closed won', 1]], lost: [['Stalled/Lost', 1]] };
const AMOUNTS = [[0, 3], [50000, 3], [100000, 4], [150000, 2], [250000, 4], [500000, 1]];

const T0 = Date.parse('2026-06-01T00:00:00Z'), T1 = Date.parse('2026-09-28T00:00:00Z');
const C0 = Date.parse('2026-07-01T00:00:00Z'), C1 = Date.parse('2027-06-30T00:00:00Z');
const H0 = Date.parse('2026-08-01T00:00:00Z'), H1 = Date.parse('2026-09-30T00:00:00Z');
const SYNCED = '2026-09-30T01:34:12.000Z';

function build() {
  const deals = [];
  let n = 0;
  for (const [partner, count] of PARTNERS) {
    for (let i = 0; i < count; i++) {
      n++;
      const bucket = weighted([['conversation', 24], ['demo', 16], ['won', 12], ['lost', 8]]);
      const [stage, stage_label] = pick(STAGES[bucket]);
      const [dealtype, motion_label] = weighted(MOTIONS.map(m => [m, m[2]]));
      const pipeline = partner === 'Accenture' || rnd() < 0.3 ? 'p-studio' : 'p-partner';
      const created = between(T0, T1);
      const close = bucket === 'won' || bucket === 'lost' ? between(Math.max(C0, created.getTime()), Math.min(C1, H1)) : between(Math.max(C0, created.getTime() + 20 * 864e5), C1);
      const amount = weighted(AMOUNTS);
      const topic = TOPICS[(n * 7) % TOPICS.length];
      deals.push({
        hs_id: String(90000 + n), name: `${topic} (${partner.split(' ')[0]})`, pipeline, pipeline_label: PIPELINES[pipeline], stage, stage_label, bucket, substage: stage_label,
        amount, close_date: day(close), created_at: iso(created), partner, company_raw: partner, dealtype, motion_label,
        forecast: weighted(FORECAST[bucket]), via: partner === 'Accenture' && rnd() < 0.6 ? ['gsi_property', 'company_match'] : ['company_match'],
        props: {}, synced_at: SYNCED, first_seen_at: iso(new Date(Math.max(created.getTime(), H0))), last_stage_change_at: null, prev_stage: null,
      });
    }
  }
  // History: every deal created in Aug or Sep is "new" then; some deals moved, closed or changed amount.
  const history = [];
  let hid = 0;
  const push = (h) => history.push({ id: ++hid, ...h });
  for (const d of deals) if (Date.parse(d.created_at) >= H0) push({ hs_id: d.hs_id, at: d.created_at, kind: 'new', from_value: null, to_value: d.stage_label, amount: d.amount });
  const movers = deals.filter(d => Date.parse(d.created_at) < H1 - 10 * 864e5).slice(0, 14);
  movers.forEach((d, i) => {
    const at = iso(between(Math.max(H0, Date.parse(d.created_at) + 864e5), H1));
    if (i < 8) {
      const from = d.bucket === 'won' || d.bucket === 'lost' ? pick(STAGES.demo)[1] : pick(STAGES.conversation.filter(s => s[1] !== d.stage_label))[1];
      push({ hs_id: d.hs_id, at, kind: 'stage', from_value: from, to_value: d.stage_label, amount: d.amount });
      d.prev_stage = from; d.last_stage_change_at = at;
      if (d.bucket === 'won' || d.bucket === 'lost') push({ hs_id: d.hs_id, at, kind: 'closed', from_value: 'demo', to_value: d.bucket, amount: d.amount });
    } else {
      const from = d.amount ? Math.round(d.amount * pick([0.5, 0.8, 1.5])) : 50000;
      push({ hs_id: d.hs_id, at, kind: 'amount', from_value: String(from), to_value: String(d.amount), amount: d.amount });
    }
  });
  history.sort((a, b) => (a.at < b.at ? 1 : -1));
  return { deals, history, last_sync: { id: 'dsync-demo-1', started_by: 'kailash@lyzr.ai', started_at: '2026-09-30T01:30:04.000Z', finished_at: SYNCED, status: 'done', deals: deals.length, changes: history.filter(h => h.kind !== 'new').length, error: null } };
}

export const dealsMock = build();
export const stageLabel = id => STAGE_LABEL[id] || id;

class MockError extends Error { constructor(status, message) { super(message); this.status = status; } }
const dayIST = ts => ts ? new Date(new Date(ts).getTime() + 330 * 60000).toISOString().slice(0, 10) : '';

/** Same shape as GET /api/ca/hubspot/deals: every deal, history rows with `at` in [from,to] (IST days). */
export function dealsGet(params = {}) {
  const { from = '0000', to = '9999' } = params;
  const history = dealsMock.history.filter(h => { const d = dayIST(h.at); return d >= from && d <= to; });
  return { from: params.from || null, to: params.to || null, deals: dealsMock.deals, history, last_sync: dealsMock.last_sync, kpis: kpis(dealsMock.deals) };
}

/** Two-step fake cursor flow, same shape as POST /api/ca/hubspot/deals-sync. */
export function dealsSyncPost(body = {}) {
  const cur = body.cursor;
  if (!cur) return { done: false, cursor: { step: 1 }, deals: 24, changes: 0, warnings: [], progress: { phase: 'companies', done: 12, total: 31 } };
  if (cur.step !== 1) throw new MockError(400, 'Unknown cursor');
  const now = new Date().toISOString();
  dealsMock.last_sync = { ...dealsMock.last_sync, started_at: new Date(Date.now() - 2600).toISOString(), finished_at: now, status: 'done', deals: dealsMock.deals.length, changes: 0, started_by: 'demo@lyzr.com' };
  for (const d of dealsMock.deals) d.synced_at = now;
  return { done: true, deals: dealsMock.deals.length, changes: 0, warnings: [], progress: { phase: 'done', done: 3, total: 3 } };
}
