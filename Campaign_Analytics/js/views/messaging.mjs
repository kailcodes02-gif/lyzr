// HubSpot messaging: what form-fill leads are asking, by intent cluster, account, region and
// company type, with the actual messages and a Claude read-out per slice.
import { CLUSTERS, clusterLabel, clusterShort, enrich, applyFilters, summary, countBy, sortedEntries, hasMessage, hasActivity, ownerKey, COMPANY_TYPES, BANDS } from '../lib/leads-agg.mjs';

export const route = 'messaging';
export const title = 'HubSpot messaging';

// View state survives re-renders (date range changes) but not navigation away.
const S = { f: { region: '', account: '', companyType: '', band: '', owner: '', cluster: '', hasMessage: '', hasActivity: '', excludeSpam: true }, dim: 'account', value: '' };
let root = null;
export function destroy() { root = null; }

const bandPill = (b, pill) => pill(b || 'Unknown', b === 'MD' ? 'p-high' : b === 'MD-1' ? 'p-med' : b === 'MD-2' ? 'p-low' : 'p-na');
const tagCls = c => c.account ? 'background:rgba(31,122,77,.12);color:var(--good);border-color:transparent' : (c.via || []).includes('company') ? 'background:rgba(4,62,119,.1);color:var(--navy);border-color:transparent' : '';
const ctry = c => c.country ? ` (${shortCountry(c.country)})` : '';
const shortCountry = c => ({ 'United States': 'US', 'United Kingdom': 'UK', 'United Arab Emirates': 'UAE', 'India': 'IN', 'Australia': 'AU', 'Canada': 'CA', 'Singapore': 'SG', 'Sweden': 'SE', 'Saudi Arabia': 'SA', 'Oman': 'OM', 'Ireland': 'IE', 'Germany': 'DE', 'Japan': 'JP', 'Sri Lanka': 'LK', 'Netherlands': 'NL', 'Hong Kong': 'HK' }[c] || c);
const truncate = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; };
const selectHtml = (id, label, options, cur, esc) => `<label class="field"><span class="muted">${esc(label)}</span><select data-f="${id}"><option value="">All</option>${options.map(o => { const [v, l] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(l)}</option>`; }).join('')}</select></label>`;

export async function render(el, ctx) {
  root = el;
  const { esc, fmt, pct, istDateTime, timeAgo, rangeLabel } = ctx.fmt;
  const { tiles, pill, table, seg, section, spinner, empty } = ctx.ui;
  const { from, to } = ctx.state;
  const accounts = (ctx.settings && ctx.settings.accounts) || [];
  const editors = (ctx.settings && ctx.settings.editors) || [];
  const isEditor = !!ctx.demo || !editors.length || editors.map(e => String(e).toLowerCase()).includes(String((ctx.user || {}).email || '').toLowerCase());

  const head = (syncHtml) => `<div class="seghead">Channel · HubSpot</div><h1>HubSpot messaging</h1>
    <p class="sub">What form-fill leads are asking, grouped by intent, and how that changes by account, region and company type. Leads are counted by HubSpot create date, ${esc(rangeLabel(from, to))}.</p>
    <div class="card" style="display:flex;gap:14px;align-items:center;flex-wrap:wrap;margin-bottom:18px">${syncHtml}</div>`;

  el.innerHTML = head(spinner('Loading HubSpot contacts'));
  let data;
  try { data = await ctx.api.get('hubspot', { from, to }); }
  catch (e) { el.innerHTML = head(`<span class="err">HubSpot data could not be loaded: ${esc(e.message || e)}</span>`); return; }

  const ls = data.last_sync || null;
  const syncHtml = `<div><b>Last sync</b> <span class="muted">${ls && ls.finished_at ? `${esc(istDateTime(ls.finished_at))} (${esc(timeAgo(ls.finished_at))}) · ${fmt(ls.contacts)} contacts, ${fmt(ls.notes)} notes${ls.status && ls.status !== 'done' ? ' · ' + esc(ls.status) : ''}${ls.error ? ' · ' + esc(ls.error) : ''}` : 'never'}</span></div>
    <span style="margin-left:auto"></span>
    ${isEditor ? `<button class="btn tiny primary" id="hsRefresh">Refresh from HubSpot</button>` : `<span class="muted" style="font-size:12.5px">Only editors can refresh</span>`}
    <span id="hsProg" class="muted" style="font-size:12.5px;flex-basis:100%"></span>`;

  const all = enrich(data.contacts || [], data.notes_by_contact || {}, accounts);
  if (!all.length) {
    el.innerHTML = head(syncHtml) + empty(`No HubSpot contacts for ${rangeLabel(from, to)}. ` + (ls && ls.finished_at ? 'Try a wider date range, or refresh to pull the latest contacts.' : 'Nothing has been pulled yet. Click Refresh from HubSpot to run the GSI pull. The Pages site needs the HUBSPOT_ACCESS_TOKEN secret set;'), `<a href="#/settings">check Settings</a>.`);
    wireRefresh();
    return;
  }

  // ---- derived sets --------------------------------------------------------------------------
  const spamCounts = sortedEntries(countBy(all.filter(r => r.spam), r => r.spam));
  const options = {
    region: sortedEntries(countBy(all, r => r.region || 'Other')).map(([k]) => k),
    account: [...sortedEntries(countBy(all.filter(r => r.account), r => r.account)).map(([k]) => k), 'Not a target account'],
    companyType: COMPANY_TYPES.filter(t => all.some(r => r.company_type === t)),
    band: BANDS.filter(b => all.some(r => (r.band || 'Unknown') === b)),
    owner: [...sortedEntries(countBy(all, r => ownerKey(r) || 'Unassigned')).map(([k]) => k)],
    cluster: CLUSTERS.map(c => [c.id, c.label]),
  };

  function draw() {
    const f = S.f;
    const rows = applyFilters(all, f);
    const s = summary(rows);
    const dimKey = S.dim === 'account' ? (r => r.account || 'Not a target account') : S.dim === 'region' ? (r => r.region || 'Other') : (r => r.company_type);
    const dimLabel = S.dim === 'account' ? 'Account' : S.dim === 'region' ? 'Region' : 'Cluster (company type)';
    const groups = new Map(); for (const r of rows) { const k = dimKey(r); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
    const groupRows = [...groups.entries()].map(([k, list]) => {
      const withMsg = list.filter(hasMessage).length; const md = list.filter(r => r.band === 'MD' || r.band === 'MD-1').length;
      const top = sortedEntries(countBy(list.filter(r => r.cluster), r => r.cluster))[0];
      const last = list.reduce((m, r) => r.last_activity_at && (!m || r.last_activity_at > m) ? r.last_activity_at : m, null);
      const owners = sortedEntries(countBy(list, r => ownerKey(r) || null)).map(([k, n]) => `${k} ${n}`).slice(0, 3).join(', ');
      return { key: k, leads: list.length, withMsg, mdShare: md / list.length, top: top ? `${clusterShort(top[0])} (${top[1]})` : '–', last, owners: owners || '–' };
    }).sort((a, b) => b.leads - a.leads || a.key.localeCompare(b.key));
    if (S.value && !groups.has(S.value)) S.value = '';
    if (!S.value && groupRows.length) S.value = groupRows[0].key;

    // clusters
    const withMsgRows = rows.filter(r => r.cluster);
    const clusterCards = CLUSTERS.map(c => { const list = withMsgRows.filter(r => r.cluster === c.id); return { c, list, n: list.length }; }).sort((a, b) => b.n - a.n);
    const maxN = Math.max(1, ...clusterCards.map(x => x.n));
    const gsiLeads = rows.filter(r => r.cluster && (r.account || (r.via || []).includes('company'))).sort((a, b) => (a.account ? 0 : 1) - (b.account ? 0 : 1) || (a.created_at < b.created_at ? 1 : -1));

    el.innerHTML = head(syncHtml) + `
    <div class="card" style="margin-bottom:18px"><div class="row">
      ${selectHtml('region', 'Region', options.region, f.region, esc)}
      ${selectHtml('account', 'Account', options.account, f.account, esc)}
      ${selectHtml('companyType', 'Cluster (company type)', options.companyType, f.companyType, esc)}
      ${selectHtml('band', 'Band', options.band, f.band, esc)}
      ${selectHtml('owner', 'Owner', options.owner, f.owner, esc)}
      ${selectHtml('cluster', 'Intent cluster', options.cluster, f.cluster, esc)}
      ${selectHtml('hasMessage', 'Has message', [['yes', 'Yes'], ['no', 'No']], f.hasMessage, esc)}
      ${selectHtml('hasActivity', 'Has notes / activity', [['yes', 'Yes'], ['no', 'No']], f.hasActivity, esc)}
      <button class="btn tiny ghost" id="fReset" style="align-self:flex-end">Reset filters</button>
      <span class="muted" style="align-self:flex-end;font-size:12.5px">${fmt(rows.length)} of ${fmt(all.length)} contacts${f.excludeSpam && s.spam === 0 && spamCounts.length ? ` (${fmt(spamCounts.reduce((a, x) => a + x[1], 0))} tests / spam excluded)` : ''}</span>
    </div></div>
    <div class="toc"><span class="tl">On this page</span><a href="#m-tiles">Numbers</a><a href="#m-clusters">What leads are asking</a><a href="#m-gsi">Target-account leads</a><a href="#m-dims">By account, region and cluster</a><a href="#m-all">AI read-out</a><a href="#m-quality">Data quality</a></div>

    ${section('Leads in range', '', tiles([
      { k: 'Leads in range', v: fmt(s.leads), d: `${rangeLabel(from, to)}` },
      { k: 'With a message', v: fmt(s.withMessage), d: pct(s.leads ? s.withMessage / s.leads * 100 : null, 0) + ' of leads wrote something' },
      { k: 'With notes or logged activity', v: fmt(s.withActivity), d: pct(s.leads ? s.withActivity / s.leads * 100 : null, 0) + ' touched by the team' },
      { k: 'Target-account leads', v: fmt(s.target), d: 'named accounts from Settings' },
      { k: 'MD-band leads', v: fmt(s.md), d: `MD-1 ${fmt(s.md1)}, MD-2 ${fmt(s.md2)}` },
      { k: 'Unowned leads', v: fmt(s.unowned), d: s.unowned ? 'no HubSpot owner' : 'everything is owned' },
      { k: 'Intent clusters seen', v: fmt(clusterCards.filter(x => x.n).length), d: 'of 10' },
      { k: 'Tests / spam in range', v: fmt(all.filter(r => r.spam).length), d: f.excludeSpam ? 'excluded from the counts' : 'included in the counts' },
    ]), 'm-tiles')}

    ${section('What leads are asking', `Each form message is put into one of ten intent clusters by keyword, the same clusters as the Lead Message Intelligence report. Three sample quotes and the companies behind them are shown; <span class="pill p-high">green</span> tags are named target accounts, <span class="pill" style="background:rgba(4,62,119,.1);color:var(--navy)">navy</span> tags are on the wider GSI/SI list. Click a cluster to filter the whole page.`, `<div class="grid g2">` + clusterCards.map(({ c, list, n }, i) => {
      const samples = list.filter(r => hasMessage(r)).slice(0, 3);
      const cos = sortedEntries(countBy(list, r => r.account || r.company_raw || null)).slice(0, 8);
      const rep = k => list.find(r => (r.account || r.company_raw) === k);
      return `<div class="card" style="${f.cluster === c.id ? 'border-color:var(--orange)' : ''}">
        <div style="display:flex;align-items:baseline;gap:10px"><span class="sn">${String(i + 1).padStart(2, '0')}</span><h3 style="margin:0;flex:1">${esc(c.label)}</h3><b style="font-size:20px">${fmt(n)}</b><span class="muted" style="font-size:12.5px">${pct(withMsgRows.length ? n / withMsgRows.length * 100 : null, 0)}</span></div>
        <div style="height:8px;border-radius:6px;background:var(--soft);margin:8px 0 10px;overflow:hidden"><i style="display:block;height:100%;width:${(n / maxN * 100).toFixed(1)}%;background:var(--orange)"></i></div>
        ${samples.length ? `<ul style="margin:0 0 10px;padding-left:18px;font-size:13.5px">${samples.map(r => `<li>“${esc(truncate(r.lsa_message, 140))}”</li>`).join('')}</ul>` : `<p class="muted" style="font-size:13px;margin-bottom:10px">No messages in this cluster for the current filters.</p>`}
        <div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:10px">${cos.map(([k, cnt]) => { const r = rep(k); return `<span class="tag" style="${tagCls(r)}">${esc(k)}${ctry(r)}${cnt > 1 ? ' ×' + cnt : ''}</span>`; }).join('') || '<span class="muted" style="font-size:12.5px">–</span>'}</div>
        <button class="btn tiny" data-cluster="${c.id}">${f.cluster === c.id ? 'Clear filter' : 'Filter by this cluster'}</button>
      </div>`;
    }).join('') + `</div>`, 'm-clusters')}

    ${section('Target-account leads', 'Leads at named target accounts or on the wider GSI/SI list who wrote a message. These are the people the programme exists to find, so each one is listed by name.', gsiLeads.length ? `<div class="grid g2">${gsiLeads.slice(0, 24).map(r => `<div class="card" style="border-left:4px solid ${r.account ? 'var(--good)' : 'var(--navy)'}">
        <div style="display:flex;gap:8px;align-items:baseline;flex-wrap:wrap"><b>${esc(r.account || r.company_raw)}</b><span class="muted">${esc(r.name)}${r.jobtitle ? ' · ' + esc(r.jobtitle) : ''}${r.country ? ' · ' + esc(r.country) : ''}</span><span style="margin-left:auto">${bandPill(r.band, pill)}</span></div>
        <p style="margin-top:6px">“${esc(r.lsa_message)}”</p>
        <p class="muted" style="font-size:12.5px;margin-top:6px">${esc(clusterShort(r.cluster))} · ${esc(istDateTime(r.created_at))} · ${r.owner_name ? 'owner ' + esc(r.owner_name) : '<span class="down">no owner</span>'} · ${r.notes_count ? fmt(r.notes_count) + ' notes' : 'no notes'}${r.last_activity_at ? ' · last activity ' + esc(timeAgo(r.last_activity_at)) : ''}</p></div>`).join('')}</div>${gsiLeads.length > 24 ? `<p class="muted" style="margin-top:8px">Showing 24 of ${fmt(gsiLeads.length)}. Use the account filter to narrow down.</p>` : ''}` : empty('No target-account leads with a message for the current filters.'), 'm-gsi')}

    ${section('By account, region and cluster', 'Pick a dimension, then a row (or use the select) to read the actual messages and get a Claude read-out for that slice.', `<div id="dimSeg"></div>
      <div class="row" style="margin-bottom:12px"><label class="field"><span class="muted">${esc(dimLabel)}</span><select id="dimValue">${groupRows.map(g => `<option value="${esc(g.key)}" ${g.key === S.value ? 'selected' : ''}>${esc(g.key)} (${g.leads})</option>`).join('')}</select></label></div>
      <div class="grid" style="grid-template-columns:minmax(0,1.1fr) minmax(0,1fr)">
        <div>${table({ cols: [
          { h: dimLabel, k: 'key', left: true, f: r => `<a href="#m-dims" data-row="${esc(r.key)}" style="color:inherit;text-decoration:none;font-weight:${r.key === S.value ? 700 : 500};${r.key === S.value ? 'border-bottom:2px solid var(--orange)' : ''}">${esc(r.key)}</a>` },
          { h: 'Leads', k: 'leads', f: r => fmt(r.leads) }, { h: 'With message', k: 'withMsg', f: r => fmt(r.withMsg) }, { h: 'MD / MD-1 share', k: 'mdShare', f: r => pct(r.mdShare * 100, 0) },
          { h: 'Top cluster', k: 'top', f: r => esc(r.top) }, { h: 'Last activity', k: 'last', f: r => r.last ? esc(timeAgo(r.last)) : '<span class="muted">none</span>' }, { h: 'Owners', k: 'owners', f: r => esc(r.owners) },
        ], rows: groupRows.slice(0, 40), cls: 'dimtbl' })}${groupRows.length > 40 ? `<p class="muted" style="font-size:12.5px;margin-top:6px">Top 40 of ${groupRows.length} shown.</p>` : ''}</div>
        <div id="dimDetail"></div>
      </div>`, 'm-dims')}

    ${section('AI read-out for everything in range', 'Claude reads the messages, bands and activity for the whole filtered set.', `<div id="allInsights"></div>`, 'm-all')}

    ${section('Data quality', 'Tests and spam are found by rule: Lyzr and lyzrteam email domains and dummy accounts, gibberish names or messages, personal email addresses with no company, and vendor pitches. They are excluded by default.', `<div class="card"><div style="display:flex;gap:18px;flex-wrap:wrap;align-items:center">
      ${spamCounts.length ? spamCounts.map(([k, n]) => `<div><b style="font-size:20px">${fmt(n)}</b><div class="muted" style="font-size:12.5px">${esc(k)}</div></div>`).join('') : '<span class="muted">No tests or spam found in range.</span>'}
      <label style="margin-left:auto;display:flex;gap:8px;align-items:center;font-size:13.5px"><input type="checkbox" id="spamToggle" ${f.excludeSpam ? 'checked' : ''}> Exclude tests and spam from every number on this page</label></div>
      ${all.filter(r => r.spam).length ? `<details style="margin-top:12px"><summary class="muted" style="cursor:pointer;font-size:13px">Show the ${fmt(all.filter(r => r.spam).length)} excluded records</summary>${table({ cols: [{ h: 'Name', k: 'name', left: true, f: r => esc(r.name) }, { h: 'Email', k: 'email', left: true, f: r => esc(r.email) }, { h: 'Company', k: 'company_raw', left: true, f: r => esc(r.company_raw || '–') }, { h: 'Message', k: 'lsa_message', left: true, f: r => esc(truncate(r.lsa_message, 80)) }, { h: 'Reason', k: 'spam', f: r => pill(r.spam, 'p-low') }], rows: all.filter(r => r.spam).slice(0, 80) })}</details>` : ''}</div>`, 'm-quality')}`;

    // ---- wiring ------------------------------------------------------------------------------
    el.querySelectorAll('select[data-f]').forEach(sel => sel.onchange = () => { S.f[sel.dataset.f] = sel.value; S.value = ''; draw(); });
    el.querySelector('#fReset').onclick = () => { S.f = { ...S.f, region: '', account: '', companyType: '', band: '', owner: '', cluster: '', hasMessage: '', hasActivity: '' }; S.value = ''; draw(); };
    el.querySelectorAll('button[data-cluster]').forEach(b => b.onclick = () => { S.f.cluster = S.f.cluster === b.dataset.cluster ? '' : b.dataset.cluster; draw(); });
    el.querySelector('#spamToggle').onchange = e => { S.f.excludeSpam = e.target.checked; draw(); };
    seg(el.querySelector('#dimSeg'), [{ value: 'account', label: 'Accounts' }, { value: 'region', label: 'Regions' }, { value: 'cluster', label: 'Clusters' }], v => { S.dim = v; S.value = ''; draw(); }, S.dim);
    el.querySelector('#dimValue').onchange = e => { S.value = e.target.value; drawDetail(); };
    el.querySelectorAll('a[data-row]').forEach(a => a.onclick = ev => { ev.preventDefault(); S.value = a.dataset.row; el.querySelector('#dimValue').value = S.value; el.querySelectorAll('a[data-row]').forEach(x => x.style.fontWeight = x === a ? 700 : 500); drawDetail(); });
    wireRefresh();

    const msgPayload = list => list.filter(hasMessage).slice(0, 150).map(r => ({ account: r.account || r.company_raw || null, title: r.jobtitle || null, band: r.band, region: r.region, cluster: r.cluster, message: r.lsa_message, notes: (r.notes || []).map(n => truncate(n.body, 300)), owner: r.owner_name || null, created_at: r.created_at }));
    const countsOf = list => ({ ...summary(list), clusters: Object.fromEntries(sortedEntries(countBy(list.filter(r => r.cluster), r => r.cluster))) });
    ctx.mountInsights(el.querySelector('#allInsights'), ctx, { scope: `messaging:all:${from}:${to}`, kind: 'messaging', title: 'What all leads in range are asking', inputProvider: () => ({ value: 'all', dim: 'all', counts: countsOf(rows), messages: msgPayload(rows) }) });

    function drawDetail() {
      const box = el.querySelector('#dimDetail');
      const list = (groups.get(S.value) || []).slice().sort((a, b) => (hasMessage(b) ? 1 : 0) - (hasMessage(a) ? 1 : 0) || (a.created_at < b.created_at ? 1 : -1));
      if (!S.value) { box.innerHTML = empty('Pick a row to see its messages.'); return; }
      const msgs = list.filter(hasMessage);
      box.innerHTML = `<div class="card"><h3>${esc(S.value)}</h3><p class="muted" style="font-size:13px;margin-bottom:10px">${fmt(list.length)} leads, ${fmt(msgs.length)} with a message, ${fmt(list.filter(hasActivity).length)} with notes or activity.</p>
        <div style="max-height:520px;overflow:auto;display:flex;flex-direction:column;gap:10px">${msgs.slice(0, 60).map(r => `<div style="border-top:1px solid var(--line);padding-top:8px">
          <p>“${esc(r.lsa_message)}”</p>
          <p class="muted" style="font-size:12.5px;margin-top:4px">${esc(r.name)}${r.jobtitle ? ' · ' + esc(r.jobtitle) : ''} · ${bandPill(r.band, pill)} · ${esc(r.account || r.company_raw || '–')}${S.dim !== 'region' && r.region ? ' · ' + esc(r.region) : ''} · ${r.owner_name ? esc(r.owner_name) : '<span class="down">no owner</span>'} · ${esc(istDateTime(r.created_at))} · ${r.notes_count ? fmt(r.notes_count) + ' notes' : 'no notes'}</p>
          ${(r.notes || []).length ? `<details style="font-size:12.5px;margin-top:4px"><summary class="muted" style="cursor:pointer">Notes</summary><ul style="margin:4px 0 0;padding-left:16px">${r.notes.map(n => `<li><span class="tag">${esc(n.kind)}</span> ${esc(truncate(n.body, 300))} <span class="muted">${esc(istDateTime(n.created_at))}</span></li>`).join('')}</ul></details>` : ''}
        </div>`).join('') || '<p class="muted">No messages here; these leads came in without a form message.</p>'}${msgs.length > 60 ? `<p class="muted" style="font-size:12.5px">60 of ${msgs.length} shown.</p>` : ''}</div>
        <div id="dimInsights" style="margin-top:14px"></div></div>`;
      ctx.mountInsights(box.querySelector('#dimInsights'), ctx, { scope: `messaging:${S.dim}:${S.value}:${from}:${to}`, kind: 'messaging', title: `What ${S.value} leads are asking`, inputProvider: () => ({ value: S.value, dim: S.dim, counts: countsOf(list), messages: msgPayload(list) }) });
    }
    drawDetail();
  }

  function wireRefresh() {
    const btn = el.querySelector('#hsRefresh'); if (!btn) return;
    btn.onclick = async () => {
      const prog = el.querySelector('#hsProg'); btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Refreshing';
      const warnings = []; let cursor = null, step = 0;
      try {
        for (;;) {
          const r = await ctx.api.post('hubspot/refresh', cursor ? { cursor } : {});
          step++; warnings.push(...(r.warnings || []));
          prog.innerHTML = `Step ${step}: ${fmt(r.contacts)} contacts and ${fmt(r.notes)} notes so far${warnings.length ? ` · ${warnings.length} warning${warnings.length > 1 ? 's' : ''}: ${esc(warnings.slice(-2).join('; '))}` : ''}`;
          if (r.done || !r.cursor || step > 500) break;
          cursor = r.cursor;
        }
        ctx.toast(`HubSpot refreshed in ${step} step${step > 1 ? 's' : ''}${warnings.length ? ` with ${warnings.length} warning${warnings.length > 1 ? 's' : ''}` : ''}`);
        if (root === el) await render(el, ctx);
      } catch (e) {
        prog.innerHTML = `<span class="err">Refresh failed: ${esc(e.message || e)}${e.status === 503 ? ' (HUBSPOT_ACCESS_TOKEN is probably not set on the Pages site)' : ''}</span>`;
        btn.disabled = false; btn.textContent = 'Refresh from HubSpot';
      }
    };
  }
  draw();
}
