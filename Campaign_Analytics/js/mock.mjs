// Demo-mode API. Same surface as js/api.mjs (get/post/put/del) and the same paths as
// ARCHITECTURE.md, served from in-memory data derived from the September 2026 reports.
import { linkedinMock } from './mock/linkedin.mjs';
import { adsMock } from './mock/ads.mjs';
import { phantomGet, phantomSyncPost } from './mock/phantom.mjs';
import { dealsGet, dealsSyncPost } from './mock/deals.mjs';
import { hubspotMock } from './mock/hubspot.mjs';
import { buildEmailMock, emailPage } from './mock/email.mjs';
import { countBy, sortedEntries, clusterLabel } from './lib/leads-agg.mjs';
import { overlaps, fmt, usd, pct } from './fmt.mjs';
import { activeWindows } from './lib/linkedin-agg.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));
class MockError extends Error { constructor(status, message) { super(message); this.status = status; } }
const dayOf = ts => ts ? new Date(new Date(ts).getTime() + 330 * 60000).toISOString().slice(0, 10) : '';

export function createMockApi() {
  const seeds = {};
  const overrides = {};                                    // PUT settings
  let uploads = [...linkedinMock.uploads.map(u => ({ ...u, platform: 'linkedin' })), ...adsMock.uploads.map(u => ({ ...u }))];
  const insights = new Map();                              // scope -> {content, created_at, model}
  let lastSync = { ...hubspotMock.last_sync };
  let emailMock = null; const em = () => (emailMock = emailMock || buildEmailMock());
  let actions = [
    { id: 'a1', channel: 'email', title: 'Send the Book a Demo list from the GSI Sep sequences to the AEs with a 48 hour follow-up', owner: 'SDR', status: 'open', source: 'ai', created_at: '2026-09-22T06:00:00Z', created_by: 'demo@lyzr.com' },
    { id: 'a2', channel: 'email', title: 'Turn on open tracking for the sender-one mailboxes', owner: 'marketing ops', status: 'done', source: 'ai', note: 'Tracking domain fixed on 24 Sep', created_at: '2026-09-18T06:00:00Z', done_at: '2026-09-24T09:00:00Z', created_by: 'demo@lyzr.com' },
    { id: 'a3', channel: 'linkedin', title: 'Cap the India share of the awareness budget at 40%', owner: 'paid ads lead', status: 'open', source: 'manual', created_at: '2026-09-20T06:00:00Z', created_by: 'demo@lyzr.com' },
  ];
  const DEMO_DOMAINS = { 'tcs.example': 'TCS', 'infosys.example': 'Infosys', 'wipro.example': 'Wipro', 'accenture.example': 'Accenture', 'deloitte.example': 'Deloitte', 'kpmg.example': 'KPMG', 'capgemini.example': 'Capgemini', 'hcltech.example': 'HCLTech', 'cognizant.example': 'Cognizant', 'ey.example': 'EY', 'pwc.example': 'PwC', 'techmahindra.example': 'Tech Mahindra', 'ltimindtree.example': 'LTIMindtree', 'mphasis.example': 'Mphasis', 'coforge.example': 'Coforge', 'firstsource.example': 'Firstsource', 'kearney.example': 'Kearney', 'oliverwyman.example': 'Oliver Wyman', 'boozallen.example': 'Booz Allen', 'rolandberger.example': 'Roland Berger', 'lek.example': 'L.E.K. Consulting' };
  const DEFAULT_TARGETS = { leads_per_month: 200, demo_mqls_per_month: 30, frequency: 3.5, reach_frequency: 3, monthly_budget: 5588 };
  const EDITORS = ['demo@lyzr.com', 'kailash@lyzr.ai', 'subs@lyzr.ai', 'anju@lyzr.ai', 'siva@lyzr.ai'];

  async function seed(name) {
    if (!seeds[name]) { const r = await fetch(`./seed/${name}.json`, { cache: 'no-store' }); if (!r.ok) throw new MockError(r.status, `seed ${name} missing`); seeds[name] = await r.json(); }
    return seeds[name];
  }
  async function settings() {
    const [bands, icp_pool, accounts, regions] = await Promise.all([seed('band_titles'), seed('icp_pool'), seed('accounts'), seed('regions')]);
    return { bands, icp_pool, accounts, regions: (regions && regions.regions) || regions, targets: DEFAULT_TARGETS, lead_rules: { conversation: ['conversation', 'message ad', 'inmail'], mql: ['book a demo', 'demo', 'meeting'], playbook: ['playbook', 'roadmap', 'guide', 'workshop', 'webinar'] }, contact_lists: { Accenture: 1200, TCS: 800, Infosys: 650, Wipro: 500, Capgemini: 420 }, editors: EDITORS, email_rules: { fast_click_seconds: 180, gsi_page_counts_as_demo: true, link_rules: [], domains: DEMO_DOMAINS }, gsi_companies: ['Accenture', 'TCS', 'Infosys', 'Wipro', 'HCL', 'Tech Mahindra', 'LTI Mindtree', 'Cognizant', 'Capgemini', 'Deloitte', 'KPMG', 'EY', 'PwC', 'McKinsey', 'BCG', 'Bain', 'Genpact', 'Firstsource'], ...overrides, updated_at: overrides.__updated_at || '2026-09-24T10:00:00.000Z' };
  }

  async function get(path, params = {}) {
    await sleep(60);
    const p = path.replace(/^\//, '');
    if (p === 'health') return { ok: true, db: true, hubspot: true, claude: true, instantly: true, phantom: true, cron: true, user: { name: 'Demo viewer', email: 'demo@lyzr.com', isEditor: true } };
    if (p === 'settings') return settings();
    if (p === 'uploads') return { uploads: [...uploads, ...em().uploads].filter(u => (!params.channel || u.channel === params.channel) && (!params.platform || (u.platform || 'linkedin') === params.platform)).sort((a, b) => a.uploaded_at < b.uploaded_at ? 1 : -1) };
    if (p === 'email') return emailPage(em(), Number(params.offset) || 0);
    if (p === 'actions') return { actions: actions.filter(a => !params.channel || a.channel === params.channel).sort((a, b) => a.created_at < b.created_at ? 1 : -1) };
    if (p === 'linkedin') {
      const { from = '0000', to = '9999', platform = 'linkedin' } = params;
      // Ad platform: 'linkedin' (default), one of the other platforms, or 'all'.
      const uploadedIds = new Set(uploads.map(u => u.id));
      const allPerf = [...linkedinMock.perf.map(r => r.platform ? r : { ...r, platform: 'linkedin' }), ...adsMock.perf.filter(r => uploadedIds.has('u-' + r.platform))];
      const perf = allPerf.filter(r => r.day >= from && r.day <= to && (platform === 'all' || r.platform === platform));
      const demo = platform === 'linkedin' || platform === 'all' ? activeWindows(linkedinMock.demo.filter(d => uploads.some(u => u.id === d.upload.id) && overlaps(from, to, d.upload.period_start, d.upload.period_end)).map(d => ({ upload: d.upload, rows: d.rows }))) : [];
      return { platform, perf, demo, uploads: uploads.filter(u => u.channel === 'linkedin' && (platform === 'all' || (u.platform || 'linkedin') === platform)) };
    }
    if (p === 'hubspot') {
      const { from = '0000', to = '9999' } = params;
      const inRange = hubspotMock.contacts.filter(c => { const d = dayOf(c.created_at); return d >= from && d <= to && (params.all == 1 || c.in_scope !== false); });
      // `instantly` per contact (GET /api/ca/hubspot contract). Builder B's instantlyLeadsByEmail
      // (js/mock/email.mjs) is used when present; attachInstantly falls back to a deterministic set.
      const [{ attachInstantly }, emailMod] = await Promise.all([import('./mock/hubspot.mjs'), import('./mock/email.mjs')]);
      let lookup = null;
      try {
        const src = emailMod.instantlyLeadsByEmail;
        // Accepts a Map / object keyed by email, a builder (mock) -> index, or a lookup (email) -> leads.
        let idx = src;
        if (typeof src === 'function') { let built; try { built = src(em()); } catch { built = undefined; } idx = built && !Array.isArray(built) ? built : src; }
        if (typeof idx === 'function') lookup = idx;
        else if (idx instanceof Map) lookup = e => idx.get(e);
        else if (idx && typeof idx === 'object') lookup = e => idx[e];
      } catch { lookup = null; }
      const contacts = attachInstantly(inRange, em().api.campaigns, lookup);
      const notes_by_contact = {}; for (const c of contacts) if (hubspotMock.notes_by_contact[c.hs_id]) notes_by_contact[c.hs_id] = hubspotMock.notes_by_contact[c.hs_id];
      return { contacts, notes_by_contact, last_sync: lastSync };
    }
    if (p === 'coverage') {
      const li = uploads.filter(u => u.channel === 'linkedin');
      const ads = {};
      for (const u of li) { const k = u.platform || 'linkedin'; ads[k] = ads[k] || { performance: { from: null, to: null, days_covered: 0, days_missing: 0, gaps: [], uploads: 0 }, demographics: [] }; if (u.kind === 'performance') { const pf = ads[k].performance; pf.uploads++; pf.from = !pf.from || u.period_start < pf.from ? u.period_start : pf.from; pf.to = !pf.to || u.period_end > pf.to ? u.period_end : pf.to; } else ads[k].demographics.push({ from: u.period_start, to: u.period_end, rows: u.row_count, uploaded_at: u.uploaded_at }); }
      for (const k of Object.keys(ads)) { const pf = ads[k].performance; if (pf.from) pf.days_covered = Math.round((Date.parse(pf.to) - Date.parse(pf.from)) / 864e5) + 1; ads[k].demographics.sort((a, b) => a.from < b.from ? -1 : 1); }
      const E = em();
      const days = (E.api.daily || []).map(r => r.day).sort();
      return { ads, email: { events: { from: '2026-07-01', to: '2026-09-24' }, daily: { from: days[0] || null, to: days[days.length - 1] || null }, campaigns: E.api.campaigns.length, gsi_campaigns: E.api.campaigns.filter(c => c.gsi !== false).length, last_sync: E.api.last_sync }, hubspot: { contacts: { from: '2026-04-06', to: '2026-09-24' }, last_sync: lastSync }, deals: { count: 60, last_sync: { status: 'done', finished_at: '2026-09-30T01:40:00Z', started_by: 'daily job' } }, phantom: { daily: { from: '2026-07-06', to: '2026-09-30' }, last_sync: { status: 'done', finished_at: '2026-09-30T01:42:00Z', started_by: 'daily job' } }, actions: actions.reduce((o, a) => { o[a.status] = (o[a.status] || 0) + 1; return o; }, { open: 0, in_progress: 0, blocked: 0, done: 0, dropped: 0 }), generated_at: new Date().toISOString() };
    }
    if (p === 'phantom') return phantomGet(params);
    if (p === 'hubspot/deals') return dealsGet(params);
    if (p === 'insights') { const hit = insights.get(params.scope); if (!hit) throw new MockError(404, 'No cached insight for this scope'); return { scope: params.scope, ...hit }; }
    throw new MockError(404, `Mock API: unknown GET ${p}`);
  }

  async function post(path, body = {}) {
    const p = path.replace(/^\//, '');
    if (p === 'uploads') {
      await sleep(200);
      const id = body.upload_id || 'u' + Math.random().toString(36).slice(2, 8);
      let u = uploads.find(x => x.id === id);
      if (!u) { u = { id, channel: body.channel || 'linkedin', platform: body.channel === 'email' ? null : (body.platform || 'linkedin'), kind: body.kind, file_name: body.file_name, uploaded_by: 'demo@lyzr.com', uploaded_at: new Date().toISOString(), period_start: body.period_start, period_end: body.period_end, row_count: 0, notes: body.notes || null }; uploads.push(u); }
      u.row_count += (body.rows || []).length;
      return { upload_id: id, inserted: (body.rows || []).length };
    }
    if (p === 'actions') { const a = { id: 'a' + Math.random().toString(36).slice(2, 8), channel: body.channel || 'overview', title: body.title, detail: body.detail || null, owner: body.owner || null, source: body.source || 'manual', scope: body.scope || null, status: 'open', created_at: new Date().toISOString(), created_by: 'demo@lyzr.com' }; actions.unshift(a); return { action: a }; }
    if (p === 'instantly/sync') { await sleep(500); if (!body.cursor) return { done: false, cursor: { step: 1 }, campaigns: em().api.campaigns.length, days: 0, warnings: [], progress: { phase: 'daily', done: 0, total: em().api.campaigns.length } }; em().api.last_sync = { status: 'done', started_at: new Date(Date.now() - 4000).toISOString(), finished_at: new Date().toISOString() }; return { done: true, campaigns: em().api.campaigns.length, days: em().api.daily.length, warnings: [], progress: { phase: 'done', done: em().api.campaigns.length, total: em().api.campaigns.length } }; }
    if (p === 'phantom/sync') { await sleep(400); return phantomSyncPost(body); }
    if (p === 'hubspot/deals-sync') { await sleep(500); try { return dealsSyncPost(body); } catch (e) { throw new MockError(e.status || 500, e.message); } }
    if (p === 'hubspot/classify') { await sleep(300); return { done: true, classified: 0, remaining: 0, model: 'demo (no Claude call)' }; }
    if (p === 'hubspot/refresh') {
      const steps = { '': ['p2', 96, 41, []], p2: ['p3', 182, 98, ['3 contacts had no email and were skipped']], p3: [null, hubspotMock.contacts.length, Object.values(hubspotMock.notes_by_contact).flat().length, []] };
      const cur = body.cursor || '';
      if (!(cur in steps)) throw new MockError(400, 'Unknown cursor');
      await sleep(700);
      const [next, contacts, notes, warnings] = steps[cur];
      if (!next) lastSync = { ...lastSync, started_at: new Date(Date.now() - 2100).toISOString(), finished_at: new Date().toISOString(), status: 'done', contacts, notes, started_by: 'demo@lyzr.com' };
      return { done: !next, cursor: next || undefined, contacts, notes, warnings };
    }
    if (p === 'insights') {
      await sleep(600);
      const content = cannedInsight(body.kind, body.input || {}, body.scope);
      const rec = { content, created_at: new Date().toISOString(), model: 'demo (canned, no Claude call)' };
      insights.set(body.scope, rec);
      return { scope: body.scope, ...rec, cached: false };
    }
    throw new MockError(404, `Mock API: unknown POST ${p}`);
  }

  async function put(path, body = {}) {
    await sleep(120);
    if (path.replace(/^\//, '') === 'actions') { const a = actions.find(x => x.id === body.id); if (!a) throw new MockError(404, 'Action not found'); Object.assign(a, body, { updated_at: new Date().toISOString() }); if (body.status) a.done_at = body.status === 'done' ? a.updated_at : null; return { action: a }; }
    if (path.replace(/^\//, '') === 'settings') { if (!body.key) throw new MockError(400, 'key required'); overrides[body.key] = body.value; overrides.__updated_at = new Date().toISOString(); return { ok: true }; }
    throw new MockError(404, `Mock API: unknown PUT ${path}`);
  }
  async function del(path, params = {}) {
    await sleep(120);
    if (path.replace(/^\//, '') === 'actions') { actions = actions.filter(a => a.id !== params.id); return { ok: true }; }
    if (path.replace(/^\//, '') === 'uploads') { const n = uploads.length; uploads = uploads.filter(u => u.id !== params.id); if (uploads.length === n) throw new MockError(404, 'Upload not found'); return { ok: true }; }
    throw new MockError(404, `Mock API: unknown DELETE ${path}`);
  }
  return { get, post, put, del, isDemo: true };
}

// ---- canned findings, built from the numbers the view sends -------------------------------------
const F = (title, evidence, so_what, action, owner, severity) => ({ title, evidence, so_what, action, owner, severity });
function cannedInsight(kind, input, scope) {
  const n = (v, d = 0) => fmt(v, d);
  if (kind === 'messaging') {
    const counts = input.counts || {}; const msgs = input.messages || [];
    const top = sortedEntries(countBy(msgs, m => m.cluster || 'unknown')).slice(0, 3);
    const total = msgs.length || counts.withMessage || 0;
    const md = msgs.filter(m => m.band === 'MD' || m.band === 'MD-1').length;
    const noNotes = msgs.filter(m => !(m.notes || []).length).length;
    const value = input.value || 'these';
    const findings = [];
    if (top.length) findings.push(F(`${clusterLabel(top[0][0])} is the main ask from ${value} leads`, `${top[0][1]} of ${total} messages (${pct(top[0][1] / total * 100, 0)})${top[1] ? `, then ${clusterLabel(top[1][0])} with ${top[1][1]}` : ''}.`, 'Lead with that use case in the first reply and the follow-up sequence, not with a generic platform pitch.', `Build one reply template and one 3-slide proof for "${clusterLabel(top[0][0])}" and use it for every ${value} lead this month.`, 'Anju', 'win'));
    if (total) findings.push(F(`${pct(md / total * 100, 0)} of the people who wrote a message are MD or MD-1`, `${md} of ${total} messages come from the MD or MD-1 band.`, md / total >= 0.35 ? 'Seniority is good here: these are people who can sponsor a pilot.' : 'Most writers are below the buying bands, so the reply should aim to reach their practice lead.', md / total >= 0.35 ? 'Route MD and MD-1 writers to the AE within one working day.' : 'Ask each lead who owns the AI agenda in their practice and request an intro.', 'Praveen S', md / total >= 0.35 ? 'good' : 'watch'));
    if (noNotes) findings.push(F(`${noNotes} messages have no note or logged activity`, `${noNotes} of ${total} contacts with a message show nothing in HubSpot after the form fill.`, 'A written message is the strongest intent signal we have and it is going cold.', 'Work the list oldest first and log the outcome, even a no-answer, so the follow-up health table is true.', 'Owner of each lead', noNotes / Math.max(1, total) > 0.4 ? 'risk' : 'watch'));
    const vague = msgs.filter(m => (m.cluster === 'exploring' || m.cluster === 'demo')).length;
    if (vague) findings.push(F(`${vague} leads only asked for a demo or are exploring`, `${vague} of ${total} messages name no use case.`, 'They will not self-identify a use case; the first call has to find it.', 'Use the discovery call script (three questions: team, task, tool today) before booking a demo.', 'Bharath', 'watch'));
    return { headline: `${value}: ${n(total)} messages${top.length ? `, mostly about ${clusterLabel(top[0][0]).toLowerCase()}` : ''}.`, findings, summary: 'Demo mode: findings are computed from the numbers on this page, not by Claude. Set ANTHROPIC_API_KEY on the Pages site for real analysis.' };
  }
  if (kind === 'leads') {
    const s = input.summary || {}; const bands = input.bands || {}; const src = input.sources || []; const owners = input.owners || []; const actions = input.actionCount || 0;
    const mdShare = s.leads ? (s.md + s.md1) / s.leads : 0;
    const findings = [
      F(`${n(s.leads)} leads in range, ${pct(mdShare * 100, 0)} in the MD or MD-1 bands`, `MD ${n(s.md)}, MD-1 ${n(s.md1)}, MD-2 ${n(s.md2)}, Other ${n(s.other)}, Unknown ${n(s.unknown)}.`, mdShare >= 0.3 ? 'The buying bands are well represented for an inbound programme.' : 'Volume is coming from below the buying bands; the ads audience is drifting junior.', mdShare >= 0.3 ? 'Keep the seniority targeting as is and shift budget to the ad sets that bring MD-1.' : 'Tighten the LinkedIn seniority filter to Director and above on the lead-gen ad sets.', 'Kailash', mdShare >= 0.3 ? 'good' : 'watch'),
      F(`${n(s.target)} leads (${pct(s.target / Math.max(1, s.leads) * 100, 0)}) are at named target accounts`, `Target-account leads in range: ${n(s.target)} of ${n(s.leads)}.`, 'The rest are outside the GSI/SI list and need a different follow-up path.', 'Split the sequence: AE-led for target accounts, nurture for everyone else.', 'Anju', s.target / Math.max(1, s.leads) < 0.15 ? 'watch' : 'good'),
    ];
    if (src.length) findings.push(F(`${src[0].source} brings ${n(src[0].leads)} of ${n(s.leads)} leads`, src.slice(0, 3).map(x => `${x.source}: ${n(x.leads)} leads, ${n(x.MD + x['MD-1'])} MD/MD-1`).join('; ') + '.', 'One source carries the channel, so its quality sets the quality of the whole funnel.', 'Report band mix per source every two weeks and cut sources with no MD-1 leads.', 'Kailash', 'watch'));
    if (actions) findings.push(F(`${n(actions)} senior target-account leads have had no activity for 7 or more days`, `Action list on this page: ${n(actions)} MD/MD-1 leads at target accounts, idle 7+ days.`, 'These are the leads the programme exists to find and they are not being worked.', 'Clear the action list this week and log every touch in HubSpot.', 'Praveen S / Pooja', 'risk'));
    if (s.unowned) findings.push(F(`${n(s.unowned)} leads have no owner`, `${n(s.unowned)} of ${n(s.leads)} leads are unassigned.`, 'Unowned leads are not followed up.', 'Turn on the HubSpot round-robin for form leads so nothing lands unowned.', 'Anju', 'watch'));
    return { headline: `${n(s.leads)} leads, ${n(s.md + s.md1)} in the buying bands, ${n(s.withActivity)} with any activity.`, findings, summary: 'Demo mode: findings are computed from the aggregates on this page, not by Claude.' };
  }
  if (kind === 'overview') {
    const li = input.linkedin || {}; const hs = input.hubspot || {}; const t = input.targets || {}; const pace = input.pace || {};
    const findings = [];
    if (li.leads != null) findings.push(F(`Paid ads: ${n(li.leads)} leads at ${usd(li.cpl)} each in the selected range`, `Spend ${usd(li.spend)}, ${n(li.impressions)} impressions, ${n(li.clicks)} clicks.`, pace.leads != null ? `At this pace the month lands at about ${n(pace.leads)} leads against a target of ${n(t.leads_per_month)}.` : 'Set a monthly lead target in Settings to see the gap.', li.cpl && t.leads_per_month ? `Hitting ${n(t.leads_per_month)} at ${usd(li.cpl)} needs ${usd(li.cpl * t.leads_per_month)} a month of budget.` : 'Add the target in Settings.', 'Kailash', pace.leads != null && pace.leads < t.leads_per_month ? 'watch' : 'good'));
    if (hs.leads != null) findings.push(F(`HubSpot: ${n(hs.leads)} leads, ${n(hs.md)} in the MD band, ${n(hs.unowned)} unowned`, `${n(hs.withMessage)} wrote a form message, ${n(hs.target)} are at named target accounts.`, hs.unowned ? 'Unowned leads are the fastest fix on the board.' : 'Ownership is clean.', hs.unowned ? 'Assign every unowned lead today; the leads view has the list.' : 'Keep the round-robin on.', 'Anju', hs.unowned ? 'watch' : 'good'));
    if (pace.demos != null) findings.push(F(`Demo MQL pace is ${n(pace.demos)} a month against ${n(t.demo_mqls_per_month)}`, `${n(hs.mqls)} contacts reached MQL or later in range.`, 'The follow-up flow, not the ads, has to close this gap.', 'Get the HubSpot sequence live and measure lead to demo weekly.', 'Anju / Praveen S', pace.demos < (t.demo_mqls_per_month || 0) ? 'risk' : 'good'));
    for (const a of (input.alerts || []).slice(0, 2)) findings.push(F(a.title, a.evidence || '', a.why || '', a.action || '', a.owner || '', 'watch'));
    return { headline: 'Both channels in one read: ads bring volume, the follow-up flow has to turn it into demos.', findings, summary: 'Demo mode: findings are computed from the numbers on this page, not by Claude.' };
  }
  if (kind === 'email') {
    const t = input.totals || {}; const camps = input.campaigns || []; const acc = input.accounts || []; const mb = input.mailboxes || [];
    const best = camps.filter(c => c.reached).sort((a, b) => (b.demo || 0) - (a.demo || 0))[0];
    const cold = camps.filter(c => c.reached > 100 && !c.clickers);
    const noOpen = mb.filter(m => !m.open_rate && m.click_rate);
    const findings = [];
    if (best) findings.push(F(`${best.name} brings the most demo intent`, `${n(best.demo)} Book a Demo clickers from ${n(best.reached)} contacts (${n(best.demo_direct)} direct, ${n(best.demo_via)} via the GSI/SI page).`, 'This sequence and its audience are the template for the next wave.', 'Clone its step copy into the cold D sequences and hand its demo list to the AEs today.', 'SDR', 'win'));
    if (t.fast_clicks) findings.push(F(`${n(t.fast_clicks)} fast clicks were filtered out`, `Clicks within the fast-click threshold of the send; human clickers are ${n(t.clickers)}.`, 'Without the filter these scanner clicks would inflate engagement and pollute the demo list.', 'Keep the filter on and spot-check the flagged list once a month.', 'marketing ops', 'info'));
    if (cold.length) findings.push(F(`${cold.length} campaign${cold.length > 1 ? 's have' : ' has'} no human clicks`, cold.map(c => `${c.name}: ${n(c.reached)} reached`).join('; ') + '.', 'Cold sequences use mailbox reputation without return.', 'Pause them or swap the first step to the case study that works in the A sequences.', 'SDR', 'risk'));
    if (noOpen.length) findings.push(F(`${noOpen.length} mailbox${noOpen.length > 1 ? 'es show' : ' shows'} clicks but no opens`, noOpen.map(m => m.mailbox).join(', ') + '.', 'Open rates are understated and open-based retargeting misses these people.', 'Fix the tracking domain on these mailboxes.', 'marketing ops', 'watch'));
    if (acc[0]) findings.push(F(`${acc[0].account} is the warmest account`, `${n(acc[0].clickers)} human clickers, ${n(acc[0].demo)} Book a Demo.`, 'Several people at one firm clicking is a buying-group signal.', `Ask the ${acc[0].account} AE to multi-thread with the clickers this week.`, `AE for ${acc[0].account}`, 'win'));
    const progress = (input.action_log || []).slice(0, 4).map(a => ({ action: a.action, status: a.status, verdict: a.status === 'done' ? 'Done; check the mailbox table for the effect.' : 'Still open and still relevant.' }));
    return { headline: `${n(t.demo)} people clicked Book a Demo out of ${n(t.reached)} reached (${n(t.clickers)} human clickers).`, findings: findings.slice(0, 6), summary: 'Demo mode: findings are computed from the numbers on this page, not by Claude.', progress };
  }
  if (kind === 'ads') {
    return { headline: 'Paid ads read-out (demo).', findings: [F('One asset carries the channel', 'The Agentic AI Roadmap playbook brings most leads.', 'Concentration risk if the asset fatigues.', 'Ship a second playbook creative this month.', 'Kailash', 'watch')], summary: 'Demo mode: canned findings.' };
  }
  return { headline: `No canned analysis for kind "${kind}" (${scope}).`, findings: [], summary: 'Demo mode.' };
}
