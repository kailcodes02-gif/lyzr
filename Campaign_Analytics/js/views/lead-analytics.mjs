// Lead analytics: every lead in one place. LinkedIn lead gen form files and the LinkedIn API pull (GET li-leads),
// leads Claude read from screenshots (same GET, source 'screenshot') and HubSpot GSI leads (GET hubspot, converted
// with fromHubspot). Which campaigns bring leads (joined to LinkedIn ad spend from GET linkedin), how they come
// (form, lead type, source, origin, over time), which companies, who, campaign × company, what the screenshots
// said, the full list and a Claude read-out. Every count opens the leads behind it in a side panel.
// Aggregation lives in js/lib/li-leads.mjs (unit-tested).
import * as L from '../lib/li-leads.mjs';
import { LEAD_LABELS, LEAD_TYPES, DEFAULT_LEAD_RULES } from '../lib/linkedin-agg.mjs';
import { enrich, isFormLead } from '../lib/leads-agg.mjs';
import { tierOf, TIER_LABEL } from '../lib/tiers.mjs';
import { memoGet } from '../compare.mjs';
import { NAVY, ORANGE, TEAL, BAND_COLORS, LEAD_TYPE_COLORS, TIER_COLORS, seriesColor, withAlpha } from '../palette.mjs';
import { mountUploader } from '../uploader.mjs';
import { mountScreenshots, screenCard, wireScreenDeletes } from '../screenshots.mjs';
import { isEditorOf } from './linkedin.mjs';

export const route = 'lead-analytics';
export const title = 'Lead analytics';

const S = { source: 'all', gran: 'week', q: '', sort: { key: 'submitted_at', dir: -1 }, limit: 50 };
const SOURCE_TABS = [{ value: 'all', label: 'All' }, { value: 'linkedin', label: 'LinkedIn form files / API' }, { value: 'screenshot', label: 'Screenshots' }, { value: 'hubspot', label: 'HubSpot' }];
const SOURCE_COLORS = { csv: NAVY, api: TEAL, screenshot: ORANGE, hubspot: '#7A3FE4' };
const BANDS4 = ['MD', 'MD-1', 'MD-2', 'Other'];
let charts = [], shots = null;
const PICK = new Map();
export function destroy() { for (const c of charts) { try { c.destroy(); } catch {} } charts = []; if (shots) { shots.destroy(); shots = null; } closeDrawer(); }
function killCharts() { for (const c of charts) { try { c.destroy(); } catch {} } charts = []; }
const chart = (canvas, cfg) => { if (!window.Chart || !canvas) return null; const c = new Chart(canvas, cfg); charts.push(c); return c; };
function escClose(e) { if (e.key === 'Escape') closeDrawer(); }
function closeDrawer() { const d = document.getElementById('laDrawer'); if (d) d.remove(); document.removeEventListener('keydown', escClose); }
const truncate = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; };

export async function render(el, ctx) {
  destroy();
  const { esc, fmt, usd, pct, rangeLabel, bucketLabel, istDateTime } = ctx.fmt;
  const { tiles, pill, section, spinner, empty, seg } = ctx.ui;
  const { from, to } = ctx.state;
  const settings = ctx.settings || {};
  const accounts = settings.accounts || [], bands = settings.bands || {}, regions = settings.regions || {}, accountTiers = settings.account_tiers || {}, rules = settings.lead_rules || DEFAULT_LEAD_RULES;
  const editor = isEditorOf(ctx);
  const head = `<div class="seghead">Leads</div><h1>Lead analytics</h1><div class="intro">Every lead in one place, ${esc(rangeLabel(from, to))}: LinkedIn lead gen form leads (uploaded files and the LinkedIn API), leads read from screenshots, and HubSpot GSI leads. See which campaigns bring leads and at what cost, how they come in, which companies they work at and who they are. Every number opens the leads behind it.</div>`;
  el.innerHTML = head + `<details class="card" id="laUp" style="margin-bottom:16px"><summary style="cursor:pointer"><b>Add leads</b> <span class="muted" style="font-size:13px">· lead files and screenshots</span></summary>
      <div class="grid g2" style="margin-top:12px;gap:16px"><div><div class="ui-label" style="margin-bottom:6px">Lead files (CSV or Excel)</div><div id="laUploader"></div></div><div><div class="ui-label" style="margin-bottom:6px">Screenshots</div><div id="laShots"></div></div></div></details>
    <div id="laBody">${spinner('Loading leads')}</div>`;
  const rerender = () => render(el, ctx);
  mountUploader(el.querySelector('#laUploader'), ctx, { channel: 'leads', isEditor: editor, onDone: rerender });
  mountScreenshots(el.querySelector('#laShots'), ctx, { isEditor: editor, showList: false, onDone: rerender }).then(s => { if (shots) shots.destroy(); shots = s; }).catch(() => {});

  const [liR, perfR, hsR] = await Promise.allSettled([ctx.api.get('li-leads'), memoGet(ctx, 'linkedin', { from, to }), ctx.api.get('hubspot', { from, to })]);
  const body = el.querySelector('#laBody'); if (!body) return;
  const warn = [];
  if (liR.status === 'rejected') warn.push('LinkedIn leads could not be loaded: ' + (liR.reason && liR.reason.message || liR.reason));
  if (perfR.status === 'rejected') warn.push('LinkedIn ad spend could not be loaded, so CPL and form completion are missing: ' + (perfR.reason && perfR.reason.message || perfR.reason));
  if (hsR.status === 'rejected') warn.push('HubSpot leads could not be loaded: ' + (hsR.reason && hsR.reason.message || hsR.reason));
  const li = liR.status === 'fulfilled' ? liR.value || {} : {};
  const perf = (perfR.status === 'fulfilled' && perfR.value && perfR.value.perf || []).filter(r => (r.platform || 'linkedin') === 'linkedin');
  const hsContacts = hsR.status === 'fulfilled' ? (hsR.value && hsR.value.contacts) || [] : [];
  const screens = li.screens || [];
  const liAll = li.leads || [];
  const liIn = liAll.filter(l => L.inRange(l, from, to));
  const noDate = liAll.filter(l => !L.dayOf(l)).length;
  const hs = enrich(hsContacts.filter(isFormLead), {}, accounts).map(L.fromHubspot);
  const all = [...liIn, ...hs].map((l, i) => ({ ...l, _id: 'l' + i }));
  const warnHtml = warn.map(w => `<p class="err">${esc(w)}</p>`).join('');

  if (!all.length) {
    el.querySelector('#laUp').open = true;
    body.innerHTML = warnHtml + empty(`No leads for ${rangeLabel(from, to)}. Open "Add leads" above and drop a LinkedIn lead gen form export (Campaign Manager › Account assets › Lead gen forms › Download leads) or any spreadsheet of leads with names or emails and their company. You can also drop or paste a screenshot of a lead list or of campaign numbers, and Claude reads it. HubSpot GSI leads appear here once the daily pull has run.${liAll.length ? ` ${fmt(liAll.length)} lead${liAll.length === 1 ? ' is' : 's are'} on file outside this range${noDate ? `, ${fmt(noDate)} with no date` : ''}; widen the dates to see them.` : ''}`) + (screens.length ? section('From screenshots', '', screens.map(s => screenCard(ctx, s, { canDelete: editor })).join(''), 'la-shots') : '');
    wireScreenDeletes(body, ctx, rerender);
    return;
  }

  // ---- drill-down drawer ----
  PICK.clear();
  const byId = new Map(all.map(l => [l._id, l]));
  const pick = (label, list, text) => { if (!list.length) return text != null ? text : '0'; const id = 'p' + PICK.size; PICK.set(id, { label, list }); return `<a href="#" class="pick" data-pick="${id}" title="Show these ${fmt(list.length)} lead${list.length === 1 ? '' : 's'}">${text != null ? text : fmt(list.length)}</a>`; };
  const bandPill = b => pill(b, b === 'MD' ? 'p-high' : b === 'MD-1' ? 'p-med' : b === 'MD-2' ? 'p-low' : 'p-na');
  const srcPill = l => pill(L.SOURCE_LABEL[l.source] || l.source, l.source === 'hubspot' ? 'p-low' : l.source === 'screenshot' ? 'p-med' : 'p-high');
  const LIST_COLS = [
    { h: 'Date', k: 'submitted_at', f: l => esc(l.submitted_at || '–') },
    { h: 'Lead', k: 'name', left: true, f: l => `<b>${esc(L.fullName(l))}</b><br><span class="muted" style="font-size:11.5px">${esc(l.title || '')}</span>`, v: l => L.fullName(l) },
    { h: 'Company', k: 'company', left: true, f: l => { const a = L.accountOf(l, accounts); return a ? `<b>${esc(a)}</b>` : esc(l.company || '–'); }, v: l => L.accountOf(l, accounts) || l.company },
    { h: 'Band', k: 'band', f: l => bandPill(L.bandOf(l, bands)), v: l => L.bandOf(l, bands) },
    { h: 'Campaign', k: 'campaign', left: true, f: l => `${esc(truncate(l.campaign || '–', 48))}${l.form ? `<br><span class="muted" style="font-size:11.5px">${esc(truncate(l.form, 48))}</span>` : ''}` },
    { h: 'Country', k: 'country', f: l => esc(l.country || '–') },
    { h: 'Source', k: 'source', f: srcPill },
    { h: 'Email', k: 'email', left: true, f: l => `<span class="muted" style="font-size:11.5px">${esc(l.email || '')}</span>` },
  ];
  function drawer(inner) {
    closeDrawer();
    const d = document.createElement('aside'); d.className = 'drawer'; d.id = 'laDrawer'; d.style.width = 'min(820px,100vw)';
    d.innerHTML = `<button class="btn tiny ghost x" data-x>Close</button>${inner}`;
    document.body.appendChild(d);
    d.querySelector('[data-x]').onclick = closeDrawer;
    d.addEventListener('click', ev => {
      const back = ev.target.closest('[data-back]'); if (back) { const p = PICK.get(back.dataset.back); if (p) openList(p.label, p.list, back.dataset.back); return; }
      const row = ev.target.closest('[data-lead]'); if (row) openLead(row.dataset.lead, row.dataset.from || '');
    });
    document.addEventListener('keydown', escClose);
    return d;
  }
  const download = (name, text) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' })); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); };
  const csvOf = list => L.leadsToCsv(list, [{ h: 'target_account', f: l => L.accountOf(l, accounts) || '' }, { h: 'band', f: l => L.bandOf(l, bands) }, { h: 'region', f: l => L.leadRegion(l, regions) }, { h: 'lead_source', f: l => l.lead_source || '' }, { h: 'origin', f: l => l.origin || '' }]);
  function openList(label, list, pickId) {
    const sorted = [...list].sort((a, b) => (a.submitted_at || '') < (b.submitted_at || '') ? 1 : -1);
    const emails = sorted.map(l => l.email).filter(Boolean);
    const d = drawer(`<div class="seghead">Leads · ${esc(rangeLabel(from, to))}</div><h2 style="margin:4px 0 6px">${esc(label)}: ${fmt(sorted.length)} lead${sorted.length === 1 ? '' : 's'}</h2>
      <p style="margin:0 0 10px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn tiny" data-copy>Copy ${fmt(emails.length)} emails</button><button class="btn tiny ghost" data-csv>Export CSV</button><span class="muted" style="font-size:12.5px;align-self:center">Click a lead to see everything on file.</span></p>
      <div class="tblwrap"><table><thead><tr>${LIST_COLS.map(c => `<th class="${c.left ? 'l' : ''}">${esc(c.h)}</th>`).join('')}</tr></thead><tbody>${sorted.slice(0, 500).map(l => `<tr class="lead" style="cursor:pointer" data-lead="${l._id}" data-from="${esc(pickId || '')}">${LIST_COLS.map(c => `<td class="${c.left ? 'l' : ''}">${c.f(l)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>${sorted.length > 500 ? `<p class="muted" style="font-size:12.5px">First 500 shown; export the CSV for all ${fmt(sorted.length)}.</p>` : ''}`);
    d.querySelector('[data-csv]').onclick = () => download(`lyzr-leads-${label.replace(/[^\w]+/g, '-').toLowerCase().slice(0, 60)}.csv`, csvOf(sorted));
    d.querySelector('[data-copy]').onclick = async () => { try { await navigator.clipboard.writeText(emails.join('\n')); ctx.toast(`Copied ${fmt(emails.length)} emails`); } catch { ctx.toast('Copy failed: the browser blocked the clipboard', 'err'); } };
  }
  function openLead(id, fromPick) {
    const l = byId.get(id); if (!l) return;
    const row = (k, v) => v ? `<tr><td class="l muted" style="white-space:nowrap">${esc(k)}</td><td class="l">${esc(v)}</td></tr>` : '';
    const acc = L.accountOf(l, accounts);
    const doc = l.doc_id ? (li.docs || []).find(x => x.id === l.doc_id) || screens.find(x => x.id === l.doc_id) : null;
    drawer(`${fromPick ? `<button class="btn tiny ghost" data-back="${esc(fromPick)}">← Back to the list</button>` : ''}<div class="seghead" style="margin-top:8px">Lead</div><h2 style="margin:4px 0 2px">${esc(L.fullName(l))}</h2>
      <p style="margin:0 0 10px">${esc(l.title || 'no title')} ${bandPill(L.bandOf(l, bands))} · ${acc ? `<b>${esc(acc)}</b>` : esc(l.company || 'no company')} · ${esc(L.leadRegion(l, regions))}${l.country ? ` / ${esc(l.country)}` : ''} ${srcPill(l)}</p>
      <div class="card"><table class="kv"><tbody>
        ${row('Submitted', l.submitted_at)}${row('Email', l.email)}${row('Phone', l.phone)}${row('LinkedIn', l.linkedin_url)}${row('Company as written', l.company)}${row('Target account', acc ? `${acc} (${TIER_LABEL[tierOf(acc, accountTiers, accounts)] || 'Other'})` : '')}
        ${row('Seniority', l.seniority)}${row('Industry', l.industry)}${row('Company size', l.company_size)}${row('City', l.city)}
        ${row('Campaign group', l.campaign_group)}${row('Campaign (ad set)', l.campaign)}${row('Ad', l.ad)}${row('Form', l.form)}${row('Lead type', LEAD_LABELS[L.typeOf(l, rules)])}
        ${row('HubSpot lead source', l.lead_source)}${row('Traffic source', l.traffic)}${row('Origin', l.origin)}
        ${Object.entries(l.extra || {}).map(([k, v]) => row(k, v)).join('')}
        ${row('From', doc ? `${doc.file_name || doc.title || doc.id}${doc.uploaded_at ? ', ' + istDateTime(doc.uploaded_at) : ''}` : l.source === 'hubspot' ? 'HubSpot daily pull' : '')}
      </tbody></table></div>`);
  }
  el.onclick = ev => { const a = ev.target.closest('a.pick[data-pick]'); if (!a || !el.contains(a)) return; ev.preventDefault(); const p = PICK.get(a.dataset.pick); if (p) openList(p.label, p.list, a.dataset.pick); };

  // ---- the page, for the chosen source ----
  body.innerHTML = warnHtml + `<div class="row" style="align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap"><span class="ui-label">Source</span><div id="laSrc"></div><span class="muted" style="font-size:12.5px" id="laSrcNote"></span></div><div id="laMain"></div>`;
  seg(body.querySelector('#laSrc'), SOURCE_TABS, v => { S.source = v; S.limit = 50; draw(); }, S.source);
  const filtered = () => all.filter(l => S.source === 'all' || (S.source === 'linkedin' ? l.source === 'csv' || l.source === 'api' : l.source === S.source));

  function draw() {
    killCharts(); PICK.clear();
    const list = filtered();
    const main = body.querySelector('#laMain');
    body.querySelector('#laSrcNote').textContent = `${fmt(list.length)} of ${fmt(all.length)} leads${li.duplicates ? ` · ${fmt(li.duplicates)} repeat${li.duplicates === 1 ? '' : 's'} across files counted once` : ''}${noDate ? ` · ${fmt(noDate)} file lead${noDate === 1 ? '' : 's'} with no date left out` : ''}`;
    if (!list.length) { main.innerHTML = empty(S.source === 'screenshot' ? 'No leads read from screenshots in this range. Drop or paste a screenshot of a lead list under "Add leads".' : S.source === 'hubspot' ? 'No HubSpot GSI leads in this range.' : 'No LinkedIn lead gen form leads in this range. Upload the export under "Add leads" (Campaign Manager › Account assets › Lead gen forms › Download leads).') + screensSection(); wireScreenDeletes(main, ctx, rerender); return; }
    const showPerf = S.source === 'all' || S.source === 'linkedin';
    const k = L.leadKpis(list, showPerf ? perf : [], { accounts, bands });
    const isMd = l => ['MD', 'MD-1', 'MD-2'].includes(L.bandOf(l, bands));
    const targetList = list.filter(l => L.accountOf(l, accounts));
    const campsAll = L.leadsByCampaign(list, showPerf ? perf : [], { rules });
    const noCamp = r => r.key === 'f:_none';
    const camps = [...campsAll.filter(r => !noCamp(r)), ...campsAll.filter(noCamp)];
    const companies = L.companyTable(list, accounts, { accountTiers, bands });
    const byForm = L.leadsBy(list, 'form', '(no form name)');
    const byType = L.leadsBy(list, l => L.typeOf(l, rules));
    const originKey = l => l.source === 'hubspot' ? `HubSpot · ${l.lead_source || l.traffic || 'no source'}` : L.SOURCE_LABEL[l.source] || l.source;
    const byOrigin = L.leadsBy(list, originKey);
    const titles = L.leadsBy(list, 'title', '(no title)');
    const seniority = L.leadsBy(list, 'seniority', '(not given)');
    const countries = L.leadsBy(list, 'country', '(not given)');
    const regionRows = L.leadsBy(list, l => L.leadRegion(l, regions));
    const bandRows = BANDS4.map(b => ({ key: b, leads: list.filter(l => L.bandOf(l, bands) === b) }));
    const mix = L.bandMix(list, bands);
    const matrix = L.campaignCompanyMatrix(list, accounts, { topCampaigns: 8, topCompanies: 15 });
    const hsList = list.filter(l => l.source === 'hubspot');

    const tbl = (cols, rows, total) => ctx.ui.table({ cols, rows, total });
    const countTable = (rows, label, { limit = 12, extra = [] } = {}) => tbl([{ h: label, k: 'key', left: true, f: r => esc(truncate(r.key, 70)) }, { h: 'Leads', k: 'count', f: r => pick(`${label}: ${r.key}`, r.leads) }, { h: 'Share', k: 'share', f: r => pct(r.count / list.length * 100, 0) }, ...extra], rows.slice(0, limit));

    const kpi = tiles([
      { k: 'Total leads', v: pick('All leads', list), d: `${esc(rangeLabel(from, to))}` },
      { k: 'LinkedIn form leads', v: pick('LinkedIn form leads (files and API)', list.filter(l => l.source === 'csv' || l.source === 'api')), d: `${fmt(k.files)} from files · ${fmt(k.api)} from the API` },
      { k: 'Screenshot leads', v: pick('Leads read from screenshots', list.filter(l => l.source === 'screenshot')), d: `${fmt(screens.length)} screenshot${screens.length === 1 ? '' : 's'} on file` },
      { k: 'HubSpot GSI leads', v: pick('HubSpot GSI leads', hsList), d: 'form leads at GSI accounts' },
      { k: 'Unique companies', v: fmt(k.companies), d: `${fmt(companies.filter(c => c.target).length)} of them target accounts` },
      { k: 'Target-account share', v: pick('Leads at target accounts', targetList, pct(k.target_share, 0)), d: `${fmt(k.target)} leads at GSI / SI list accounts` },
      { k: 'MD / MD-1 / MD-2 share', v: pick('Leads in the MD, MD-1 and MD-2 bands', list.filter(isMd), pct(k.md_share, 0)), d: `MD ${fmt(mix.MD, 0)} · MD-1 ${fmt(mix['MD-1'], 0)} · MD-2 ${fmt(mix['MD-2'], 0)}` },
      { k: 'Blended CPL', v: showPerf ? usd(k.cpl, 2) : '–', d: showPerf ? (k.spend ? `${usd(k.spend)} LinkedIn spend ÷ ${fmt(k.li_leads || k.linkedin)} leads${k.li_leads ? ' LinkedIn reported' : ' in the files'}` : 'no LinkedIn spend uploaded for these dates') : 'LinkedIn sources only' },
      { k: 'Form completion', v: showPerf ? pct(k.completion, 1) : '–', d: showPerf ? (k.form_opens ? `${fmt(k.li_leads)} leads ÷ ${fmt(k.form_opens)} form opens` : 'no form opens in the ad export') : 'LinkedIn sources only' },
    ]);

    const campRows = camps.slice(0, 40);
    const campTable = tbl([
      { h: 'Campaign group', k: 'campaign_group', left: true, f: r => `<span class="muted" style="font-size:12px">${esc(truncate(r.campaign_group || '–', 40))}</span>` },
      { h: 'Ad set', k: 'campaign', left: true, f: r => `${esc(truncate(r.campaign, 60))}${!r.in_perf && showPerf && r.count && !noCamp(r) ? ' <span class="muted" title="No ad spend found for this name in the LinkedIn export for these dates">· no spend match</span>' : ''}` },
      { h: 'Leads in files', k: 'count', f: r => pick(`Campaign: ${r.campaign}`, r.leads) },
      { h: 'LinkedIn reported', k: 'li_leads', f: r => r.in_perf ? fmt(r.li_leads) + (r.gap > 0 ? `<div class="down" style="font-size:11px">${fmt(r.gap)} not in files</div>` : '') : '–' },
      { h: 'Spend', k: 'spend', f: r => r.in_perf ? usd(r.spend) : '–' },
      { h: 'CPL', k: 'cpl', f: r => usd(r.cpl, 2) },
      { h: 'Form opens', k: 'form_opens', f: r => r.in_perf ? fmt(r.form_opens) : '–' },
      { h: 'Completion', k: 'completion', f: r => pct(r.completion, 0) },
      { h: 'Lead type', k: 'lead_type', f: r => pill(LEAD_LABELS[r.lead_type] || r.lead_type, r.lead_type === 'mql' ? 'p-high' : r.lead_type === 'playbook' ? 'p-low' : 'p-med') },
      { h: 'Top companies', k: 'top', left: true, f: r => esc(r.top_companies.map(c => `${c.company} (${c.count})`).join(', ') || '–') },
    ], campRows);

    const companyRows = companies.slice(0, 30);
    const tierPill = t => t ? `<span class="pill" style="background:${withAlpha(TIER_COLORS[t] || '#A8A298', 0.14)};color:${TIER_COLORS[t] || '#555'}">${esc(t)}</span>` : '<span class="muted">–</span>';
    const companyTable = tbl([
      { h: 'Company', k: 'company', left: true, f: c => `<b>${esc(truncate(c.company, 50))}</b>${c.target ? ' ' + pill('target', 'p-high') : ''}` },
      { h: 'Tier', k: 'tier', f: c => tierPill(c.tier) },
      { h: 'Leads', k: 'count', f: c => pick(`Company: ${c.company}`, c.leads) },
      ...BANDS4.map(b => ({ h: b, k: b, f: c => { const sub = c.leads.filter(l => L.bandOf(l, bands) === b); return sub.length ? pick(`${c.company}, ${b}`, sub) : '<span class="muted">0</span>'; } })),
      { h: 'Campaigns that brought them', k: 'campaigns', left: true, f: c => esc(c.campaigns.slice(0, 3).map(x => `${truncate(x.campaign, 40)} (${x.count})`).join(', ')) },
      { h: 'Titles', k: 'titles', left: true, f: c => `<span class="muted" style="font-size:12px">${esc(c.titles.filter(t => t.title !== '(not given)').slice(0, 3).map(t => t.title).join(', '))}</span>` },
    ], companyRows);
    const tierGroups = ['Tier 1', 'Tier 2'].map(g => ({ g, leads: companies.filter(c => c.tier_group === g).flatMap(c => c.leads) }));
    const nonTarget = list.filter(l => !L.accountOf(l, accounts));

    const heat = matrix.companies.length && matrix.campaigns.length ? `<div class="tblwrap"><table class="heat"><thead><tr><th class="l">Company</th>${matrix.campaigns.map(c => `<th title="${esc(c)}" style="max-width:120px;font-size:11px;white-space:normal">${esc(truncate(c, 34))}</th>`).join('')}<th>In these</th></tr></thead><tbody>${matrix.companies.map((co, ri) => `<tr><td class="l"><b>${esc(truncate(co, 34))}</b></td>${matrix.campaigns.map((c, ci) => { const n = matrix.counts[ri][ci]; const a = matrix.max ? n / matrix.max : 0; const cell = matrix.cells.get(ri + '|' + ci) || []; return `<td style="background:${n ? withAlpha(NAVY, 0.1 + a * 0.75) : 'transparent'};color:${a > 0.5 ? '#fff' : 'inherit'};text-align:center">${n ? pick(`${co} × ${c}`, cell) : '<span class="muted">·</span>'}</td>`; }).join('')}<td><b>${fmt(matrix.counts[ri].reduce((x, y) => x + y, 0))}</b></td></tr>`).join('')}</tbody></table></div><p class="muted" style="font-size:12px;margin-top:6px">Top ${fmt(matrix.companies.length)} companies × top ${fmt(matrix.campaigns.length)} campaigns by leads (leads with no campaign are left out). Darker = more leads.</p>` : empty('Not enough campaigns or companies to cross.');

    const hsOrigin = hsList.length ? section('How the HubSpot leads came in', 'HubSpot GSI leads by the form they filled, the Lead Source picklist, the campaign HubSpot recorded and the first traffic source.', `<div class="grid g2" style="gap:14px">${[['Form', 'form', '(no form name)'], ['Lead source', 'lead_source', '(no lead source)'], ['Campaign', 'campaign', '(no campaign)'], ['Traffic source', 'traffic', 'Unknown']].map(([lab, key, blank]) => `<div><div class="ui-label" style="margin-bottom:6px">${esc(lab)}</div>${tbl([{ h: lab, k: 'key', left: true, f: r => esc(truncate(r.key, 60)) }, { h: 'Leads', k: 'count', f: r => pick(`HubSpot ${lab.toLowerCase()}: ${r.key}`, r.leads) }], L.leadsBy(hsList, key, blank).slice(0, 8))}</div>`).join('')}</div>`, 'la-hs') : '';

    main.innerHTML = kpi +
      section('Which campaigns give the most leads', `Leads per LinkedIn ad set, joined to the ad export by name for spend, CPL (spend ÷ the leads LinkedIn reports) and form completion (leads ÷ form opens). "LinkedIn reported" above "Leads in files" means some leads are not uploaded yet.${showPerf && !perf.length ? ' <b>No LinkedIn ad export covers these dates</b>, so spend and CPL are empty: upload it on the Upload CSVs page.' : ''}`, `<div class="chartbox tall"><canvas id="laCampChart"></canvas></div><div style="margin-top:12px">${campTable}</div>${camps.length > 40 ? `<p class="muted" style="font-size:12.5px">Top 40 of ${fmt(camps.length)} ad sets shown.</p>` : ''}`, 'la-camps') +
      section('How leads are coming', 'By the lead gen form, the lead type (from the campaign and form names, rules in Admin), the source and over time.', `<div class="grid g2" style="gap:16px">
          <div><div class="ui-label" style="margin-bottom:6px">By form</div>${countTable(byForm, 'Form')}</div>
          <div><div class="ui-label" style="margin-bottom:6px">By lead type</div><div class="chartbox short"><canvas id="laTypeChart"></canvas></div>${tbl([{ h: 'Lead type', k: 'key', left: true, f: r => esc(LEAD_LABELS[r.key] || r.key) }, { h: 'Leads', k: 'count', f: r => pick(`Lead type: ${LEAD_LABELS[r.key] || r.key}`, r.leads) }, { h: 'Share', k: 's', f: r => pct(r.count / list.length * 100, 0) }], byType)}</div>
          <div><div class="ui-label" style="margin-bottom:6px">By source and origin</div>${countTable(byOrigin, 'Source')}</div>
          <div><div class="row" style="align-items:center;gap:8px;margin-bottom:6px"><span class="ui-label">Leads over time, by source</span><span id="laGran"></span></div><div class="chartbox short"><canvas id="laTrendChart"></canvas></div></div>
        </div>`, 'la-how') + hsOrigin +
      section('Which companies', 'Companies matched to the GSI / SI account list (name or email domain), their tier, the band mix of their leads and the campaigns that brought them.', `${tiles([{ k: 'At target accounts', v: pick('Leads at target accounts', targetList), d: pct(k.target_share, 0) + ' of leads' }, { k: 'Not on the list', v: pick('Leads at companies not on the list', nonTarget), d: `${fmt(companies.filter(c => !c.target).length)} companies` }, ...tierGroups.map(t => ({ k: t.g, v: pick(`${t.g} accounts`, t.leads), d: t.g === 'Tier 1' ? 'GSI, Big Four, MBB' : 'SI and other target accounts' }))])}<div style="margin-top:12px">${companyTable}</div>${companies.length > 30 ? `<p class="muted" style="font-size:12.5px">Top 30 of ${fmt(companies.length)} companies shown; the lead list below has them all.</p>` : ''}`, 'la-companies') +
      section('Who', 'Seniority bands from the job title (MD, MD-1, MD-2 lists in Admin; a plain Director counts half MD-1, half MD-2), exact titles, LinkedIn seniority and where they are.', `<div class="grid g2" style="gap:16px">
          <div><div class="ui-label" style="margin-bottom:6px">Band mix</div><div class="chartbox short"><canvas id="laBandChart"></canvas></div>${tbl([{ h: 'Band', k: 'key', left: true, f: r => bandPill(r.key) }, { h: 'Leads', k: 'n', f: r => pick(`Band: ${r.key}`, r.leads) }, { h: 'Share', k: 's', f: r => pct(r.leads.length / list.length * 100, 0) }], bandRows)}</div>
          <div><div class="ui-label" style="margin-bottom:6px">Top exact titles</div>${countTable(titles, 'Title', { limit: 15, extra: [{ h: 'Band', k: 'b', f: r => r.key === '(no title)' ? '' : bandPill(L.bandOf({ title: r.key }, bands)) }] })}</div>
          <div><div class="ui-label" style="margin-bottom:6px">Region</div>${countTable(regionRows, 'Region')}<div class="ui-label" style="margin:12px 0 6px">Country</div>${countTable(countries, 'Country', { limit: 10 })}</div>
          <div><div class="ui-label" style="margin-bottom:6px">LinkedIn seniority</div>${seniority.length === 1 && seniority[0].key === '(not given)' ? '<p class="muted" style="font-size:13px">No seniority column in these leads. Add the Seniority question to the lead gen form, or rely on the bands from the title.</p>' : countTable(seniority, 'Seniority')}</div>
        </div>`, 'la-who') +
      section('Campaign × company', 'Which campaigns reached which companies. Click a cell for the leads.', heat, 'la-matrix') +
      screensSection() +
      section('All leads', 'Search, sort by any column, export.', `<div class="row" style="gap:8px;align-items:center;margin-bottom:8px"><input type="search" id="laQ" placeholder="Search name, email, company, title, campaign" value="${esc(S.q)}" style="flex:1;min-width:240px"><button class="btn tiny ghost" id="laCsv">Export CSV</button></div><div id="laList"></div>`, 'la-list') +
      `<div id="laAI" style="margin-top:18px"></div>`;

    // charts
    const topC = camps.filter(r => !noCamp(r)).slice(0, 12);
    chart(main.querySelector('#laCampChart'), { type: 'bar', data: { labels: topC.map(r => truncate(r.campaign, 42)), datasets: [{ label: 'Leads in files', data: topC.map(r => r.count), backgroundColor: NAVY }, ...(showPerf && perf.length ? [{ label: 'LinkedIn reported', data: topC.map(r => r.in_perf ? r.li_leads : null), backgroundColor: withAlpha(ORANGE, 0.75) }] : [])] }, options: { indexAxis: 'y', maintainAspectRatio: false, plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { afterLabel: c => { const r = topC[c.dataIndex]; return r.in_perf ? `Spend ${usd(r.spend)} · CPL ${usd(r.cpl, 2)}` : ''; } } } }, scales: { x: { beginAtZero: true, ticks: { precision: 0 } } }, onClick: (e, els) => { if (els[0]) { const r = topC[els[0].index]; if (r.leads.length) openList(`Campaign: ${r.campaign}`, r.leads); } } } });
    chart(main.querySelector('#laTypeChart'), { type: 'doughnut', data: { labels: byType.map(r => LEAD_LABELS[r.key] || r.key), datasets: [{ data: byType.map(r => r.count), backgroundColor: byType.map(r => LEAD_TYPE_COLORS[r.key] || '#B8B4AD') }] }, options: { maintainAspectRatio: false, plugins: { legend: { position: 'right' } }, onClick: (e, els) => { if (els[0]) { const r = byType[els[0].index]; openList(`Lead type: ${LEAD_LABELS[r.key] || r.key}`, r.leads); } } } });
    chart(main.querySelector('#laBandChart'), { type: 'doughnut', data: { labels: BANDS4, datasets: [{ data: BANDS4.map(b => Math.round(mix[b] * 10) / 10), backgroundColor: BANDS4.map(b => BAND_COLORS[b]) }] }, options: { maintainAspectRatio: false, plugins: { legend: { position: 'right' } } } });
    const drawTrend = () => {
      const old = charts.find(c => c.canvas && c.canvas.id === 'laTrendChart'); if (old) { old.destroy(); charts = charts.filter(c => c !== old); }
      const t = L.leadTrend(list, S.gran, l => l.source);
      chart(main.querySelector('#laTrendChart'), { type: 'bar', data: { labels: t.buckets.map(b => bucketLabel(b, S.gran)), datasets: t.keys.map((s, i) => ({ label: L.SOURCE_LABEL[s] || s, data: t.series[s], backgroundColor: SOURCE_COLORS[s] || seriesColor(i), stack: 'a' })) }, options: { maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } }, scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } } } } });
    };
    seg(main.querySelector('#laGran'), [{ value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }], v => { S.gran = v; drawTrend(); }, S.gran);
    drawTrend();
    wireScreenDeletes(main, ctx, rerender);

    // the list
    const drawList = () => {
      const box = main.querySelector('#laList'); if (!box) return;
      const q = S.q.trim().toLowerCase();
      let rows = q ? list.filter(l => [L.fullName(l), l.email, l.company, L.accountOf(l, accounts), l.title, l.campaign, l.form, l.country].join(' ').toLowerCase().includes(q)) : list.slice();
      const col = LIST_COLS.find(c => c.k === S.sort.key) || LIST_COLS[0];
      const val = l => col.v ? col.v(l) : l[col.k];
      rows.sort((a, b) => { const x = val(a) || '', y = val(b) || ''; if (!x && y) return 1; if (x && !y) return -1; return String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: 'base' }) * S.sort.dir; });
      box.innerHTML = `<div class="tblwrap"><table><thead><tr>${LIST_COLS.map(c => `<th class="${c.left ? 'l' : ''}" data-sort="${c.k}" style="cursor:pointer">${esc(c.h)}${S.sort.key === c.k ? (S.sort.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr></thead><tbody>${rows.slice(0, S.limit).map(l => `<tr class="lead" style="cursor:pointer" data-open="${l._id}">${LIST_COLS.map(c => `<td class="${c.left ? 'l' : ''}">${c.f(l)}</td>`).join('')}</tr>`).join('')}</tbody></table></div><p class="muted" style="font-size:12.5px">${fmt(Math.min(S.limit, rows.length))} of ${fmt(rows.length)} shown${rows.length > S.limit ? ' <button class="btn tiny ghost" data-more>Show 100 more</button>' : ''}</p>`;
      box.querySelectorAll('[data-sort]').forEach(th => th.onclick = () => { S.sort = { key: th.dataset.sort, dir: S.sort.key === th.dataset.sort ? -S.sort.dir : (th.dataset.sort === 'submitted_at' ? -1 : 1) }; drawList(); });
      box.querySelectorAll('[data-open]').forEach(tr => tr.onclick = () => openLead(tr.dataset.open, ''));
      const more = box.querySelector('[data-more]'); if (more) more.onclick = () => { S.limit += 100; drawList(); };
      main.querySelector('#laCsv').onclick = () => download(`lyzr-leads-${from}-to-${to}.csv`, csvOf(rows));
    };
    const qIn = main.querySelector('#laQ'); let qt = null;
    qIn.oninput = () => { clearTimeout(qt); qt = setTimeout(() => { S.q = qIn.value; S.limit = 50; drawList(); }, 200); };
    drawList();

    // AI read-out over the same aggregates, plus what the screenshots said
    const r1 = v => v == null ? null : Math.round(v * 10) / 10;
    ctx.mountInsights(main.querySelector('#laAI'), ctx, { scope: `lead-analytics:${from}:${to}:${S.source}`, kind: 'leads', title: 'What the leads say', inputProvider: () => ({
      page: 'lead-analytics', range: { from, to }, source: S.source,
      kpis: { total: k.total, linkedin_form_leads: k.linkedin, from_files: k.files, from_api: k.api, from_screenshots: k.screenshot, hubspot: k.hubspot, companies: k.companies, target_leads: k.target, target_share_pct: r1(k.target_share), md_band_share_pct: r1(k.md_share), bands: Object.fromEntries(Object.entries(mix).map(([b, v]) => [b, r1(v)])), linkedin_spend: r1(k.spend), linkedin_reported_leads: k.li_leads, form_opens: k.form_opens, blended_cpl: r1(k.cpl), form_completion_pct: r1(k.completion) },
      campaigns: camps.slice(0, 15).map(r => ({ campaign: r.campaign, group: r.campaign_group, leads_in_files: r.count, linkedin_reported: r.in_perf ? r.li_leads : null, spend: r.in_perf ? r1(r.spend) : null, cpl: r1(r.cpl), form_opens: r.in_perf ? r.form_opens : null, completion_pct: r1(r.completion), lead_type: r.lead_type, top_companies: r.top_companies })),
      forms: byForm.slice(0, 10).map(r => ({ form: r.key, leads: r.count })),
      lead_types: byType.map(r => ({ type: LEAD_LABELS[r.key] || r.key, leads: r.count })),
      sources: byOrigin.map(r => ({ source: r.key, leads: r.count })),
      companies: companies.slice(0, 20).map(c => ({ company: c.company, target: c.target, tier: c.tier, leads: c.count, bands: Object.fromEntries(Object.entries(c.bands).map(([b, v]) => [b, r1(v)])), campaigns: c.campaigns.slice(0, 3) })),
      titles: titles.slice(0, 15).map(r => ({ title: r.key, leads: r.count })), regions: regionRows.map(r => ({ region: r.key, leads: r.count })),
      screenshots: screens.slice(0, 12).map(s => ({ file: s.file_name, kind: s.kind, title: s.title, summary: s.summary, period: s.period, metrics: (s.metrics || []).slice(0, 40), leads: s.leads_count, notes: s.notes })),
    }) });
  }
  function screensSection() {
    return section('From screenshots', screens.length ? `What Claude read from ${fmt(screens.length)} uploaded screenshot${screens.length === 1 ? '' : 's'}, newest first, all dates (each says the period it shows). Leads in them are counted above with source Screenshot.` : 'Nothing read yet. Drop or paste a screenshot under "Add leads".', screens.map(s => screenCard(ctx, s, { canDelete: editor })).join(''), 'la-shots');
  }
  draw();
}
