// Leads analytics: HubSpot GSI leads by band, origin (form, lead source, campaign), funnel, status,
// trend, heat maps, owners, the full table and a Claude read-out. Every number on the page is a link:
// clicking it opens the leads behind it, and clicking a lead opens everything HubSpot holds on it
// (origin properties, the activity checklist with "none" where nothing was done, the timeline).
// Aggregation lives in js/lib/leads-agg.mjs and js/lib/lead-origin.mjs (unit-tested).
import { BANDS, enrich, applyFilters, summary, bucketCounts, withGrowth, crossTab, rowTotal, sourceBreakdown, ownerHealth, actionList, sortRows, toCsv, ownerKey, countBy, sortedEntries, clusterShort, sourceChannel, sourceDetail, recentActivity, gsiMatcher, hasActivity, funnelCounts, funnelFlags, FUNNEL_STAGES, funnelBySource, funnelSource, funnelByBucket, neverContacted, statusBreakdown, lastContactAt, firstContactAt, daysFrom, median, isFormLead, gsiCampaignsOf, replyType, share, isDemoBooked, isReached, statusLabel, lifecycleLabel } from '../lib/leads-agg.mjs';
import { originOf, originForm, originSource, originCampaign, originTraffic, groupRows, activityChecklist, missingWork, workSummary, timeline, LAST_OUTREACH_LABEL } from '../lib/lead-origin.mjs';
import { mountTrend } from '../trend.mjs';
import { sectionCompare, memoGet, deltaText } from '../compare.mjs';
import { BAND_COLORS, NAVY, ORANGE, TEAL, GREEN } from '../palette.mjs';

export const route = 'leads';
export const title = 'Leads analytics';

const S = { gran: 'week', funnelGran: 'auto', excludeSpam: true, gsiOnly: false, status: '', origin: '', q: '', sort: { key: 'created_at', dir: -1 }, heatPick: null, limit: 200 };
let chart = null, trendX = null, funnelCharts = [];
let FUNNEL_SEQ = 0;
const HIST = { rows: null, at: 0 };
function killFunnelCharts() { for (const c of funnelCharts) { try { c.destroy(); } catch {} } funnelCharts = []; }
export function destroy() { if (chart) { try { chart.destroy(); } catch {} chart = null; } killFunnelCharts(); if (trendX) { trendX.destroy(); trendX = null; } closeDrawer(); }
async function copyText(ctx, text, what) {
  try { await navigator.clipboard.writeText(text); }
  catch { const t = document.createElement('textarea'); t.value = text; t.style.position = 'fixed'; t.style.opacity = '0'; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); } catch {} t.remove(); }
  ctx.toast(`Copied ${what}`);
}

const COLORS = BAND_COLORS;
const BAND_COLS = BANDS.map(b => ({ key: b, label: b }));
const truncate = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; };
const bandOf = r => r.band || 'Unknown';

// ---- click-to-drill registry: every number is `pick(label, list)`; the delegated listener opens the drawer ----
const PICK = new Map();
let ACTIVE = null; // { ctx, byId, openList, openLead }
function escClose(e) { if (e.key === 'Escape') closeDrawer(); }
function closeDrawer() { const d = document.getElementById('leadDrawer'); if (d) d.remove(); document.removeEventListener('keydown', escClose); }

export async function render(el, ctx) {
  destroy();
  const { esc, fmt, pct, istDateTime, timeAgo, rangeLabel, bucketLabel, daysBetween } = ctx.fmt;
  const { tiles, pill, table, seg, section, spinner, empty } = ctx.ui;
  const { from, to } = ctx.state;
  const accounts = (ctx.settings && ctx.settings.accounts) || [];
  const now = Date.now();
  const head = `<div class="seghead">HubSpot · Leads</div><h1>GSI leads</h1><div class="intro"><b>GSI leads</b> are HubSpot contacts who submitted a form and work at a company on the GSI account list (Admin › GSI accounts). They are pulled from HubSpot every morning at 07:00 IST and counted by the date HubSpot created them, ${esc(rangeLabel(from, to))}. Every number on this page can be clicked to see the leads behind it, and every lead opens with its origin (form, lead source, campaign), the activity checklist and the timeline from HubSpot.</div>`;
  el.innerHTML = head + spinner('Loading HubSpot leads');
  let data;
  try { data = await ctx.api.get('hubspot', { from, to }); } catch (e) { el.innerHTML = head + `<div class="empty">HubSpot data could not be loaded: ${esc(e.message || e)}</div>`; return; }
  const gsiOf = gsiMatcher((ctx.settings && ctx.settings.gsi_companies) || []);
  // Every pulled lead is at a GSI account (hubspot/refresh.js rules); extra names from Admin add to it.
  const decorate = list => list.map(r => ({ ...r, gsi: r.account || gsiOf(r), channel: sourceChannel(r), detail: sourceDetail(r), recent: recentActivity(r), origin: originOf(r) }));
  // Only form leads count (isFormLead: HubSpot first conversion date set). Contacts an older pull rule stored are left out everywhere.
  const pulled = data.contacts || [];
  const nonFormN = pulled.filter(c => !isFormLead(c)).length;
  const all = decorate(enrich(pulled.filter(isFormLead), data.notes_by_contact || {}, accounts));
  const scopeLine = nonFormN ? `<p class="muted" id="scopeLine" style="font-size:12.5px;margin:-4px 0 12px">${fmt(nonFormN)} contact${nonFormN === 1 ? '' : 's'} in the store ${nonFormN === 1 ? 'is' : 'are'} not form leads (pulled by an older rule) and ${nonFormN === 1 ? 'is' : 'are'} left out; the next full HubSpot pull removes them.</p>` : '';
  // whole history for week-on-week / month-on-month (cached 10 minutes)
  { try { const d = await ctx.api.get('hubspot', {}); HIST.rows = decorate(enrich((d.contacts || []).filter(isFormLead), {}, accounts)); HIST.at = Date.now(); } catch { HIST.rows = all; } }
  if (!all.length) { el.innerHTML = head + scopeLine + empty(`No HubSpot leads for ${rangeLabel(from, to)}. Widen the range, or refresh HubSpot from the`, `<a href="#/hubspot/messaging">messaging view</a>.`); return; }
  const bandPill = b => pill(b || 'Unknown', b === 'MD' ? 'p-high' : b === 'MD-1' ? 'p-med' : b === 'MD-2' ? 'p-low' : 'p-na');
  const spamN = all.filter(r => r.spam).length;
  const byId = new Map(all.map(r => [String(r.hs_id), r]));
  for (const r of HIST.rows || []) if (!byId.has(String(r.hs_id))) byId.set(String(r.hs_id), r);

  // The page filters (tests / spam, GSI only, status, origin), applied the same way to the range, the comparison range and the lifetime pull.
  const filterRows = list => applyFilters(list, { excludeSpam: S.excludeSpam }).filter(r => (!S.gsiOnly || r.gsi) && (!S.status || (r.lead_status || 'No status') === S.status) && (!S.origin || originForm(r) === S.origin || originSource(r) === S.origin || originCampaign(r) === S.origin));
  let FUNNEL = null; // what the Sales funnel section last drew, for the AI read-out

  // ---- the drawer: a list of leads, or one lead in full ----
  const pick = (label, list, text) => { const id = 'p' + PICK.size; PICK.set(id, { label, list }); return `<a href="#" class="pick" data-pick="${id}" title="Show these ${fmt(list.length)} lead${list.length === 1 ? '' : 's'}">${text != null ? text : fmt(list.length)}</a>`; };
  const workGlyphs = r => workSummary(r).map(w => `<span class="${w.done ? 'ok' : 'miss'}" title="${esc(w.label)}: ${w.done ? 'done' : 'none'}">${esc(w.label)} ${w.done ? '✓' : '✗'}</span>`).join(' · ');
  function drawerShell(inner, title) {
    closeDrawer();
    const d = document.createElement('aside'); d.className = 'drawer'; d.id = 'leadDrawer'; d.style.width = 'min(760px,100vw)';
    d.innerHTML = `<button class="btn tiny ghost x" data-x>Close</button>${inner}`;
    document.body.appendChild(d);
    d.querySelector('[data-x]').onclick = closeDrawer;
    d.addEventListener('click', ev => {
      const cp = ev.target.closest('[data-copy]'); if (cp) { copyText(ctx, cp.dataset.copy, cp.dataset.what || cp.dataset.copy); return; }
      const back = ev.target.closest('[data-back]'); if (back) { const p = PICK.get(back.dataset.back); if (p) openList(p.label, p.list, back.dataset.back); return; }
      const lead = ev.target.closest('[data-lead]'); if (lead) { ev.preventDefault(); openLead(lead.dataset.lead, lead.dataset.from || ''); }
    });
    document.addEventListener('keydown', escClose);
    return d;
  }
  function openList(label, list, pickId) {
    const sorted = [...list].sort((a, b) => (a.created_at || '') < (b.created_at || '') ? 1 : -1);
    const emails = sorted.map(r => r.email).filter(Boolean);
    const csv = toCsv(sorted, LIST_COLS.map(c => ({ h: c.h, f: c.csv || (r => r[c.k]) })));
    drawerShell(`<div class="seghead">Leads · ${esc(rangeLabel(from, to))}</div><h2 style="margin:4px 0 6px">${esc(label)}: ${fmt(sorted.length)} lead${sorted.length === 1 ? '' : 's'}</h2>
      <p style="margin:0 0 10px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn tiny" data-copy="${esc(emails.join('\n'))}" data-what="${fmt(emails.length)} emails">Copy ${fmt(emails.length)} emails</button><button class="btn tiny ghost" data-csv>Export CSV</button><span class="muted" style="font-size:12.5px;align-self:center">Click a lead for its origin, activity checklist and timeline.</span></p>
      <div class="tblwrap"><table><thead><tr>${LIST_COLS.map(c => `<th class="${c.left ? 'l' : ''}">${esc(c.h)}</th>`).join('')}</tr></thead><tbody>${sorted.slice(0, 500).map(r => `<tr class="lead" data-lead="${esc(r.hs_id)}" data-from="${esc(pickId || '')}">${LIST_COLS.map(c => `<td class="${c.left ? 'l' : ''}">${c.f(r)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>${sorted.length > 500 ? `<p class="muted" style="font-size:12.5px">First 500 shown; export the CSV for all ${fmt(sorted.length)}.</p>` : ''}`, label);
    const d = document.getElementById('leadDrawer');
    d.querySelector('[data-csv]').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })); a.download = `lyzr-leads-${label.replace(/[^\w]+/g, '-').toLowerCase()}.csv`; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); };
  }
  const LIST_COLS = [
    { h: 'Lead', k: 'name', left: true, f: r => `<b>${esc(r.name)}</b><br><span class="muted" style="font-size:11.5px">${esc(r.jobtitle || '')}</span>`, csv: r => r.name },
    { h: 'Company', k: 'company', left: true, f: r => r.account ? `<b>${esc(r.account)}</b>` : esc(r.company_raw || '–'), csv: r => r.account || r.company_raw || '' },
    { h: 'Band', k: 'band', f: r => bandPill(r.band), csv: r => r.band || '' },
    { h: 'Origin', k: 'origin', left: true, f: r => `${esc(truncate(r.origin.label, 40))}${r.origin.campaign ? `<br><span class="muted" style="font-size:11.5px">${esc(truncate(r.origin.campaign, 40))}</span>` : ''}`, csv: r => r.origin.label + (r.origin.campaign ? ' · ' + r.origin.campaign : '') },
    { h: 'Owner', k: 'owner_name', f: r => r.owner_name ? esc(r.owner_name) : '<span class="down">none</span>', csv: r => r.owner_name || '' },
    { h: 'Status', k: 'lead_status', f: r => esc(statusLabel(r.lead_status) || 'none'), csv: r => statusLabel(r.lead_status) },
    { h: 'Created', k: 'created_at', f: r => esc(istDateTime(r.created_at)), csv: r => istDateTime(r.created_at) },
    { h: 'Activity', k: 'work', left: true, f: r => `<span style="font-size:11.5px">${workGlyphs(r)}</span>`, csv: r => missingWork(r).length ? 'missing: ' + missingWork(r).join(', ') : 'all done' },
    { h: 'Email', k: 'email', left: true, f: r => `<span class="muted" style="font-size:11.5px">${esc(r.email || '')}</span>`, csv: r => r.email || '' },
  ];
  function openLead(id, fromPick) {
    const r = byId.get(String(id)); if (!r) return;
    const o = r.origin || originOf(r), checks = activityChecklist(r), tl = timeline(r), p = r.props || {};
    const row = (k, v) => v ? `<tr><td class="l muted" style="white-space:nowrap">${esc(k)}</td><td class="l">${v}</td></tr>` : '';
    const link = r.linkedin || p.linkedin_profile_link || p.hs_linkedin_url || p.pb_linkedin_profile_url;
    const inst = gsiCampaignsOf(r);
    drawerShell(`${fromPick ? `<button class="btn tiny ghost" data-back="${esc(fromPick)}" style="margin-right:6px">← Back to the list</button>` : ''}<div class="seghead" style="margin-top:8px">Lead</div><h2 style="margin:4px 0 2px">${esc(r.name)}</h2>
      <p style="margin:0 0 6px">${esc(r.jobtitle || 'no title')} ${bandPill(r.band)} · ${r.account ? `<b>${esc(r.account)}</b>` : esc(r.company_raw || 'no company')}${r.company_type ? ` <span class="muted">(${esc(r.company_type)})</span>` : ''} · ${esc(r.region || 'Other')}${r.country ? ` / ${esc(r.country)}` : ''}</p>
      <p style="margin:0 0 10px;display:flex;gap:8px;flex-wrap:wrap;align-items:center"><span class="mono" style="font-size:12.5px">${esc(r.email || '')}</span>${r.email ? `<button class="btn tiny" data-copy="${esc(r.email)}">Copy email</button>` : ''}${link ? `<a class="btn tiny ghost" href="${esc(link)}" target="_blank" rel="noopener">LinkedIn</a>` : ''}<span class="muted" style="font-size:12px">HubSpot id ${esc(r.hs_id)}</span></p>
      ${r.spam ? `<p class="note" style="font-size:12.5px">Flagged: ${esc(r.spam)}</p>` : ''}
      <div class="grid g2" style="gap:12px">
        <div class="card"><h3 style="margin-top:0">Where it came from</h3><table class="kv"><tbody>
          ${row('Form', o.form ? esc(o.form) + (o.formType && o.formType !== o.form ? ` <span class="muted">(${esc(o.formType)})</span>` : '') : o.formType ? esc(o.formType) : '<span class="down">no form name</span>')}
          ${row('Submitted', o.formAt ? esc(istDateTime(o.formAt)) + (o.submissions > 1 ? ` · ${fmt(o.submissions)} submissions, last ${esc(o.recentForm || '')} ${esc(istDateTime(o.recentFormAt))}` : '') : '')}
          ${row('Lead source', o.leadSource ? esc(o.leadSource) + (o.leadSourceCategory ? ` <span class="muted">· ${esc(o.leadSourceCategory)}</span>` : '') : '<span class="muted">not set</span>')}
          ${row('Campaign', o.campaign ? esc(o.campaign) + ` <span class="muted">(${esc(o.campaignVia)})</span>` : '<span class="muted">none recorded</span>')}
          ${row('UTM', [o.utm.source && 'source ' + o.utm.source, o.utm.medium && 'medium ' + o.utm.medium, o.utm.campaign && 'campaign ' + o.utm.campaign, o.utm.content && 'content ' + o.utm.content].filter(Boolean).map(esc).join(' · '))}
          ${row('Traffic source', o.traffic ? esc(o.traffic) + (o.trafficDetail ? ` <span class="muted">› ${esc(o.trafficDetail)}</span>` : '') : '')}
          ${row('Latest source', o.latest ? esc(o.latest) + (o.latestDetail ? ` <span class="muted">› ${esc(o.latestDetail)}</span>` : '') + (o.latestAt ? ` <span class="muted">${esc(timeAgo(o.latestAt))}</span>` : '') : '')}
          ${row('Record source', esc(o.recordSource))}${row('Conversion page', esc(o.conversionPage))}${row('Ad campaign id', esc(o.adCampaignId))}${row('Product', esc(o.product))}
          ${row('Also in Instantly', inst.length ? esc(inst.map(x => x.campaign_name).join(', ')) : '')}
        </tbody></table></div>
        <div class="card"><h3 style="margin-top:0">Where it stands</h3><table class="kv"><tbody>
          ${row('Lead status', esc(statusLabel(r.lead_status) || 'not set'))}${row('Lifecycle', esc(lifecycleLabel(r.lifecycle) || ''))}${row('Owner', r.owner_name ? esc(r.owner_name) : '<span class="down">none</span>')}
          ${row('Last outreach', p.last_outreach_activity ? esc(LAST_OUTREACH_LABEL[p.last_outreach_activity] || p.last_outreach_activity) : '')}
          ${row('Contacted', (Number(p.num_contacted_notes) || 0) ? `${fmt(p.num_contacted_notes)} time${Number(p.num_contacted_notes) === 1 ? '' : 's'}, last ${esc(timeAgo(lastContactAt(r)))}` : '<span class="down">never</span>')}
          ${row('Replied', replyType(r) ? esc({ human: 'yes, a human reply', auto: 'automatic reply only', unknown: 'yes, type unknown' }[replyType(r)]) : '<span class="muted">no</span>')}
          ${row('Demo', isDemoBooked(r) ? esc(statusLabel(r.lead_status) || lifecycleLabel(r.lifecycle)) : '<span class="muted">not booked</span>')}
          ${row('Scores', [r.lsa_score != null ? 'LSA ' + fmt(r.lsa_score) : '', p.lyzr_lead_score ? 'Lyzr ' + fmt(p.lyzr_lead_score) + (p.lyzr_lead_score_category ? ' (' + p.lyzr_lead_score_category + ')' : '') : '', p.hubspotscore ? 'HubSpot ' + fmt(p.hubspotscore) : '', p.lsa_lead_type ? String(p.lsa_lead_type).replace('_', ' ') : ''].filter(Boolean).map(esc).join(' · '))}
          ${row('Next activity', p.notes_next_activity_date ? esc(istDateTime(p.notes_next_activity_date)) : '<span class="muted">none scheduled</span>')}
          ${row('Created', esc(istDateTime(r.created_at)) + (r.last_modified ? ` · modified ${esc(timeAgo(r.last_modified))}` : ''))}
        </tbody></table></div>
      </div>
      ${r.lsa_message ? `<div class="card" style="margin-top:12px"><h3 style="margin-top:0">Message on the form</h3><p style="font-size:13.5px;white-space:pre-wrap">${esc(r.lsa_message)}</p></div>` : ''}
      <h3 style="margin-top:16px">Activity checklist</h3>
      <div class="tblwrap"><table><thead><tr><th class="l">What</th><th class="l">Done</th><th class="l">When</th><th class="l">Detail</th></tr></thead><tbody>${checks.map(k => `<tr><td class="l">${esc(k.label)}</td><td class="l">${k.done ? '<span class="ok">✓ yes</span>' : `<span class="${k.work ? 'miss' : 'muted'}">✗ none</span>`}</td><td class="l">${k.at ? esc(istDateTime(k.at)) + ` <span class="muted">(${esc(timeAgo(k.at))})</span>` : k.done ? '<span class="muted">no date</span>' : ''}</td><td class="l muted" style="font-size:12.5px">${esc(k.detail || '')}</td></tr>`).join('')}</tbody></table></div>
      <h3 style="margin-top:16px">Timeline <span class="muted" style="font-weight:400;font-size:13px">${fmt(tl.length)} dated events</span></h3>
      ${tl.length ? `<ul class="tline">${tl.map(e => `<li class="${e.kind === 'next' ? 'demo' : e.kind}"><b>${esc(e.label)}</b> <span class="muted">· ${esc(istDateTime(e.ts))}</span>${e.detail ? `<br><span style="font-size:12.5px">${esc(e.detail)}</span>` : ''}</li>`).join('')}</ul>` : '<p class="muted">Nothing dated beyond the creation.</p>'}`, r.name);
  }
  ACTIVE = { openList, openLead };
  if (!el._leadsWired) { el._leadsWired = true; el.addEventListener('click', ev => { if (!ACTIVE) return; const a = ev.target.closest('[data-pick]'); if (a) { ev.preventDefault(); const p = PICK.get(a.dataset.pick); if (p) ACTIVE.openList(p.label, p.list, a.dataset.pick); return; } const l = ev.target.closest('[data-lead]'); if (l) { ev.preventDefault(); ACTIVE.openLead(l.dataset.lead, ''); } }); }

  function draw() {
    destroy(); PICK.clear();
    const rows = filterRows(all);
    const cmpFunnel = sectionCompare(ctx, 'leads:funnel', p => drawFunnel(p));
    const byStatus = crossTab(rows, r => r.lead_status || 'No status', bandOf);
    const statuses = [...new Set(all.map(r => r.lead_status || 'No status'))].sort();
    const gsiRows = rows.filter(r => r.gsi);
    const s = summary(rows);
    const buckets = withGrowth(bucketCounts(rows, S.gran, ctx.fmt.bucketKey));
    const byRegionBand = crossTab(rows, r => r.region || 'Other', bandOf);
    const targetRows = rows.filter(r => r.account);
    const byAccountBand = crossTab(targetRows, r => r.account, bandOf);
    const byAccountBucket = crossTab(targetRows, r => r.account, r => ctx.fmt.bucketKey(r.day, S.gran));
    const bySourceBand = crossTab(rows, r => r.channel, bandOf);
    const sources = sourceBreakdown(rows.map(r => ({ ...r, lead_source: r.channel })));
    const owners = ownerHealth(rows, now);
    const actions = actionList(rows, now, 7);
    const bucketKeys = buckets.map(b => b.key);
    const days = daysBetween(from, to);
    const sub = (list, test) => list.filter(test);
    const never = neverContacted(rows);
    const originOpts = [...new Set([...groupRows(rows, originForm).map(g => g.key), ...groupRows(rows, originSource).map(g => g.key), ...groupRows(rows, originCampaign).map(g => g.key)])].filter(k => !/^No /.test(k)).sort();
    // origin tables: form, lead source, campaign, traffic source; every count a link
    const originTable = (title, keyFn, note) => { const groups = groupRows(rows, keyFn); return `<div><h3 style="margin:14px 0 4px">${esc(title)}</h3>${note ? `<p class="muted" style="font-size:12.5px;margin:0 0 8px">${note}</p>` : ''}${table({ cols: [
      { h: title, k: 'key', left: true, f: g => `<b>${esc(g.key)}</b>` }, { h: 'Leads', k: 'n', f: g => `<b>${pick(`${title}: ${g.key}`, g.rows)}</b>` }, { h: 'Share', k: 'share', f: g => pct(g.rows.length / Math.max(1, rows.length) * 100, 0) },
      ...BANDS.filter(b => b !== 'Unknown').map(b => ({ h: b, k: b, f: g => { const l = sub(g.rows, r => bandOf(r) === b); return l.length ? pick(`${title}: ${g.key} · ${b}`, l) : '<span class="muted">–</span>'; } })),
      { h: 'Target accounts', k: 'target', f: g => { const l = sub(g.rows, r => r.account); return l.length ? pick(`${title}: ${g.key} · target accounts`, l) : '–'; } },
      { h: 'Reached out', k: 'reached', f: g => { const l = sub(g.rows, isReached); return `${l.length ? pick(`${title}: ${g.key} · reached out`, l) : '0'} <span class="muted">(${pct(l.length / Math.max(1, g.rows.length) * 100, 0)})</span>`; } },
      { h: 'Never contacted', k: 'never', f: g => { const l = sub(g.rows, r => !isReached(r)); return l.length ? `<span class="down">${pick(`${title}: ${g.key} · never contacted`, l)}</span>` : '0'; } },
      { h: 'Demo booked', k: 'booked', f: g => { const l = sub(g.rows, isDemoBooked); return l.length ? pick(`${title}: ${g.key} · demo booked`, l) : '0'; } },
    ], rows: groups })}</div>`; };

    el.innerHTML = head + scopeLine + `
      <div class="toc"><span class="tl">On this page</span><a href="#l-tiles">Numbers</a><a href="#l-origin">Origin</a><a href="#l-funnel">Sales funnel</a><a href="#l-status">Lead status</a><a href="#l-wow">Week / month</a><a href="#l-trend">Band trend</a><a href="#l-heat">Heat maps</a><a href="#l-sources">Sources</a><a href="#l-health">Follow-up health</a><a href="#l-table">All leads</a><a href="#l-ai">AI read-out</a>
        <span style="margin-left:auto;display:flex;gap:14px;align-items:center;font-size:12.5px;flex-wrap:wrap"><label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="gsiToggle" ${S.gsiOnly ? 'checked' : ''}> GSI leads only</label>
        <label style="display:flex;gap:6px;align-items:center">Origin <select id="originSel"><option value="">All forms, sources and campaigns</option>${originOpts.map(x => `<option ${S.origin === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></label>
        <label style="display:flex;gap:6px;align-items:center">Status <select id="statusSel"><option value="">All</option>${statuses.map(x => `<option ${S.status === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></label>
        <label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="spamToggle" ${S.excludeSpam ? 'checked' : ''}> Exclude ${fmt(spamN)} tests / spam</label></span></div>
      ${section('Leads in range', 'Click any number to see the leads behind it.', tiles([
        { k: 'Leads', v: pick('All leads in range', rows), d: `${fmt(s.leads / Math.max(1, days) * 30, 0)} a month at this pace` },
        { k: 'MD', v: pick('MD leads', sub(rows, r => r.band === 'MD')), d: pct(s.leads ? s.md / s.leads * 100 : null, 0) + ' of leads' },
        { k: 'MD-1', v: pick('MD-1 leads', sub(rows, r => r.band === 'MD-1')), d: pct(s.leads ? s.md1 / s.leads * 100 : null, 0) + ' of leads' },
        { k: 'MD-2', v: pick('MD-2 leads', sub(rows, r => r.band === 'MD-2')), d: pct(s.leads ? s.md2 / s.leads * 100 : null, 0) + ' of leads' },
        { k: 'Other / unknown band', v: pick('Other or unknown band', sub(rows, r => r.band !== 'MD' && r.band !== 'MD-1' && r.band !== 'MD-2')), d: `${fmt(s.unknown)} with no title` },
        { k: 'Target-account share', v: pct(s.leads ? s.target / s.leads * 100 : null, 0), d: `${pick('Leads at named target accounts', targetRows)} leads at named accounts` },
        { k: 'With activity', v: pct(s.leads ? s.withActivity / s.leads * 100 : null, 0), d: `${pick('Leads with notes or a logged touch', sub(rows, hasActivity))} with notes or a logged touch` },
        { k: 'Never contacted', v: pick('Never contacted', never), d: never.length ? `oldest since ${esc(ctx.fmt.dayLabel(never[0].day))}` : 'every lead was contacted' },
        { k: 'Unowned', v: pick('Leads with no owner', sub(rows, r => !ownerKey(r))), d: s.unowned ? 'need an owner' : 'all leads owned' },
        { k: 'GSI leads', v: pick('GSI leads (company on the GSI list)', gsiRows), d: `${pct(s.leads ? gsiRows.length / s.leads * 100 : null, 0)} of leads, company on the GSI list` },
        { k: 'Demo booked', v: pick('Demo booked', sub(rows, isDemoBooked)), d: 'lead status, lifecycle or deal says so' },
        { k: 'No status set', v: pick('No lead status set', sub(rows, r => !r.lead_status)), d: 'lead status empty in HubSpot' },
      ]), 'l-tiles')}

      ${section('Where the leads came from', 'What HubSpot recorded at entry, read from the contact properties: the <b>form</b> (First conversion, Lead Form Type), the <b>Lead Source</b> picklist (Book a Demo, LinkedIn, a playbook, an event, Contact Us...), the <b>campaign</b> (Lead Campaign Name, then the UTM campaign, then HubSpot\'s converting campaign) and the <b>traffic source</b> HubSpot attributed the first visit to. The same lead appears once in each table. Pick an origin in the bar above to filter the whole page to it.', `<div id="originBox">${originTable('Form', originForm, 'first_conversion_event_name; Lead Form Type in brackets when it differs')}${originTable('Lead source', originSource, 'lead_source, the HubSpot picklist sales fills')}${originTable('Campaign', originCampaign, 'lead_campaign_name, else utm_campaign / first-touch UTM, else the converting campaign, else the ad campaign id')}${originTable('Traffic source', originTraffic, 'hs_analytics_source: how the first visit arrived (organic, paid social, direct, referral, offline import...)')}</div>`, 'l-origin')}

      ${section('Sales funnel', `What sales did with the leads created in range. <b>Reached out</b> = HubSpot "Number of times contacted" or "Last contacted" is set, or a call, email or meeting is logged. <b>Replied (human)</b> = the lead wrote back themselves: a human reply email was read by the sync, or (before reply emails are stored) HubSpot shows a sales email reply and the reply was judged human. Leads whose only replies were automatic (out of office and similar) are shown beside it as <b>auto-reply only</b>, and replies with nothing to say who wrote them as <b>reply type unknown</b>; neither passes the Replied step. <b>Demo booked</b> = lead status Demo Booked, any Demo or Intro Call status, Associated with a deal, or lifecycle MQL, SQL, Opportunity or Customer (an MQL is someone trying to book). <b>Demo completed</b> = a Demo Completed or Intro Call Completed status. <b>Sales prospect</b> = lifecycle SQL, Opportunity or Customer, or Associated with a deal. The funnel bars keep only leads that passed every earlier step; "any path" counts every lead at that stage whatever was logged before it. ${cmpFunnel.html()}`, `<div id="funnelBody">${spinner('Loading the funnel')}</div>`, 'l-funnel')}

      ${section('Lead status', 'HubSpot lead status (hs_lead_status) by band, with how many have any logged activity. Pick a status in the bar above to filter the whole page.', table({ cols: [
        { h: 'Lead status', k: 'st', left: true, f: r => `<b>${esc(r.st)}</b>` }, ...BANDS.map(b => ({ h: b, k: b, f: r => r[b] ? pick(`${r.st} · ${b}`, sub(r.list, x => bandOf(x) === b)) : '0' })), { h: 'Total', k: 'total', f: r => `<b>${pick(`Lead status ${r.st}`, r.list)}</b>` },
        { h: 'With activity', k: 'act', f: r => `${r.act ? pick(`${r.st} · with activity`, sub(r.list, hasActivity)) : '0'} (${pct(r.total ? r.act / r.total * 100 : null, 0)})` }, { h: 'GSI', k: 'gsi', f: r => r.gsi ? pick(`${r.st} · GSI`, sub(r.list, x => x.gsi)) : '0' }, { h: 'Unowned', k: 'un', f: r => r.un ? `<span class="down">${pick(`${r.st} · unowned`, sub(r.list, x => !ownerKey(x)))}</span>` : '0' },
      ], rows: [...byStatus.entries()].map(([st, m]) => { const list = rows.filter(r => (r.lead_status || 'No status') === st); return { st, list, ...Object.fromEntries(m), total: rowTotal(m), act: list.filter(hasActivity).length, gsi: list.filter(r => r.gsi).length, un: list.filter(r => !ownerKey(r)).length }; }).sort((a, b) => b.total - a.total) }), 'l-status')}

      ${section('Week on week and month on month', 'Every lead in the HubSpot pull, not only the selected range (the range is the darker bars). Toggle metrics, compare with the previous period or the average of earlier ones, and see the period in progress against the same days of earlier ones.', '<div id="wowBox"></div>', 'l-wow')}

      ${section('Band trend', 'New leads per period, stacked by band. Growth compares each period with the one before it; the last period may be partial.', `<div id="granSeg"></div><div class="card"><div class="chartbox"><canvas id="trendChart"></canvas></div></div>
        <div style="margin-top:14px">${table({ cols: [
          { h: 'Period', k: 'key', left: true, f: r => esc(bucketLabel(r.key, S.gran)) },
          ...BANDS.map(b => ({ h: b, k: b, f: r => r[b] ? pick(`${bucketLabel(r.key, S.gran)} · ${b}`, sub(rows, x => ctx.fmt.bucketKey(x.day, S.gran) === r.key && bandOf(x) === b)) : '0' })),
          { h: 'Total', k: 'total', f: r => `<b>${pick(`Leads created ${bucketLabel(r.key, S.gran)}`, sub(rows, x => ctx.fmt.bucketKey(x.day, S.gran) === r.key))}</b>` },
          { h: 'Growth', k: 'growth', f: r => r.growth == null ? '<span class="muted">–</span>' : `<span class="${r.growth >= 0 ? 'up' : 'down'}">${r.growth > 0 ? '+' : ''}${fmt(r.growth * 100, 0)}%</span>` },
        ], rows: buckets, total: { key: 'Total', ...Object.fromEntries(BANDS.map(b => [b, fmt(s[b === 'MD' ? 'md' : b === 'MD-1' ? 'md1' : b === 'MD-2' ? 'md2' : b === 'Other' ? 'other' : 'unknown'])])), total: fmt(s.leads), growth: '' } })}</div>`, 'l-trend')}

      ${section('Heat maps', 'Where the leads sit. Cells are counts on a square-root scale; click a cell to list the people behind it.', `<div class="grid g2">
        <div class="card"><h3>Region × band</h3><div id="heatRegion"></div>${ctx.heat.legend()}</div>
        <div class="card"><h3>Source × band</h3><div id="heatSource"></div>${ctx.heat.legend()}</div>
        <div class="card"><h3>Account × band</h3><p class="muted" style="font-size:12.5px;margin-bottom:8px">Named target accounts only. ${pick('Leads outside the target list', sub(rows, r => !r.account))} leads are outside the target list.</p><div id="heatAccount"></div>${ctx.heat.legend('navy')}</div>
        <div class="card"><h3>Account × ${S.gran}</h3><div id="heatAccountBucket" style="overflow-x:auto"></div>${ctx.heat.legend('navy')}</div>
      </div>`, 'l-heat')}

      ${section('Sources', 'Where each lead came from by channel: GSI form (any source field mentions GSI), LinkedIn lead form, then the HubSpot original source (organic search, paid social, direct, referral, offline import and so on), with the band mix and how many of each source are at target accounts.', table({ cols: [
        { h: 'Source', k: 'source', left: true, f: r => esc(r.source) }, { h: 'Leads', k: 'leads', f: r => pick(`Source ${r.source}`, sub(rows, x => x.channel === r.source)) }, { h: 'Share', k: 'share', f: r => pct(r.leads / s.leads * 100, 0) },
        { h: 'MD', k: 'MD', f: r => r.MD ? pick(`${r.source} · MD`, sub(rows, x => x.channel === r.source && x.band === 'MD')) : '0' }, { h: 'MD-1', k: 'MD-1', f: r => r['MD-1'] ? pick(`${r.source} · MD-1`, sub(rows, x => x.channel === r.source && x.band === 'MD-1')) : '0' }, { h: 'MD-2', k: 'MD-2', f: r => r['MD-2'] ? pick(`${r.source} · MD-2`, sub(rows, x => x.channel === r.source && x.band === 'MD-2')) : '0' }, { h: 'Other', k: 'Other', f: r => fmt(r.Other + r.Unknown) },
        { h: 'MD / MD-1 share', k: 'mdshare', f: r => pct((r.MD + r['MD-1']) / r.leads * 100, 0) }, { h: 'Target accounts', k: 'target', f: r => `${r.target ? pick(`${r.source} · target accounts`, sub(rows, x => x.channel === r.source && x.account)) : '0'} (${pct(r.target / r.leads * 100, 0)})` }, { h: 'With message', k: 'withMessage', f: r => fmt(r.withMessage) }, { h: 'With activity', k: 'active', f: r => pct(r.active / r.leads * 100, 0) },
      ], rows: sources }), 'l-sources')}

      ${section('Follow-up health', 'Who is working the leads. "Idle days" is the average age of leads that have no note or logged activity at all. The action list below is the set of MD and MD-1 leads at target accounts with no activity for 7 or more days.', `<div class="grid g2">
        <div>${table({ cols: [
          { h: 'Owner', k: 'owner', left: true, f: r => r.owner === 'Unassigned' ? '<span class="down">Unassigned</span>' : esc(r.owner) }, { h: 'Leads', k: 'leads', f: r => pick(`Owner ${r.owner}`, sub(rows, x => (ownerKey(x) || 'Unassigned') === r.owner)) }, { h: 'MD / MD-1', k: 'md', f: r => r.md ? pick(`${r.owner} · MD and MD-1`, sub(rows, x => (ownerKey(x) || 'Unassigned') === r.owner && (x.band === 'MD' || x.band === 'MD-1'))) : '0' }, { h: 'Target', k: 'target', f: r => r.target ? pick(`${r.owner} · target accounts`, sub(rows, x => (ownerKey(x) || 'Unassigned') === r.owner && x.account)) : '0' },
          { h: 'With activity', k: 'active', f: r => `${r.active ? pick(`${r.owner} · with activity`, sub(rows, x => (ownerKey(x) || 'Unassigned') === r.owner && hasActivity(x))) : '0'} (${pct(r.activeShare * 100, 0)})` }, { h: 'Untouched', k: 'idle', f: r => { const l = sub(rows, x => (ownerKey(x) || 'Unassigned') === r.owner && !hasActivity(x)); return l.length ? `<span class="down">${pick(`${r.owner} · untouched`, l)}</span>` : '0'; } }, { h: 'Last activity', k: 'lastActivity', f: r => r.lastActivity ? esc(timeAgo(r.lastActivity)) : '<span class="muted">none</span>' }, { h: 'Idle days (untouched)', k: 'avgIdleDays', f: r => r.avgIdleDays == null ? '<span class="muted">–</span>' : fmt(r.avgIdleDays, 0) },
        ], rows: owners })}</div>
        <div class="card"><h3>Action list: ${pick('Senior target-account leads idle 7+ days', actions)} senior target-account leads idle 7+ days</h3>${actions.length ? `<div style="max-height:420px;overflow:auto">${actions.slice(0, 60).map(r => `<div class="lead" data-lead="${esc(r.hs_id)}" style="border-top:1px solid var(--line);padding:8px 0;display:flex;gap:8px;flex-wrap:wrap;align-items:baseline;cursor:pointer"><b>${esc(r.name)}</b><span class="muted">${esc(r.account)}${r.jobtitle ? ' · ' + esc(r.jobtitle) : ''}</span>${bandPill(r.band)}<span style="margin-left:auto" class="${r.idleDays >= 14 ? 'down' : ''}">${fmt(r.idleDays)} d ${r.touched ? 'since last touch' : 'untouched'}</span><span class="muted" style="flex-basis:100%;font-size:12.5px">${r.owner_name ? 'Owner ' + esc(r.owner_name) : '<span class="down">No owner</span>'} · created ${esc(istDateTime(r.created_at))} · missing: ${esc(missingWork(r).slice(0, 4).join(', ') || 'nothing')}</span></div>`).join('')}</div>` : '<p class="muted">Nothing outstanding. Every senior target-account lead was touched in the last 7 days.</p>'}</div>
      </div>`, 'l-health')}

      ${section('All leads', 'Search, click a header to sort, click a lead for its full record, export what you see as CSV.', `<div class="row" style="margin-bottom:10px"><input type="search" id="leadQ" placeholder="Search name, company, title, form, campaign, message" value="${esc(S.q)}" style="min-width:280px"><span class="muted" id="leadCount" style="font-size:12.5px"></span><button class="btn tiny" id="csvBtn" style="margin-left:auto">Export CSV</button></div><div id="leadTable"></div>`, 'l-table')}
      ${section('AI read-out', 'Claude reads the aggregates on this page.', `<div id="leadsInsights"></div>`, 'l-ai')}`;

    // ---- wiring ------------------------------------------------------------------------------
    el.querySelector('#spamToggle').onchange = e => { S.excludeSpam = e.target.checked; draw(); };
    el.querySelector('#gsiToggle').onchange = e => { S.gsiOnly = e.target.checked; draw(); };
    el.querySelector('#statusSel').onchange = e => { S.status = e.target.value; draw(); };
    el.querySelector('#originSel').onchange = e => { S.origin = e.target.value; draw(); };
    const histRows = (HIST.rows || all).filter(r => (!S.excludeSpam || !r.spam) && (!S.gsiOnly || r.gsi));
    trendX = mountTrend(el.querySelector('#wowBox'), ctx, { id: 'leads', items: histRows, dayOf: r => r.day, range: { from, to }, defaults: { gran: 'week', metrics: ['leads', 'mdmd1', 'gsi'], compare: 'avg' }, metrics: [
      { key: 'leads', label: 'Leads', additive: true, fn: l => l.length },
      { key: 'mdmd1', label: 'MD + MD-1', additive: true, fn: l => l.filter(r => r.band === 'MD' || r.band === 'MD-1').length },
      { key: 'md2', label: 'MD-2', additive: true, fn: l => l.filter(r => r.band === 'MD-2').length },
      { key: 'gsi', label: 'GSI leads', additive: true, fn: l => l.filter(r => r.gsi).length },
      { key: 'target', label: 'Target-account leads', additive: true, fn: l => l.filter(r => r.account).length },
      { key: 'demo', label: 'Book a demo form', additive: true, fn: l => l.filter(r => /book.?a.?demo/i.test(originForm(r) + ' ' + originSource(r))).length },
      { key: 'gsiform', label: 'GSI form', additive: true, fn: l => l.filter(r => r.channel === 'GSI form').length },
      { key: 'booked', label: 'Demo booked', additive: true, fn: l => l.filter(isDemoBooked).length },
      { key: 'active', label: 'Worked (any activity)', additive: true, fn: l => l.filter(hasActivity).length },
      { key: 'seniorShare', label: 'MD + MD-1 share', fmt: 'pct', axis: 'right', fn: l => l.length ? l.filter(r => r.band === 'MD' || r.band === 'MD-1').length / l.length * 100 : null },
    ], note: 'Counted by HubSpot create date (IST). "Worked" is judged today, so older periods look better worked than recent ones.' });
    seg(el.querySelector('#granSeg'), [{ value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }], v => { S.gran = v; draw(); }, S.gran);

    // ---- sales funnel (its own comparison control; only this section redraws) ----------------
    cmpFunnel.wire(el);
    const loadRows = async params => { const d = await memoGet(ctx, 'hubspot', params); return filterRows(decorate(enrich((d.contacts || []).filter(isFormLead), d.notes_by_contact || {}, accounts))); };
    const dark = matchMedia('(prefers-color-scheme: dark)').matches;
    const axisInk = dark ? '#B8B4AD' : '#6B675F', gridInk = dark ? '#34353A' : '#E3E1DE', legendInk = dark ? '#F1F0EE' : '#1F2022';
    async function drawFunnel(p) {
      const box = el.querySelector('#funnelBody'); if (!box) return;
      const seq = ++FUNNEL_SEQ;
      box.innerHTML = spinner('Loading the funnel');
      const [prevRows, lifeRows] = await Promise.all([p ? loadRows({ from: p.from, to: p.to }).catch(() => []) : [], loadRows({}).catch(() => null)]);
      if (seq !== FUNNEL_SEQ || !el.isConnected || el.querySelector('#funnelBody') !== box) return;
      killFunnelCharts();
      const F = funnelCounts(rows), FP = funnelCounts(prevRows), FL = lifeRows ? funnelCounts(lifeRows) : null;
      const gran = S.funnelGran === 'auto' ? (days > 70 ? 'month' : 'week') : S.funnelGran;
      const bySource = funnelBySource(rows);
      const byBucket = funnelByBucket(rows, gran, ctx.fmt.bucketKey);
      const statuses = statusBreakdown(rows);
      const medLast = median(rows.map(r => daysFrom(r.created_at, lastContactAt(r))).filter(x => x != null));
      const medFirst = median(rows.map(r => daysFrom(r.created_at, firstContactAt(r))).filter(x => x != null));
      const lifeFirst = lifeRows && lifeRows.length ? lifeRows.reduce((m, r) => !m || r.day < m ? r.day : m, null) : null;
      const RS = F.replies;
      const pctOf = v => v == null ? '<span class="muted">–</span>' : pct(v * 100, 0);
      // the leads behind each stage: chain = passed every earlier step, any = the stage flag alone
      const flags = rows.map(r => [r, funnelFlags(r)]);
      const stageLists = {}; for (let i = 0; i < FUNNEL_STAGES.length; i++) { const k = FUNNEL_STAGES[i].key; stageLists[k] = { any: flags.filter(([, f]) => f[k]).map(([r]) => r), chain: flags.filter(([, f]) => FUNNEL_STAGES.slice(0, i + 1).every(st => f[st.key])).map(([r]) => r) }; }
      const stageRow = st => ({ ...st, prevN: FP.cumulative[st.key] });
      const byType = t => rows.filter(r => replyType(r) === t);
      FUNNEL = { range: { from, to, generated: F.generated, cumulative: F.cumulative, raw: F.raw }, comparison: p ? { label: p.label, generated: FP.generated, cumulative: FP.cumulative, raw: FP.raw } : null, lifetime: FL ? { since: lifeFirst, generated: FL.generated, cumulative: FL.cumulative, raw: FL.raw } : null, origin: { forms: groupRows(rows, originForm).slice(0, 12).map(g => ({ form: g.key, leads: g.rows.length, demoBooked: g.rows.filter(isDemoBooked).length, neverContacted: g.rows.filter(r => !isReached(r)).length })), leadSources: groupRows(rows, originSource).slice(0, 12).map(g => ({ source: g.key, leads: g.rows.length, demoBooked: g.rows.filter(isDemoBooked).length })), campaigns: groupRows(rows, originCampaign).slice(0, 12).map(g => ({ campaign: g.key, leads: g.rows.length, demoBooked: g.rows.filter(isDemoBooked).length })) }, replies: { human: RS.human, autoOnly: RS.auto, unknown: RS.unknown }, bySource: bySource.slice(0, 8), byBucket: byBucket.slice(-8).map(b => ({ period: b.key, generated: b.generated, reached: b.reached, replied: b.replied, booked: b.booked, completed: b.completed, prospect: b.prospect, medianDaysToContact: b.medianDaysToContact })), neverContacted: { count: never.length, oldestSince: never[0] ? never[0].day : null }, medianDaysToLastContact: medLast, statuses: statuses.slice(0, 12).map(x => ({ status: x.label, n: x.n, countsAs: x.countsAs })) };

      box.innerHTML = `
        <h3>Replies</h3>
        <div id="replySplit">${tiles([
          { k: 'Human reply', v: pick('Human reply', byType('human')), d: `${pctOf(share(RS.human, F.generated))} of leads; counts as Replied` },
          { k: 'Auto-reply only', v: pick('Auto-reply only', byType('auto')), d: 'out of office or similar, no human reply' },
          { k: 'Reply type unknown', v: pick('Reply type unknown', byType('unknown')), d: 'HubSpot shows a reply, no reply email stored yet' },
          { k: 'No reply', v: pick('No reply yet', rows.filter(r => !replyType(r))), d: 'nothing came back' },
        ])}</div>

        <div class="grid g2w" style="margin-top:18px">
          <div class="card"><h3>Leads created ${esc(rangeLabel(from, to))}</h3><div class="chartbox short"><canvas id="funnelChart"></canvas></div></div>
          <div>${table({ cols: [
            { h: 'Stage', k: 'label', left: true, f: st => `<b>${esc(st.label)}</b>${st.key === 'replied' ? `<br><span class="muted" style="font-size:11.5px">auto-reply only ${fmt(RS.auto)} · reply type unknown ${fmt(RS.unknown)}</span>` : ''}` },
            { h: 'Leads', k: 'n', f: st => `<b>${pick(`${st.label} (passed every earlier step)`, stageLists[st.key].chain)}</b>` },
            { h: 'Of generated', k: 'g', f: st => pctOf(st.ofGenerated) },
            { h: 'Of previous step', k: 'p', f: st => st.ofPrev == null ? '<span class="muted">–</span>' : pctOf(st.ofPrev) },
            { h: 'Any path', k: 'raw', f: st => st.raw === st.n ? pick(`${st.label} (any path)`, stageLists[st.key].any) : `${pick(`${st.label} (any path)`, stageLists[st.key].any)} <span class="muted">(+${fmt(st.raw - st.n)})</span>` },
            { h: 'Not there yet', k: 'no', f: st => st.key === 'generated' ? '–' : pick(`Not yet: ${st.label}`, rows.filter(r => !funnelFlags(r)[st.key])) },
            { h: p ? `vs ${esc(p.label)}` : 'Comparison', k: 'd', left: true, f: st => deltaText(p, st.n, st.prevN) + (p && st.prevN ? ` <span class="muted">(${fmt(st.prevN)})</span>` : '') },
          ], rows: F.steps.map(stageRow) })}
          <p class="muted" style="font-size:12.5px;margin-top:8px">Median time from lead to last contact: ${medLast == null ? 'no contact dates yet' : fmt(medLast, 1) + ' days'}${medFirst != null && medLast != null && Math.abs(medFirst - medLast) >= 0.5 ? ` (first contact ${fmt(medFirst, 1)} days)` : ''}. HubSpot's "Last contacted" is the last touch, so the first touch is only known when calls, emails or meetings are logged.</p></div>
        </div>

        <h3 style="margin-top:18px">Lifetime <span class="muted" style="font-weight:400;font-size:13px">all leads pulled so far${FL ? `: ${fmt(FL.generated)} leads${lifeFirst ? ` since ${esc(ctx.fmt.dayLabel(lifeFirst))}` : ''}` : ''}</span></h3>
        ${FL ? tiles(FL.steps.map(st => ({ k: st.label, v: pick(`${st.label} · lifetime`, (() => { const i = FUNNEL_STAGES.findIndex(x => x.key === st.key); return lifeRows.filter(r => { const f = funnelFlags(r); return FUNNEL_STAGES.slice(0, i + 1).every(x => f[x.key]); }); })()), d: `${st.ofGenerated == null ? '' : pct(st.ofGenerated * 100, 0) + ' of all leads'}${st.raw !== st.n ? ` · ${fmt(st.raw)} any path` : ''}` }))) : '<p class="muted">The lifetime pull could not be loaded.</p>'}

        <div style="margin-top:18px">
          <div><h3>By source</h3><p class="muted" style="font-size:12.5px;margin-bottom:8px">HubSpot lead source first (Book a demo form, LinkedIn, Contact us, a playbook or asset form, events, outbound), else the analytics source. Each column counts every lead that reached that stage, whatever path it took.</p>${table({ cols: [
            { h: 'Source', k: 'source', left: true, f: r => esc(r.source) }, { h: 'Generated', k: 'generated', f: r => `<b>${pick(`Source ${r.source}`, rows.filter(x => funnelSource(x) === r.source))}</b>` },
            { h: 'Reached out', k: 'reached', f: r => `${r.reached ? pick(`${r.source} · reached out`, rows.filter(x => funnelSource(x) === r.source && isReached(x))) : '0'} <span class="muted">(${pct(r.generated ? r.reached / r.generated * 100 : null, 0)})</span>` }, { h: 'Not contacted', k: 'nc', f: r => { const l = rows.filter(x => funnelSource(x) === r.source && !isReached(x)); return l.length ? `<span class="down">${pick(`${r.source} · never contacted`, l)}</span>` : '0'; } }, { h: 'Replied (human)', k: 'replied', f: r => r.replied ? pick(`${r.source} · replied`, rows.filter(x => funnelSource(x) === r.source && replyType(x) === 'human')) : '0' }, { h: 'Auto only', k: 'autoOnly', f: r => fmt(r.autoOnly || 0) },
            { h: 'Demo booked', k: 'booked', f: r => r.booked ? pick(`${r.source} · demo booked`, rows.filter(x => funnelSource(x) === r.source && isDemoBooked(x))) : '0' }, { h: 'Demo completed', k: 'completed', f: r => fmt(r.completed) }, { h: 'Prospects', k: 'prospect', f: r => fmt(r.prospect) },
          ], rows: bySource, total: { source: 'Total', generated: fmt(F.generated), reached: `${fmt(F.raw.reached)} (${pct(F.generated ? F.raw.reached / F.generated * 100 : null, 0)})`, nc: fmt(never.length), replied: fmt(F.raw.replied), autoOnly: fmt(RS.auto), booked: fmt(F.raw.booked), completed: fmt(F.raw.completed), prospect: fmt(F.raw.prospect) } })}</div>
          <div style="margin-top:18px"><h3>Lead status in HubSpot</h3><p class="muted" style="font-size:12.5px;margin-bottom:8px">What HubSpot calls each lead right now (hs_lead_status, portal label) and which funnel stage that status counts as.</p>${table({ cols: [
            { h: 'Status', k: 'label', left: true, f: r => r.label === r.status || !r.status ? esc(r.label) : `${esc(r.label)} <span class="muted">(${esc(r.status)})</span>` }, { h: 'Leads', k: 'n', f: r => `<b>${pick(`Status ${r.label}`, rows.filter(x => (statusLabel(x.lead_status) || 'No status') === r.label || (x.lead_status || 'No status') === r.status))}</b>` },
            { h: 'Reached out', k: 'reached', f: r => fmt(r.reached) }, { h: 'Replied (human)', k: 'replied', f: r => fmt(r.replied) },
            { h: 'Counts as', k: 'countsAs', f: r => r.countsAs ? pill(r.countsAs, r.countsAs === 'Sales prospect' ? 'p-high' : r.countsAs === 'Demo completed' ? 'p-med' : 'p-low') : '<span class="muted">–</span>' },
          ], rows: statuses })}</div>
        </div>

        <h3 style="margin-top:18px">Outreach by date</h3>
        <p class="muted" style="font-size:12.5px;margin-bottom:8px">Leads by the ${gran} HubSpot created them, and how many of each ${gran}'s leads sales has reached out to since (judged today, so older periods look better worked than recent ones). "Days to contact" is the median from lead to last contact.</p>
        <div id="funnelGranSeg" style="margin-bottom:10px"></div>
        <div class="card"><div class="chartbox short"><canvas id="outreachChart"></canvas></div></div>
        <div style="margin-top:14px">
          <div>${table({ cols: [
            { h: gran === 'month' ? 'Month' : 'Week', k: 'key', left: true, f: b => esc(bucketLabel(b.key, gran)) }, { h: 'Leads', k: 'generated', f: b => `<b>${pick(`Leads created ${bucketLabel(b.key, gran)}`, rows.filter(x => ctx.fmt.bucketKey(x.day, gran) === b.key))}</b>` },
            { h: 'Reached out', k: 'reached', f: b => b.reached ? pick(`${bucketLabel(b.key, gran)} · reached out`, rows.filter(x => ctx.fmt.bucketKey(x.day, gran) === b.key && isReached(x))) : '0' }, { h: 'Not yet', k: 'notReached', f: b => b.notReached ? `<span class="down">${pick(`${bucketLabel(b.key, gran)} · not contacted`, rows.filter(x => ctx.fmt.bucketKey(x.day, gran) === b.key && !isReached(x)))}</span>` : '0' }, { h: '% reached', k: 'reachedShare', f: b => pctOf(b.reachedShare) },
            { h: 'Days to contact', k: 'medianDaysToContact', f: b => b.medianDaysToContact == null ? '<span class="muted">–</span>' : fmt(b.medianDaysToContact, 1) },
            { h: 'Replied (human)', k: 'replied', f: b => fmt(b.replied) + (b.autoOnly ? ` <span class="muted">(+${fmt(b.autoOnly)} auto)</span>` : '') }, { h: 'Demos', k: 'booked', f: b => `${b.booked ? pick(`${bucketLabel(b.key, gran)} · demo booked`, rows.filter(x => ctx.fmt.bucketKey(x.day, gran) === b.key && isDemoBooked(x))) : '0'}${b.completed ? ` <span class="muted">(${fmt(b.completed)} done)</span>` : ''}` },
          ], rows: byBucket })}</div>
        </div>
        <div class="card" style="margin-top:14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap"><span>${never.length ? `<b>${pick('Never contacted', never)}</b> lead${never.length === 1 ? '' : 's'} created in range ${never.length === 1 ? 'has' : 'have'} never been contacted; oldest since <b>${esc(ctx.fmt.dayLabel(never[0].day))}</b> (${esc(timeAgo(never[0].created_at))}).` : 'Every lead created in range has been contacted at least once.'}</span>${never.length ? `<button class="btn tiny" id="copyNever" style="margin-left:auto">Copy ${fmt(never.filter(r => r.email).length)} emails</button>` : ''}</div>`;

      seg(box.querySelector('#funnelGranSeg'), [{ value: 'auto', label: days > 70 ? 'Auto (month)' : 'Auto (week)' }, { value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }], v => { S.funnelGran = v; drawFunnel(p); }, S.funnelGran);
      const copyBtn = box.querySelector('#copyNever');
      if (copyBtn) copyBtn.onclick = () => { const list = never.filter(r => r.email).map(r => r.email); copyText(ctx, list.join('\n'), `${list.length} emails`); };

      if (typeof Chart !== 'undefined') {
        const barOpts = extra => ({ responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: legendInk, boxWidth: 12 } }, tooltip: { mode: 'index' } }, ...extra });
        funnelCharts.push(new Chart(box.querySelector('#funnelChart'), { type: 'bar', data: { labels: F.steps.map(st => st.label), datasets: [
          { label: 'Passed every earlier step', data: F.steps.map(st => st.n), backgroundColor: NAVY, borderWidth: 0 },
          { label: 'Any path', data: F.steps.map(st => st.raw), backgroundColor: TEAL, borderWidth: 0 },
        ] }, options: barOpts({ indexAxis: 'y', scales: { x: { beginAtZero: true, ticks: { precision: 0, color: axisInk }, grid: { color: gridInk } }, y: { ticks: { color: axisInk }, grid: { display: false } } } }) }));
        funnelCharts.push(new Chart(box.querySelector('#outreachChart'), { type: 'bar', data: { labels: byBucket.map(b => bucketLabel(b.key, gran)), datasets: [
          { label: 'Reached out', data: byBucket.map(b => b.reached), backgroundColor: NAVY, borderWidth: 0, stack: 'a' },
          { label: 'Not yet reached', data: byBucket.map(b => b.notReached), backgroundColor: ORANGE, borderWidth: 0, stack: 'a' },
          { label: 'Demo booked', data: byBucket.map(b => b.booked), backgroundColor: GREEN, borderWidth: 0, stack: 'b' },
        ] }, options: barOpts({ scales: { x: { stacked: true, grid: { display: false }, ticks: { color: axisInk } }, y: { stacked: true, beginAtZero: true, ticks: { precision: 0, color: axisInk }, grid: { color: gridInk } } } }) }));
      }
    }
    drawFunnel(cmpFunnel.prev);

    // chart
    if (typeof Chart !== 'undefined') {
      chart = new Chart(el.querySelector('#trendChart'), { type: 'bar', data: { labels: buckets.map(b => bucketLabel(b.key, S.gran)), datasets: BANDS.filter(b => b !== 'Unknown' || rows.some(r => r.band === 'Unknown')).map(b => ({ label: b, data: buckets.map(x => x[b]), backgroundColor: COLORS[b], borderWidth: 0, stack: 'a' })) },
        options: { responsive: true, maintainAspectRatio: false, scales: { x: { stacked: true, grid: { display: false }, ticks: { color: axisInk } }, y: { stacked: true, beginAtZero: true, ticks: { precision: 0, color: axisInk }, grid: { color: gridInk } } }, plugins: { legend: { position: 'bottom', labels: { color: legendInk, boxWidth: 12 } }, tooltip: { mode: 'index' } } } });
    }

    // heat maps: a cell click opens the leads behind it in the drawer
    const heatFrom = (m, cols, elId, color, onClick) => ctx.heat.renderHeat(el.querySelector(elId), { corner: '', rows: [...m.keys()].map(k => ({ key: k, label: k })), cols, cell: (r, c) => ({ v: (m.get(r) || new Map()).get(c) || 0 }), rowTotal: r => fmt(rowTotal(m.get(r))), colTotal: c => fmt([...m.values()].reduce((a, row) => a + (row.get(c) || 0), 0)), color, onClick });
    const pickCell = (kind, r, c) => {
      const list = rows.filter(x => kind === 'region' ? (x.region || 'Other') === r && bandOf(x) === c : kind === 'source' ? x.channel === r && bandOf(x) === c : kind === 'account' ? x.account === r && bandOf(x) === c : x.account === r && ctx.fmt.bucketKey(x.day, S.gran) === c);
      const label = kind === 'accountBucket' ? `${r} · ${bucketLabel(c, S.gran)}` : `${r} · ${c}`;
      if (list.length) openList(label, list, '');
    };
    heatFrom(byRegionBand, BAND_COLS, '#heatRegion', 'orange', (r, c) => pickCell('region', r, c));
    heatFrom(bySourceBand, BAND_COLS, '#heatSource', 'orange', (r, c) => pickCell('source', r, c));
    if (byAccountBand.size) heatFrom(byAccountBand, BAND_COLS, '#heatAccount', 'navy', (r, c) => pickCell('account', r, c)); else el.querySelector('#heatAccount').innerHTML = '<p class="muted">No target-account leads in range.</p>';
    if (byAccountBucket.size) heatFrom(byAccountBucket, bucketKeys.map(k => ({ key: k, label: bucketLabel(k, S.gran) })), '#heatAccountBucket', 'navy', (r, c) => pickCell('accountBucket', r, c)); else el.querySelector('#heatAccountBucket').innerHTML = '<p class="muted">No target-account leads in range.</p>';

    // full table
    const COLS = [
      { k: 'name', h: 'Name', left: true, f: r => `<b>${esc(r.name)}</b><br><span class="muted" style="font-size:11.5px">${esc(r.email || '')}</span>`, csv: r => r.name },
      { k: 'company', h: 'Account / company', left: true, g: r => r.account || r.company_raw || '', f: r => r.account ? `<b>${esc(r.account)}</b>` : esc(r.company_raw || '–'), csv: r => r.account || r.company_raw || '' },
      { k: 'jobtitle', h: 'Title', left: true, f: r => esc(r.jobtitle || '–') },
      { k: 'band', h: 'Band', f: r => bandPill(r.band) },
      { k: 'region', h: 'Region', f: r => esc(r.region || 'Other'), csv: r => r.region || 'Other' },
      { k: 'origin', h: 'Form / lead source', left: true, g: r => r.origin.label, f: r => `${esc(truncate(r.origin.form || r.origin.formType || '–', 42))}<br><span class="muted" style="font-size:11.5px">${esc(truncate(r.origin.leadSource || r.origin.traffic || '', 42))}</span>`, csv: r => `${r.origin.form || r.origin.formType || ''}${r.origin.leadSource ? ' · ' + r.origin.leadSource : ''}` },
      { k: 'campaign', h: 'Campaign', left: true, g: r => r.origin.campaign, f: r => r.origin.campaign ? `<span title="${esc(r.origin.campaignVia)}">${esc(truncate(r.origin.campaign, 36))}</span>` : '<span class="muted">–</span>', csv: r => r.origin.campaign },
      { k: 'status', h: 'Lead status', g: r => r.lead_status || '', f: r => r.lead_status ? esc(statusLabel(r.lead_status)) : '<span class="muted">none</span>', csv: r => statusLabel(r.lead_status) },
      { k: 'owner', h: 'Owner', g: r => ownerKey(r), f: r => r.owner_name ? esc(r.owner_name) : '<span class="down">none</span>', csv: r => r.owner_name || '' },
      { k: 'created_at', h: 'Created (IST)', f: r => esc(istDateTime(r.created_at)), csv: r => istDateTime(r.created_at) },
      { k: 'work', h: 'Activity done', left: true, g: r => workSummary(r).filter(w => w.done).length, f: r => `<span style="font-size:11.5px;white-space:nowrap">${workGlyphs(r)}</span>`, csv: r => missingWork(r).length ? 'missing: ' + missingWork(r).join(', ') : 'all done' },
      { k: 'recent', h: 'Most recent', g: r => r.recent ? r.recent.ts : '', f: r => r.recent ? `<b style="font-weight:600">${esc(r.recent.label)}</b> · ${esc(timeAgo(r.recent.ts))}${r.recent.detail ? `<br><span class="muted" style="font-size:11.5px" title="${esc(r.recent.detail)}">${esc(truncate(r.recent.detail, 60))}</span>` : ''}` : '<span class="muted">nothing logged</span>', csv: r => r.recent ? `${r.recent.label} · ${istDateTime(r.recent.ts)}${r.recent.detail ? ' · ' + r.recent.detail : ''}` : '' },
      { k: 'lsa_message', h: 'Message', left: true, f: r => r.lsa_message ? `<span title="${esc(r.lsa_message)}">${esc(truncate(r.lsa_message, 70))}</span>` : '<span class="muted">–</span>' },
    ];
    let shown = [];
    function drawTable() {
      const q = S.q.toLowerCase();
      const list = q ? rows.filter(r => [r.name, r.email, r.company_raw, r.account, r.jobtitle, r.lsa_message, r.origin.label, r.origin.form, r.origin.leadSource, r.origin.campaign, r.owner_name, r.lead_status].join(' ').toLowerCase().includes(q)) : rows;
      const col = COLS.find(c => c.k === S.sort.key) || COLS.find(c => c.k === 'created_at');
      shown = sortRows(list, col.k, S.sort.dir, col.g);
      el.querySelector('#leadCount').innerHTML = `${pick(S.q ? `Search "${S.q}"` : 'All leads shown', shown, fmt(Math.min(shown.length, S.limit)) + ' of ' + fmt(shown.length))} shown${S.q ? ` for "${esc(S.q)}"` : ''}`;
      el.querySelector('#leadTable').innerHTML = `<div class="tblwrap"><table><thead><tr>${COLS.map(c => `<th class="${c.left ? 'l' : ''}" data-sort="${c.k}" style="cursor:pointer;user-select:none">${esc(c.h)}${S.sort.key === c.k ? (S.sort.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr></thead><tbody>${shown.slice(0, S.limit).map(r => `<tr class="lead" data-lead="${esc(r.hs_id)}">${COLS.map(c => `<td class="${c.left ? 'l' : ''}">${c.f(r)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>${shown.length > S.limit ? `<p class="muted" style="font-size:12.5px;margin-top:6px"><button class="btn tiny" id="moreBtn">Show ${fmt(Math.min(200, shown.length - S.limit))} more</button></p>` : ''}`;
      el.querySelectorAll('th[data-sort]').forEach(th => th.onclick = () => { const k = th.dataset.sort; S.sort = { key: k, dir: S.sort.key === k ? -S.sort.dir : (k === 'created_at' || k === 'work' || k === 'recent' ? -1 : 1) }; drawTable(); });
      const more = el.querySelector('#moreBtn'); if (more) more.onclick = () => { S.limit += 200; drawTable(); };
    }
    drawTable();
    let t = null; el.querySelector('#leadQ').oninput = e => { clearTimeout(t); t = setTimeout(() => { S.q = e.target.value.trim(); S.limit = 200; drawTable(); }, 150); };
    el.querySelector('#csvBtn').onclick = () => {
      const csv = toCsv(shown, COLS.map(c => ({ h: c.h, f: c.csv || c.g || (r => r[c.k]) })).concat([{ h: 'Reply type', f: r => ({ human: 'human', auto: 'auto-reply only', unknown: 'unknown' })[replyType(r)] || '' }, { h: 'Form type', f: r => r.origin.formType }, { h: 'UTM', f: r => [r.origin.utm.source, r.origin.utm.medium, r.origin.utm.campaign].filter(Boolean).join(' / ') }, { h: 'Traffic source', f: r => r.origin.traffic + (r.origin.trafficDetail ? ' › ' + r.origin.trafficDetail : '') }, { h: 'Record source', f: r => r.origin.recordSource }, { h: 'Country', f: r => r.country }, { h: 'HubSpot id', f: r => r.hs_id }]));
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })); a.download = `lyzr-leads-${from}-to-${to}.csv`; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
      ctx.toast(`Exported ${fmt(shown.length)} leads`);
    };

    // AI
    ctx.mountInsights(el.querySelector('#leadsInsights'), ctx, { scope: `leads:${from}:${to}`, kind: 'leads', title: 'What the lead mix says', inputProvider: () => ({
      range: { from, to, days }, summary: s, bands: { MD: s.md, 'MD-1': s.md1, 'MD-2': s.md2, Other: s.other, Unknown: s.unknown },
      trend: buckets.map(b => ({ period: b.key, total: b.total, MD: b.MD, 'MD-1': b['MD-1'], 'MD-2': b['MD-2'], growth: b.growth })),
      regions: [...byRegionBand.entries()].map(([k, m]) => ({ region: k, total: rowTotal(m), ...Object.fromEntries(m) })),
      accounts: [...byAccountBand.entries()].map(([k, m]) => ({ account: k, total: rowTotal(m), ...Object.fromEntries(m) })).sort((a, b) => b.total - a.total).slice(0, 25),
      sources: sources.map(x => ({ source: x.source, leads: x.leads, MD: x.MD, 'MD-1': x['MD-1'], 'MD-2': x['MD-2'], target: x.target, active: x.active })),
      origin: { forms: groupRows(rows, originForm).slice(0, 10).map(g => ({ form: g.key, leads: g.rows.length, neverContacted: g.rows.filter(r => !isReached(r)).length, demoBooked: g.rows.filter(isDemoBooked).length })), leadSources: groupRows(rows, originSource).slice(0, 10).map(g => ({ source: g.key, leads: g.rows.length })), campaigns: groupRows(rows, originCampaign).slice(0, 10).map(g => ({ campaign: g.key, leads: g.rows.length })) },
      owners: owners.map(o => ({ owner: o.owner, leads: o.leads, active: o.active, md: o.md, avgIdleDays: o.avgIdleDays })),
      clusters: Object.fromEntries(sortedEntries(countBy(rows.filter(r => r.cluster), r => clusterShort(r.cluster)))),
      lead_status: [...byStatus.entries()].map(([k, m]) => ({ status: k, total: rowTotal(m) })), gsi_leads: gsiRows.length, channels: Object.fromEntries(sortedEntries(countBy(rows, r => r.channel))),
      missing_work: Object.fromEntries(sortedEntries(countBy(rows.flatMap(r => missingWork(r)), x => x))),
      actionCount: actions.length, actionSample: actions.slice(0, 15).map(r => ({ account: r.account, title: r.jobtitle, band: r.band, owner: r.owner_name, idleDays: r.idleDays, missing: missingWork(r).slice(0, 3) })),
      funnel: FUNNEL,
    }) });
  }
  draw();
}
