// Email channel (Instantly). Two sources that line up by campaign name:
//  - CSV event exports uploaded in Settings (who did what: sends, opens, clicks, links, steps)
//  - the daily Instantly API pull of every GSI-tagged campaign (totals, replies, bounces, opportunities)
// Structure follows the "Lead Interaction Intelligence" report: results, funnel, demo-intent
// leaderboard, copy lists, per-campaign drill-down (companies, links, steps, engagement by type,
// Book a Demo / other clicks / opened only), and per-person timelines. On top: week-on-week and
// month-on-month trends, Book a Demo by account and week, accounts, link types, mailboxes, AI read-out.
import * as E from '../lib/email-agg.mjs';
import { campaignLabel } from '../email-csv.mjs';
import { mountTrend } from '../trend.mjs';

export const route = 'email';
export const title = 'Email';

const S = { campaign: '', company: '', seg: 'demo', q: '', limit: 150, heat: 'demo', heatGran: 'week', open: null, peopleCat: '' };
const CACHE = { pages: null, at: 0, hs: null };
let charts = [], trend = null, ACTIVE = null;
export function destroy() { ACTIVE = null; for (const c of charts) { try { c.destroy(); } catch { /* ignore */ } } charts = []; if (trend) { trend.destroy(); trend = null; } closeDrawer(); }
const chart = (canvas, cfg) => { if (typeof Chart === 'undefined' || !canvas) return null; const c = new Chart(canvas, cfg); charts.push(c); return c; };
const C = { orange: '#FE4B1E', navy: '#4F86C6', forest: '#063B28', oxblood: '#593D3D', stone: '#A8A298', sky: '#7A9CC6' };

async function loadAll(ctx, force) {
  if (CACHE.pages && !force && Date.now() - CACHE.at < 10 * 60e3) return CACHE.pages;
  const pages = [];
  let offset = 0;
  for (let guard = 0; guard < 200; guard++) {
    const p = await ctx.api.get('email', { offset });
    pages.push(p);
    if (p.next == null) break;
    offset = p.next;
  }
  CACHE.pages = pages; CACHE.at = Date.now();
  return pages;
}
async function loadHubspot(ctx) {
  if (CACHE.hs) return CACHE.hs;
  try { const d = await ctx.api.get('hubspot', {}); CACHE.hs = new Map((d.contacts || []).filter(c => c.email).map(c => [String(c.email).toLowerCase(), c])); }
  catch { CACHE.hs = new Map(); }
  return CACHE.hs;
}

export async function copyText(ctx, text, what) {
  try { await navigator.clipboard.writeText(text); }
  catch { const t = document.createElement('textarea'); t.value = text; t.style.position = 'fixed'; t.style.opacity = '0'; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); } catch { /* ignore */ } t.remove(); }
  ctx.toast(`Copied ${what}`);
}

export async function render(el, ctx) {
  destroy();
  const F = ctx.fmt, { esc, fmt, pct } = F;
  const { from, to } = ctx.state;
  const head = sub => `<div class="seghead">Channel · Email</div><h1>Email campaigns</h1><p class="sub">${sub}</p>`;
  el.innerHTML = head(esc(F.rangeLabel(from, to))) + ctx.ui.spinner('Loading Instantly data');
  let pages;
  try { pages = await loadAll(ctx); } catch (e) { el.innerHTML = head('') + ctx.ui.empty('Email data could not be loaded: ' + (e.message || e)); return; }
  const first = pages[0] || {};
  const api = first.api || { campaigns: [], daily: [] };
  const uploads = first.uploads || [];
  const rules = { ...E.DEFAULT_RULES, ...((ctx.settings && ctx.settings.email_rules) || {}) };
  const accountsList = (ctx.settings && ctx.settings.accounts) || [];
  const all = E.enrich(E.expand(pages), rules, accountsList);
  const hs = await loadHubspot(ctx);
  const isEditor = !!ctx.demo || !!(ctx.settings && ctx.settings.editors && ctx.user && ctx.settings.editors.includes(String(ctx.user.email || '').toLowerCase()));

  const apiName = new Map((api.campaigns || []).map(c => [c.id, c.name]));
  const apiDaily = (api.daily || []).map(r => ({ ...r, _api: true, campaign: apiName.get(r.campaign_id) || r.campaign_id }));
  const campaignNames = [...new Set([...all.map(e => e.campaign), ...(api.campaigns || []).map(c => c.name)])].sort((a, b) => campaignLabel(a).localeCompare(campaignLabel(b)));
  const companies = [...new Set(all.map(e => e.company))].sort();
  if (S.campaign && !campaignNames.includes(S.campaign)) S.campaign = '';

  if (!all.length && !(api.campaigns || []).length) {
    el.innerHTML = head(esc(F.rangeLabel(from, to))) + ctx.ui.empty('No email data yet. Upload Instantly campaign exports (any number at once) or run the Instantly sync.', '<a href="#/settings">Go to Settings and uploads</a>') + (isEditor && api.configured ? `<p style="text-align:center;margin-top:12px"><button class="btn" id="syncBtn">Pull GSI campaigns from Instantly now</button></p>` : '');
    wireSync(el, ctx, () => render(el, ctx));
    return;
  }

  // ---- filters -------------------------------------------------------------------------------
  const pick = e => (!S.campaign || e.campaign === S.campaign) && (!S.company || e.company === S.company);
  const scoped = all.filter(pick);
  const days = F.daysBetween(from, to);
  const prevTo = F.addDays(from, -1), prevFrom = F.addDays(from, -days);
  const cur = scoped.filter(e => E.inRange(e, from, to));
  const prev = scoped.filter(e => E.inRange(e, prevFrom, prevTo));
  const T = E.funnel(cur), TP = E.funnel(prev);
  const apiScoped = apiDaily.filter(r => !S.campaign || r.campaign === S.campaign);
  const apiSum = (rows, k) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);
  const apiCur = apiScoped.filter(r => r.day >= from && r.day <= to), apiPrev = apiScoped.filter(r => r.day >= prevFrom && r.day <= prevTo);
  const P = E.people(cur);
  const CAMPS = E.campaigns(cur);
  const ACC = E.accounts(cur);
  const SEND = E.senders(cur);
  const CAT = E.catStats(cur);
  const byEmail = new Map(P.map(p => [p.email, p]));
  const dl = (a, b, invert) => { if (!b || a == null) return '<span class="muted">no prior</span>'; const g = (a - b) / b * 100; const good = invert ? g <= 0 : g >= 0; return `<span class="${good ? 'up' : 'down'}">${g > 0 ? '+' : ''}${fmt(g, 0)}%</span> vs prior ${days}d`; };
  const emailBtn = (email, extra = '') => `<button type="button" class="em" data-person="${esc(email)}" title="Open this person">${esc(email)}</button><button type="button" class="cp" data-copy="${esc(email)}" title="Copy email">copy</button>${extra}`;
  const lastUpload = uploads.reduce((m, u) => !m || u.uploaded_at > m ? u.uploaded_at : m, null);
  const eventDays = all.map(e => e.day).sort();
  const sync = api.last_sync;

  // ---- page ----------------------------------------------------------------------------------
  let h = head(`${esc(F.rangeLabel(from, to))}${S.campaign ? ` · ${esc(campaignLabel(S.campaign))}` : ''}${S.company ? ` · ${esc(S.company)}` : ''}. People are unique contacts. Human clicks leave out clicks within ${fmt(rules.fast_click_seconds)} seconds of the send (likely link scanners). Book a Demo counts the direct calendar${rules.gsi_page_counts_as_demo ? ' and the GSI/SI page (split out as "via GSI/SI page")' : ''}. Compared with the ${days} days before.`);
  h += `<div class="card" style="font-size:13px;margin-bottom:6px;display:flex;gap:14px;flex-wrap:wrap;align-items:center">
    <span><b>CSV exports:</b> ${fmt(uploads.length)} upload${uploads.length === 1 ? '' : 's'}, ${fmt(new Set(all.map(e => e.campaign)).size)} campaigns, events ${eventDays.length ? `${esc(F.dayLabel(eventDays[0]))} to ${esc(F.dayLabel(eventDays[eventDays.length - 1]))}` : 'none'}${lastUpload ? `, last upload ${esc(F.timeAgo(lastUpload))}` : ''}.</span>
    <span><b>Instantly API:</b> ${api.configured === false ? 'not configured' : `${fmt((api.campaigns || []).length)} GSI-tagged campaigns${sync ? `, synced ${esc(F.timeAgo(sync.finished_at || sync.started_at))}${sync.status === 'error' ? ' <span class="down">(last run failed)</span>' : ''}` : ', never synced'}`}.</span>
    <span style="margin-left:auto;display:flex;gap:6px">${isEditor && api.configured !== false ? '<button class="btn tiny" id="syncBtn">Sync Instantly now</button>' : ''}<button class="btn tiny ghost" id="reloadBtn">Reload</button></span></div>
  <div class="row" style="margin:10px 0 4px;align-items:center">
    <label class="field" style="flex-direction:row;align-items:center;gap:6px">Campaign <select id="fCamp"><option value="">All campaigns (${campaignNames.length})</option>${campaignNames.map(c => `<option value="${esc(c)}" ${S.campaign === c ? 'selected' : ''}>${esc(campaignLabel(c))}</option>`).join('')}</select></label>
    <label class="field" style="flex-direction:row;align-items:center;gap:6px">Account <select id="fComp"><option value="">All accounts (${companies.length})</option>${companies.map(c => `<option value="${esc(c)}" ${S.company === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
  </div>
  <div class="toc"><span class="tl">On this page</span><a href="#e-results">Results</a><a href="#e-trend">Week / month</a><a href="#e-demo">Book a Demo</a><a href="#e-camps">Campaigns</a><a href="#e-acc">Accounts</a><a href="#e-links">Link types</a><a href="#e-mail">Mailboxes</a><a href="#e-people">People and lists</a><a href="#e-ai">AI read-out</a></div>`;

  // 1. results
  const apiReplies = apiSum(apiCur, 'unique_replies'), apiRepliesP = apiSum(apiPrev, 'unique_replies');
  const apiSent = apiSum(apiCur, 'sent');
  const funnelRows = [['Emails sent', T.sent, 'every step'], ['Contacts reached', T.reached, 'unique people sent to'], ['Opened', T.opened, 'weak signal: pixel blocked or pre-loaded'], ['Clicked (human)', T.clickers, 'at least one human click'], ['Book a Demo', T.demo, `${fmt(T.demoDirect)} direct calendar · ${fmt(T.demoVia)} via GSI/SI page`]];
  const fmax = Math.max(1, ...funnelRows.map(r => r[1]));
  h += ctx.ui.section('Results', 'Headline numbers for the range from the uploaded exports, with the Instantly API figures that the exports do not carry (replies).', `${ctx.ui.tiles([
    { k: 'Emails sent', v: fmt(T.sent), d: dl(T.sent, TP.sent) + (apiSent ? ` · API ${fmt(apiSent)}` : '') },
    { k: 'Contacts reached', v: fmt(T.reached), d: dl(T.reached, TP.reached) },
    { k: 'Opened (weak)', v: fmt(T.opened), d: `${pct(T.openRate, 0)} of reached` },
    { k: 'Human clickers', v: fmt(T.clickers), d: `${pct(T.clickRate, 1)} of reached · ${dl(T.clickers, TP.clickers)}` },
    { k: 'Book a Demo people', v: fmt(T.demo), d: `${fmt(T.demoDirect)} direct · ${fmt(T.demoVia)} via GSI/SI · ${dl(T.demo, TP.demo)}` },
    { k: 'Fast clicks flagged', v: fmt(T.fastClicks), d: `under ${fmt(rules.fast_click_seconds)}s from send, excluded` },
    { k: 'Replies (Instantly API)', v: apiCur.length ? fmt(apiReplies) : '–', d: apiCur.length ? dl(apiReplies, apiRepliesP) : 'run the Instantly sync' },
    { k: 'Accounts engaged', v: fmt(ACC.filter(a => a.clickers).length), d: `of ${fmt(ACC.filter(a => a.reached).length)} reached` },
  ])}
  <div class="card" style="margin-top:14px"><h3>Combined funnel</h3>${funnelRows.map(([l, n, s], i) => `<div style="display:grid;grid-template-columns:170px 1fr 90px;gap:10px;align-items:center;margin-top:8px"><div><b>${esc(l)}</b><div class="muted" style="font-size:11.5px">${esc(s)}</div></div><div style="background:var(--soft);border-radius:6px;height:22px;overflow:hidden"><i style="display:block;height:100%;width:${Math.max(n ? 1.5 : 0, n / fmax * 100)}%;background:${[C.stone, C.sky, C.navy, C.orange, C.forest][i]}"></i></div><div style="text-align:right;font-variant-numeric:tabular-nums"><b>${fmt(n)}</b>${i ? `<div class="muted" style="font-size:11.5px">${i === 1 ? '' : pct(funnelRows[1][1] ? n / funnelRows[1][1] * 100 : null, 1) + ' of reached'}</div>` : ''}</div></div>`).join('')}</div>`, 'e-results');

  // 2. trend
  h += ctx.ui.section('Week on week and month on month', 'The whole history, not only the selected range (the range is the darker bars). Switch metrics on and off, compare each week or month with the one before or with the average of all earlier ones, and see the week or month in progress against the same days of earlier ones, with a straight-line projection.', '<div id="trendBox"></div>', 'e-trend');

  // 3. Book a Demo
  const leaders = P.filter(p => p.demo).sort((a, b) => b.demo - a.demo || (b.lastClick || '').localeCompare(a.lastClick || ''));
  h += ctx.ui.section('Book a Demo', 'Everyone who clicked a Book a Demo link, overall, by account and by week or month. These are link clicks, not confirmed bookings: check the demo calendar for bookings. Highest intent: chase first.', `<div class="grid g2w">
    <div class="card"><div style="display:flex;align-items:baseline;gap:8px"><h3 style="margin:0">Demo-intent leaderboard</h3><span class="tag">${fmt(leaders.length)} people</span>
      ${leaders.length ? `<button class="btn tiny ghost" style="margin-left:auto" data-copylist="demo-emails">Copy emails</button><button class="btn tiny ghost" data-copylist="demo-table">Copy table</button>` : ''}</div>
      <div style="max-height:460px;overflow:auto;margin-top:6px">${leaders.length ? leaders.map((p, i) => `<div class="pcard" style="grid-template-columns:28px 1fr auto"><span class="muted">${i + 1}</span><div>${emailBtn(p.email)}<div class="muted" style="font-size:12px">${esc(p.company)} · ${p.campaignList.map(c => esc(campaignLabel(c))).join(' · ')}${hsBadge(hs.get(p.email), esc)}</div></div><div style="text-align:right"><b>${fmt(p.demo)}</b> <span class="muted" style="font-size:12px">click${p.demo === 1 ? '' : 's'}</span><div class="muted" style="font-size:11.5px">${p.demoDirect ? fmt(p.demoDirect) + ' direct' : ''}${p.demoDirect && p.demoVia ? ' · ' : ''}${p.demoVia ? fmt(p.demoVia) + ' via GSI/SI' : ''} · ${esc(F.timeAgo(p.demoDates.sort().slice(-1)[0]))}</div></div></div>`).join('') : '<p class="muted">No Book a Demo clicks in this range.</p>'}</div></div>
    <div class="card"><h3>Accounts by ${S.heatGran}</h3><p class="muted" style="font-size:12.5px;margin-bottom:6px">Unique people per account per ${S.heatGran}. Click a cell for the people behind it.</p><div id="heatSeg" style="display:flex;gap:10px;flex-wrap:wrap"></div><div id="demoHeat" style="overflow-x:auto"></div>${ctx.heat.legend('navy', 'square-root scale')}</div>
  </div><div id="heatPick" style="margin-top:12px"></div>`, 'e-demo');

  // 4. campaigns
  const apiById = new Map((api.campaigns || []).map(c => [c.name, c]));
  const campRows = campaignNames.map(name => {
    const csv = CAMPS.find(c => c.name === name);
    const a = apiById.get(name);
    const d = apiDaily.filter(r => r.campaign === name && r.day >= from && r.day <= to);
    return { name, csv, api: a, rangeSent: apiSum(d, 'sent'), rangeReplies: apiSum(d, 'unique_replies'), rangeClicks: apiSum(d, 'unique_clicks'), rangeOpens: apiSum(d, 'unique_opened') };
  }).filter(r => !S.campaign || r.name === S.campaign).filter(r => r.csv || r.rangeSent || (r.api && r.api.status === 1));
  const rt = (n, d) => d ? pct(n / d * 100, 1) : '–';
  h += ctx.ui.section('Campaigns', 'Every GSI campaign: the Instantly API numbers (all time and in range) next to what the uploaded exports show (human clickers, Book a Demo, fast clicks). Click a campaign for its drill-down: companies, links, steps, engagement by type and the people.', `<div class="tblwrap"><table><thead><tr>
    <th class="l">Campaign</th><th>Status</th><th>Sent in range</th><th>Reached</th><th>Open rate</th><th>Human clickers</th><th>Book a Demo</th><th>Fast clicks</th><th>Replies in range</th><th>All time: sent</th><th>All time: reply rate</th><th>All time: bounce rate</th><th>Opportunities</th></tr></thead><tbody>
    ${campRows.map(r => { const c = r.csv, a = r.api; return `<tr class="${S.open === r.name ? 'sel' : ''}"><td class="l"><button type="button" class="em" style="font-family:var(--font);font-size:13.5px" data-camp="${esc(r.name)}">${esc(campaignLabel(r.name))}</button>${c ? '' : '<br><span class="muted" style="font-size:11.5px">no export uploaded</span>'}</td>
      <td>${a ? statusPill(a.status, ctx) : '<span class="muted">–</span>'}</td><td>${fmt(c ? c.sent : r.rangeSent)}</td><td>${c ? fmt(c.reached) : '–'}</td><td>${c ? pct(c.openRate, 0) : rt(r.rangeOpens, r.rangeSent)}</td>
      <td>${c ? fmt(c.clickers) : (r.rangeClicks ? fmt(r.rangeClicks) + '<span class="muted">*</span>' : '–')}</td><td>${c ? `<b>${fmt(c.demo)}</b>${c.demo ? `<br><span class="muted" style="font-size:11px">${fmt(c.demoDirect)} direct · ${fmt(c.demoVia)} via</span>` : ''}` : '–'}</td><td>${c ? fmt(c.fastClicks) : '–'}</td>
      <td>${fmt(r.rangeReplies)}</td><td>${a ? fmt(a.sent) : '–'}</td><td>${a ? rt(a.replied_unique, a.contacted) : '–'}</td><td>${a ? `<span class="${a.contacted && a.bounced / a.contacted > .03 ? 'down' : ''}">${rt(a.bounced, a.contacted)}</span>` : '–'}</td><td>${a ? fmt(a.opportunities) : '–'}</td></tr>`; }).join('') || '<tr><td colspan="13" class="muted">No campaign has activity in this range.</td></tr>'}
    </tbody></table></div><p class="muted" style="font-size:12px;margin-top:6px">* Instantly API unique clicks, which include scanner clicks. Rates marked all time are from the Instantly totals (reply and bounce rate over contacts).</p><div id="campDrill" style="margin-top:14px"></div>`, 'e-camps');

  // 5. accounts
  h += ctx.ui.section('Accounts', 'Every company reached in the range: how far each got down the funnel, and when someone last clicked. Accounts are read from the email domain (edit the mapping in Settings › Email rules).', `<div class="tblwrap" style="max-height:520px;overflow:auto"><table><thead><tr><th class="l">Account</th><th>Reached</th><th>Opened</th><th>Human clickers</th><th>Click rate</th><th>Book a Demo</th><th>Direct</th><th>Via GSI/SI</th><th>Campaigns</th><th class="l">Link types clicked</th><th>Last human click</th></tr></thead><tbody>
    ${ACC.filter(a => a.reached || a.clickers).map(a => `<tr><td class="l"><button type="button" class="em" style="font-family:var(--font);font-size:13.5px" data-acc="${esc(a.company)}">${esc(a.company)}</button></td><td>${fmt(a.reached)}</td><td>${fmt(a.opened)}</td><td>${fmt(a.clickers)}</td><td>${pct(a.clickRate, 1)}</td><td><b>${fmt(a.demo)}</b></td><td>${fmt(a.demoDirect)}</td><td>${fmt(a.demoVia)}</td><td>${fmt(a.campaigns)}</td><td class="l" style="font-size:12.5px">${Object.keys(a.cats).map(esc).join(', ') || '<span class="muted">–</span>'}</td><td>${a.lastClick ? esc(F.timeAgo(a.lastClick)) : '<span class="muted">–</span>'}</td></tr>`).join('')}
    </tbody></table></div>`, 'e-acc');

  // 6. link types
  h += ctx.ui.section('Engagement by link type', 'Unique people per link type in the range. Someone who clicked two types is in both rows. "No Book a Demo" = clicked this type but never clicked Book a Demo: the warm list for that topic.', `<div class="tblwrap"><table><thead><tr><th class="l">Type</th><th>People</th><th>Also clicked Book a Demo</th><th>No Book a Demo</th><th>Clicks</th><th class="l">Copy</th></tr></thead><tbody>
    ${E.CATEGORY_ORDER.filter(c => CAT[c]).map(c => { const r = CAT[c]; return `<tr><td class="l">${esc(c)}</td><td>${fmt(r.people)}</td><td>${c === 'Book a Demo' ? 'n/a' : fmt(r.demoPeople)}</td><td>${c === 'Book a Demo' ? 'n/a' : fmt(r.otherPeople)}</td><td>${fmt(r.clicks)}</td><td class="l"><button class="btn tiny ghost" data-copycat="${esc(c)}">All ${fmt(r.people)}</button>${c !== 'Book a Demo' && r.otherPeople ? ` <button class="btn tiny ghost" data-copycat="${esc(c)}" data-nodemo="1">No demo ${fmt(r.otherPeople)}</button>` : ''}</td></tr>`; }).join('') || '<tr><td colspan="6" class="muted">No human clicks in range.</td></tr>'}
    </tbody></table></div><div class="card" style="margin-top:14px"><h3>Most clicked links</h3><div class="chartbox"><canvas id="linkChart"></canvas></div></div>`, 'e-links');

  // 7. mailboxes
  h += ctx.ui.section('Sending mailboxes', 'Opens and clicks of the people each mailbox sent to. A mailbox with clicks but no opens has open tracking off or blocked; one with far lower rates than the rest may be landing in spam.', ctx.ui.table({ cols: [
    { h: 'Mailbox', k: 'sender', left: true, f: r => `<span class="mono">${esc(r.sender)}</span>` }, { h: 'Emails sent', k: 'sent', f: r => fmt(r.sent) }, { h: 'Reached', k: 'reached', f: r => fmt(r.reached) },
    { h: 'Open rate', k: 'openRate', f: r => pct(r.openRate, 0) }, { h: 'Click rate', k: 'clickRate', f: r => pct(r.clickRate, 1) }, { h: 'Bounces', k: 'bounced', f: r => fmt(r.bounced) }, { h: 'Campaigns', k: 'campaigns', f: r => fmt(r.campaigns) },
    { h: 'Check', k: 'x', left: true, f: r => r.clickers && !r.opened ? '<span class="down">Clicks but no opens: tracking off for this mailbox</span>' : r.reached > 50 && !r.opened && !r.clickers ? '<span class="down">No opens or clicks</span>' : '<span class="muted">ok</span>' },
  ], rows: SEND }), 'e-mail');

  // 8. people and lists
  const groups = [
    ['demo', 'Book a Demo', 'clicked a Book a Demo link (direct or via GSI/SI page)', P.filter(p => p.segment === 'demo')],
    ['engaged', 'Other clicks, no Book a Demo', 'clicked other links only', P.filter(p => p.segment === 'engaged')],
    ['clickers', 'All clickers', 'Book a Demo + other clicks', P.filter(p => p.segment === 'demo' || p.segment === 'engaged')],
    ['opened', 'Opened, no click', 'opens only: retarget candidates', P.filter(p => p.segment === 'opened')],
    ['everyone', 'Everyone engaged', 'opened or clicked', P.filter(p => p.segment !== 'sent')],
    ['sent', 'Sent, no engagement', 'no open, no click in range', P.filter(p => p.segment === 'sent')],
  ];
  const GL = new Map(groups.map(g => [g[0], g[3]]));
  h += ctx.ui.section('People and lists', 'De-duplicated across every campaign in the filter. Each person sits in their highest segment only (Book a Demo, then other clicks, then opened). "Copy emails" gives one per line for a new sequence; "Copy table" pastes straight into Sheets or Excel. Click any email to see that person.', `
    <div class="copygrid">${groups.map(([k, t, d, list]) => `<div class="cg"><div class="t">${esc(t)}<span>${fmt(list.length)}</span></div><div class="d">${esc(d)}</div><div class="row"><button class="btn tiny" data-copylist="${k}-emails" ${list.length ? '' : 'disabled'}>Copy emails</button><button class="btn tiny ghost" data-copylist="${k}-table" ${list.length ? '' : 'disabled'}>Copy table</button></div></div>`).join('')}</div>
    <div class="row" style="margin:16px 0 8px;align-items:center"><div id="segTabs"></div><input type="search" id="pq" placeholder="Search email or company" value="${esc(S.q)}" style="min-width:240px"><span class="muted" id="pcount" style="font-size:12.5px"></span></div>
    <div id="plist"></div>`, 'e-people');
  h += ctx.ui.section('AI read-out', 'Claude reads the campaign, account, week and link numbers on this page, and the actions already tracked for email.', '<div id="aiPanel"></div>', 'e-ai');
  el.innerHTML = h;

  // ---- wiring --------------------------------------------------------------------------------
  el.querySelector('#fCamp').onchange = e => { S.campaign = e.target.value; S.open = S.campaign || null; render(el, ctx); };
  el.querySelector('#fComp').onchange = e => { S.company = e.target.value; render(el, ctx); };
  el.querySelector('#reloadBtn').onclick = async () => { CACHE.pages = null; CACHE.hs = null; render(el, ctx); };
  wireSync(el, ctx, () => { CACHE.pages = null; render(el, ctx); });
  wirePeople(el);

  // trend
  trend = mountTrend(el.querySelector('#trendBox'), ctx, { id: 'email', items: [...scoped, ...apiScoped], metrics: E.TREND_METRICS.filter(m => !m.api || apiScoped.length), defaults: { gran: 'week', metrics: ['clickers', 'demo', 'clickRate'], compare: 'avg' }, range: { from, to },
    note: 'Unique people are counted per week or month, so a person active in two weeks counts in both. API metrics come from the daily Instantly sync and include every GSI-tagged campaign.' });

  // heat map: account x week/month
  const drawHeat = () => {
    const gran = S.heatGran;
    const pred = S.heat === 'demo' ? e => e.event === 'clicked' && e.human && e.demo : S.heat === 'clickers' ? e => e.event === 'clicked' && e.human : S.heat === 'opened' ? e => e.event === 'opened' : e => e.event === 'sent';
    const key = d => F.bucketKey(d, gran);
    const X = E.peopleCross(cur, pred, e => e.company, e => key(e.day));
    const colKeys = [...new Set(cur.map(e => key(e.day)))].sort();
    const rows = [...X.keys()].map(k => ({ key: k, label: k })).sort((a, b) => [...X.get(b.key).values()].reduce((s, v) => s + v, 0) - [...X.get(a.key).values()].reduce((s, v) => s + v, 0)).slice(0, 30);
    const box = el.querySelector('#demoHeat');
    if (!rows.length) { box.innerHTML = '<p class="muted">Nothing in this range.</p>'; return; }
    ctx.heat.renderHeat(box, { corner: 'Account', rows, cols: colKeys.map(k => ({ key: k, label: F.bucketLabel(k, gran) })), sortRows: false, color: 'navy', cell: (r, c) => ({ v: (X.get(r) && X.get(r).get(c)) || 0 }), rowTotal: r => fmt(new Set(cur.filter(e => e.company === r && pred(e)).map(e => e.contact)).size), onClick: (r, c) => {
      const list = [...new Set(cur.filter(e => e.company === r && key(e.day) === c && pred(e)).map(e => e.contact))];
      el.querySelector('#heatPick').innerHTML = `<div class="card"><div style="display:flex;gap:10px;align-items:baseline"><h3 style="margin:0">${esc(r)} · ${esc(F.bucketLabel(c, gran))}: ${fmt(list.length)}</h3><button class="btn tiny ghost" data-copyraw="${esc(list.join('\n'))}">Copy emails</button><button class="btn tiny ghost" style="margin-left:auto" id="pickClose">Close</button></div>${list.map(x => `<div class="pcard" style="grid-template-columns:1fr auto">${emailBtn(x)}<span class="muted" style="font-size:12px">${esc(E.SEGMENT_LABEL[(byEmail.get(x) || {}).segment] || '')}</span></div>`).join('')}</div>`;
      el.querySelector('#pickClose').onclick = () => { el.querySelector('#heatPick').innerHTML = ''; };
    } });
  };
  const hs2 = el.querySelector('#heatSeg'); hs2.innerHTML = '<div id="hm"></div><div id="hg"></div>';
  ctx.ui.seg(hs2.querySelector('#hm'), [{ value: 'demo', label: 'Book a Demo' }, { value: 'clickers', label: 'Human clickers' }, { value: 'opened', label: 'Opened' }, { value: 'reached', label: 'Reached' }], v => { S.heat = v; drawHeat(); }, S.heat);
  ctx.ui.seg(hs2.querySelector('#hg'), [{ value: 'week', label: 'Weeks' }, { value: 'month', label: 'Months' }], v => { S.heatGran = v; render(el, ctx); }, S.heatGran);
  drawHeat();

  // link chart
  const linkPop = new Map(); for (const e of cur) if (e.event === 'clicked' && e.human) linkPop.set(e.label, (linkPop.get(e.label) || 0) + 1);
  const topLinks = [...linkPop.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  chart(el.querySelector('#linkChart'), { type: 'bar', data: { labels: topLinks.map(([l]) => l.length > 42 ? l.slice(0, 41) + '…' : l), datasets: [{ label: 'Human clicks', data: topLinks.map(([, n]) => n), backgroundColor: topLinks.map(([l]) => /Book a Demo/.test(l) ? C.navy : C.orange), borderRadius: 4 }] }, options: { indexAxis: 'y', maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, ticks: { precision: 0 } }, y: { grid: { display: false }, ticks: { font: { size: 11 } } } } } });

  // copy lists
  const listFor = key => { const [g, kind] = key.split('-'); return { list: GL.get(g) || [], kind }; };
  el.querySelectorAll('[data-copylist]').forEach(b => b.onclick = () => { const { list, kind } = listFor(b.dataset.copylist); copyText(ctx, kind === 'table' ? E.peopleTsv(list) : list.map(p => p.email).join('\n'), kind === 'table' ? `${list.length} rows` : `${list.length} emails`); });
  el.querySelectorAll('[data-copycat]').forEach(b => b.onclick = () => { const c = CAT[b.dataset.copycat]; let list = c.contacts; if (b.dataset.nodemo) list = list.filter(x => !(byEmail.get(x) || {}).demo); copyText(ctx, list.join('\n'), `${list.length} emails`); });

  // campaign drill-down
  el.querySelectorAll('[data-camp]').forEach(b => b.onclick = () => { S.open = S.open === b.dataset.camp ? null : b.dataset.camp; drawCampaign(); });
  el.querySelectorAll('[data-acc]').forEach(b => b.onclick = () => { S.company = b.dataset.acc; render(el, ctx); });
  const drawCampaign = () => {
    const box = el.querySelector('#campDrill');
    if (!S.open) { box.innerHTML = ''; return; }
    const c = CAMPS.find(x => x.name === S.open);
    const a = apiById.get(S.open);
    if (!c) { box.innerHTML = `<div class="card"><h3>${esc(campaignLabel(S.open))}</h3><p class="muted">No export uploaded for this campaign in the range, so there is no person-level detail. ${a ? `Instantly totals: ${fmt(a.sent)} sent to ${fmt(a.contacted)} contacts, ${fmt(a.opened_unique)} opened, ${fmt(a.clicked_unique)} clicked, ${fmt(a.replied_unique)} replied, ${fmt(a.bounced)} bounced.` : ''} Upload its CSV in Settings for the drill-down.</p></div>`; return; }
    const cp = E.people(c.events);
    const segs = { demo: cp.filter(p => p.segment === 'demo'), engaged: cp.filter(p => p.segment === 'engaged'), opened: cp.filter(p => p.segment === 'opened') };
    const steps = [...new Set([...c.stepSent.keys(), ...c.stepClicks.keys()])].sort((x, y) => x - y);
    box.innerHTML = `<div class="card" style="background:var(--soft)"><div style="display:flex;gap:10px;align-items:baseline;flex-wrap:wrap"><h3 style="margin:0">${esc(campaignLabel(c.name))}</h3><span class="muted" style="font-size:12.5px">${esc(F.dayLabel(c.first))} to ${esc(F.dayLabel(c.last))} · ${c.senders.length} mailbox${c.senders.length === 1 ? '' : 'es'}</span>
        <span style="margin-left:auto;display:flex;gap:6px"><button class="btn tiny" data-cc="all">Copy all ${fmt(cp.length)} emails</button><button class="btn tiny ghost" data-cc="table">Copy full table</button><button class="btn tiny ghost" data-cc="clickers">Copy clickers (${fmt(segs.demo.length + segs.engaged.length)})</button><button class="btn tiny ghost" data-cc="close">Close</button></span></div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin:10px 0">${[...c.companies.entries()].sort((x, y) => y[1] - x[1]).map(([k, v]) => `<span class="tag">${esc(k)} ${fmt(v)}</span>`).join('')}</div>
      ${ctx.ui.tiles([{ k: 'Sent', v: fmt(c.sent), d: `${fmt(c.reached)} contacts` }, { k: 'Opened', v: fmt(c.opened), d: pct(c.openRate, 0) }, { k: 'Human clickers', v: fmt(c.clickers), d: `${pct(c.clickRate, 1)} · ${fmt(c.fastClicks)} fast clicks excluded` }, { k: 'Book a Demo', v: fmt(c.demo), d: `${fmt(c.demoDirect)} direct · ${fmt(c.demoVia)} via GSI/SI page` }])}
      <div class="grid g2" style="margin-top:12px"><div class="card"><h3>Links clicked</h3><div class="chartbox short"><canvas id="cLinks"></canvas></div></div><div class="card"><h3>Clicks by email step</h3><div class="chartbox short"><canvas id="cSteps"></canvas></div></div></div>
      <div class="tblwrap" style="margin-top:12px"><table><thead><tr><th class="l">Type</th><th>People</th><th>Also clicked Book a Demo</th><th>No Book a Demo</th><th>Clicks</th></tr></thead><tbody>${E.CATEGORY_ORDER.filter(k => c.catStats[k]).map(k => { const r = c.catStats[k]; return `<tr><td class="l">${esc(k)}</td><td>${fmt(r.people)}</td><td>${k === 'Book a Demo' ? 'n/a' : fmt(r.demoPeople)}</td><td>${k === 'Book a Demo' ? 'n/a' : fmt(r.otherPeople)}</td><td>${fmt(r.clicks)}</td></tr>`; }).join('') || '<tr><td colspan="5" class="muted">No human clicks.</td></tr>'}</tbody></table></div>
      ${[['demo', '1 · Book a Demo'], ['engaged', '2 · Other clicks, no Book a Demo'], ['opened', '3 · Opened, no click yet']].map(([k, t]) => `<h3 style="margin-top:16px">${t} <span class="tag">${fmt(segs[k].length)}</span> ${segs[k].length ? `<button class="btn tiny ghost" data-cc="seg-${k}">Copy emails</button>` : ''}</h3>${!segs[k].length ? '<p class="muted" style="font-size:13px">None.</p>' : k === 'opened' ? `<div style="display:flex;flex-wrap:wrap;gap:6px">${segs[k].slice(0, 300).map(p => `<span class="tag" style="font-family:var(--font);padding:3px 8px">${emailBtn(p.email)} <span class="muted">· ${fmt(p.opens)} open${p.opens === 1 ? '' : 's'}</span></span>`).join('')}</div>${segs[k].length > 300 ? `<p class="muted" style="font-size:12.5px">${fmt(segs[k].length - 300)} more: use Copy emails.</p>` : ''}` : segs[k].slice(0, 200).map(p => personRow(p)).join('')}`).join('')}</div>`;
    box.querySelectorAll('[data-cc]').forEach(b => b.onclick = () => {
      const k = b.dataset.cc;
      if (k === 'close') { S.open = null; drawCampaign(); return; }
      const list = k === 'all' ? cp : k === 'table' ? cp : k === 'clickers' ? segs.demo.concat(segs.engaged) : segs[k.slice(4)];
      copyText(ctx, k === 'table' ? E.peopleTsv(list) : list.map(p => p.email).join('\n'), k === 'table' ? `${list.length} rows` : `${list.length} emails`);
    });
    const lp = [...c.linkPop.entries()].sort((x, y) => y[1] - x[1]).slice(0, 10);
    chart(box.querySelector('#cLinks'), { type: 'bar', data: { labels: lp.map(([l]) => l.length > 36 ? l.slice(0, 35) + '…' : l), datasets: [{ data: lp.map(([, n]) => n), backgroundColor: lp.map(([l]) => /Book a Demo/.test(l) ? C.navy : C.orange), borderRadius: 4 }] }, options: { indexAxis: 'y', maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, ticks: { precision: 0 } }, y: { grid: { display: false }, ticks: { font: { size: 11 } } } } } });
    chart(box.querySelector('#cSteps'), { type: 'bar', data: { labels: steps.map(s => 'Step ' + s), datasets: [{ label: 'Human clicks', data: steps.map(s => c.stepClicks.get(s) || 0), backgroundColor: C.orange, borderRadius: 4, yAxisID: 'y' }, { type: 'line', label: 'Emails sent', data: steps.map(s => c.stepSent.get(s) || 0), borderColor: C.stone, backgroundColor: C.stone, yAxisID: 'y2', tension: .3 }] }, options: { maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } }, y2: { position: 'right', beginAtZero: true, grid: { display: false } }, x: { grid: { display: false } } } } });
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };
  drawCampaign();

  // people list
  function personRow(p) {
    const links = [...p.links.values()].filter(l => l.count).map(l => `${esc(l.label)}${l.count > 1 ? ' ×' + l.count : ''}`).join(' · ');
    return `<div class="pcard"><div>${emailBtn(p.email)}<div class="muted" style="font-size:12px">${esc(p.company)}${hsBadge(hs.get(p.email), esc)}</div></div><div style="font-size:12.5px">${links || `<span class="muted">${fmt(p.opens)} open${p.opens === 1 ? '' : 's'}</span>`}${p.fastClicks ? ` <span class="muted">· ${fmt(p.fastClicks)} fast click${p.fastClicks === 1 ? '' : 's'} excluded</span>` : ''}</div><div style="text-align:right;font-size:12.5px">${p.demo ? `<span class="pill p-high">demo ${fmt(p.demo)}</span> ` : ''}${p.clicks ? `${fmt(p.clicks)} click${p.clicks === 1 ? '' : 's'}` : ''}<div class="muted">${esc(F.timeAgo(p.lastTs))}</div></div></div>`;
  }
  const segOpts = [['demo', 'Book a Demo'], ['engaged', 'Other clicks'], ['opened', 'Opened only'], ['sent', 'Sent only'], ['all', 'All']];
  const drawPeople = () => {
    let list = S.seg === 'all' ? P : P.filter(p => p.segment === S.seg);
    if (S.q) { const q = S.q.toLowerCase(); list = list.filter(p => p.email.includes(q) || p.company.toLowerCase().includes(q)); }
    el.querySelector('#pcount').innerHTML = `${fmt(Math.min(S.limit, list.length))} of ${fmt(list.length)} · <button class="btn tiny ghost" id="pcopy">Copy these ${fmt(list.length)} emails</button>`;
    el.querySelector('#pcopy').onclick = () => copyText(ctx, list.map(p => p.email).join('\n'), `${list.length} emails`);
    el.querySelector('#plist').innerHTML = list.slice(0, S.limit).map(personRow).join('') + (list.length > S.limit ? `<p style="margin-top:8px"><button class="btn tiny" id="pmore">Show ${fmt(Math.min(300, list.length - S.limit))} more</button></p>` : '') || '<p class="muted">Nobody here.</p>';
    const more = el.querySelector('#pmore'); if (more) more.onclick = () => { S.limit += 300; drawPeople(); };
  };
  ctx.ui.seg(el.querySelector('#segTabs'), segOpts.map(([value, label]) => ({ value, label: `${label} (${fmt(value === 'all' ? P.length : P.filter(p => p.segment === value).length)})` })), v => { S.seg = v; S.limit = 150; drawPeople(); }, S.seg);
  let qt = null; el.querySelector('#pq').oninput = e => { clearTimeout(qt); qt = setTimeout(() => { S.q = e.target.value.trim(); drawPeople(); }, 150); };
  drawPeople();

  // person drawer (event delegation covers every email button on the page)
  // One delegated listener per container (the main element outlives renders); it calls
  // whatever the current render registered in ACTIVE.
  function wirePeople(root) {
    ACTIVE = { ctx, openPerson };
    if (root._emailWired) return;
    root._emailWired = true;
    root.addEventListener('click', ev => {
      if (!ACTIVE) return;
      const raw = ev.target.closest('[data-copyraw]'); if (raw) { copyText(ACTIVE.ctx, raw.dataset.copyraw, `${raw.dataset.copyraw.split('\n').filter(Boolean).length} emails`); return; }
      const cp = ev.target.closest('[data-copy]'); if (cp) { copyText(ACTIVE.ctx, cp.dataset.copy, cp.dataset.copy); return; }
      const pb = ev.target.closest('[data-person]'); if (pb) ACTIVE.openPerson(pb.dataset.person);
    });
  }
  function openPerson(email) {
    const p = E.people(scoped.filter(e => e.contact === email))[0];
    if (!p) return;
    const inR = byEmail.get(email);
    const c = hs.get(email);
    closeDrawer();
    const d = document.createElement('aside'); d.className = 'drawer'; d.id = 'personDrawer';
    d.innerHTML = `<button class="btn tiny ghost x" data-x>Close</button><div class="seghead">Person · all time</div><h2 style="word-break:break-all">${esc(email)}</h2>
      <p style="margin:6px 0"><button class="btn tiny" data-copy="${esc(email)}">Copy email</button> <a class="btn tiny ghost" href="mailto:${esc(email)}">Email</a></p>
      <p class="muted">${esc(p.company)} · ${ctx.ui.pill(E.SEGMENT_LABEL[p.segment], p.segment === 'demo' ? 'p-high' : p.segment === 'engaged' ? 'p-med' : 'p-na')}${inR && inR.segment !== p.segment ? ` <span style="font-size:12px">(in the selected range: ${esc(E.SEGMENT_LABEL[inR.segment])})</span>` : ''}</p>
      ${c ? `<div class="card" style="margin-top:10px;font-size:13px"><b>HubSpot</b>: ${esc([c.first_name, c.last_name].filter(Boolean).join(' ') || '')} ${c.jobtitle ? '· ' + esc(c.jobtitle) : ''}<br>Lead status <b>${esc(c.lead_status || '–')}</b> · lifecycle ${esc(c.lifecycle || '–')} · owner <b>${esc(c.owner_name || 'none')}</b><br>Created ${esc(F.istDateTime(c.created_at))} · last activity ${c.last_activity_at ? esc(F.timeAgo(c.last_activity_at)) + (c.last_activity_type ? ' (' + esc(c.last_activity_type) + ')' : '') : 'none'}</div>` : '<p class="muted" style="font-size:12.5px;margin-top:8px">Not in the HubSpot pull.</p>'}
      ${ctx.ui.tiles([{ k: 'Book a Demo', v: fmt(p.demo), d: `${fmt(p.demoDirect)} direct · ${fmt(p.demoVia)} via` }, { k: 'Human clicks', v: fmt(p.clicks), d: `${fmt(p.fastClicks)} fast excluded` }, { k: 'Opens', v: fmt(p.opens), d: '' }, { k: 'Emails sent', v: fmt(p.sent), d: `${p.campaignList.length} campaign${p.campaignList.length === 1 ? '' : 's'}` }]).replace('class="tiles"', 'class="tiles" style="grid-template-columns:1fr 1fr;margin-top:12px"')}
      <h3 style="margin-top:16px">Links</h3>${[...p.links.values()].map(l => `<div style="font-size:13px;padding:4px 0;border-top:1px solid var(--line)"><b>${esc(l.label)}</b> <span class="muted">${esc(l.cat)}</span> · ${fmt(l.count)} human${l.fast ? `, ${fmt(l.fast)} fast` : ''}<br><span class="muted" style="font-size:11.5px">${l.dates.map(t => esc(F.istDateTime(t))).join(' · ')}</span></div>`).join('') || '<p class="muted">No clicks.</p>'}
      <h3 style="margin-top:16px">Campaigns</h3><p style="font-size:13px">${p.campaignList.map(x => esc(campaignLabel(x))).join('<br>')}</p>
      <h3 style="margin-top:16px">Timeline</h3><ul class="tline">${p.timeline.map(e => `<li class="${e.event}${e.demo ? ' demo' : ''}${e.event === 'clicked' && !e.human ? ' fast' : ''}"><b>${esc(e.event === 'clicked' ? (e.human ? 'Clicked' : 'Fast click (excluded)') : e.event[0].toUpperCase() + e.event.slice(1).replace('_', ' '))}</b>${e.step ? ' · Step ' + e.step : ''}${e.label ? ' · ' + esc(e.label) : ''} <span class="muted">· ${esc(F.istDateTime(e.ts))}${e.event === 'clicked' && e.lag != null ? ` · ${dur(e.lag)} after send` : ''} · ${esc(campaignLabel(e.campaign))}</span></li>`).join('')}</ul>`;
    document.body.appendChild(d);
    d.querySelector('[data-x]').onclick = closeDrawer;
    d.addEventListener('click', ev => { const cp = ev.target.closest('[data-copy]'); if (cp) copyText(ctx, cp.dataset.copy, cp.dataset.copy); });
    document.addEventListener('keydown', escClose);
  }

  // AI
  ctx.mountInsights(el.querySelector('#aiPanel'), ctx, { scope: `email:${from}:${to}:${S.campaign || 'all'}:${S.company || 'all'}`, kind: 'email', title: 'What the email numbers say and what to do', inputProvider: () => {
    const wk = new Map(); for (const e of scoped) { const k = F.weekKey(e.day); if (!wk.has(k)) wk.set(k, []); wk.get(k).push(e); }
    const mo = new Map(); for (const e of scoped) { const k = e.day.slice(0, 7); if (!mo.has(k)) mo.set(k, []); mo.get(k).push(e); }
    const slim = f => ({ sent: f.sent, reached: f.reached, opened: f.opened, clickers: f.clickers, demo: f.demo, demo_direct: f.demoDirect, demo_via: f.demoVia, fast_clicks: f.fastClicks, click_rate: f.clickRate && Math.round(f.clickRate * 10) / 10 });
    return {
      range: { from, to, days }, filter: { campaign: S.campaign || 'all', account: S.company || 'all' }, rules: { fast_click_seconds: rules.fast_click_seconds, gsi_page_counts_as_demo: rules.gsi_page_counts_as_demo },
      totals: slim(T), previous_totals: slim(TP), api_in_range: apiCur.length ? { sent: apiSent, replies: apiReplies, unique_clicks: apiSum(apiCur, 'unique_clicks'), opportunities: apiSum(apiCur, 'opportunities') } : null,
      by_week: [...wk.entries()].sort().slice(-12).map(([k, v]) => ({ week: k, ...slim(E.funnel(v)) })),
      by_month: [...mo.entries()].sort().slice(-6).map(([k, v]) => ({ month: k, ...slim(E.funnel(v)) })),
      campaigns: campRows.slice(0, 25).map(r => ({ name: campaignLabel(r.name), status: r.api ? r.api.status : null, ...(r.csv ? slim(r.csv) : {}), replies_in_range: r.rangeReplies, all_time: r.api ? { sent: r.api.sent, contacted: r.api.contacted, replied: r.api.replied_unique, bounced: r.api.bounced, opportunities: r.api.opportunities } : null, steps: r.csv ? Object.fromEntries([...r.csv.stepClicks]) : null })),
      accounts: ACC.filter(a => a.reached).slice(0, 25).map(a => ({ account: a.company, ...slim(a), last_click: a.lastClick })),
      link_types: Object.fromEntries(Object.entries(CAT).map(([k, v]) => [k, { people: v.people, no_demo: v.otherPeople, clicks: v.clicks }])),
      mailboxes: SEND.map(s => ({ mailbox: s.sender, sent: s.sent, open_rate: s.openRate && Math.round(s.openRate), click_rate: s.clickRate && Math.round(s.clickRate * 10) / 10, bounced: s.bounced })),
      top_demo_people: leaders.slice(0, 15).map(p => ({ company: p.company, demo_clicks: p.demo, direct: p.demoDirect, via: p.demoVia, campaigns: p.campaignList.map(campaignLabel), hubspot_owner: (hs.get(p.email) || {}).owner_name || null, hubspot_status: (hs.get(p.email) || {}).lead_status || null })),
      lists: Object.fromEntries(groups.map(([k, , , list]) => [k, list.length])),
    };
  } });
}

function dur(s) { s = Math.max(0, Math.round(s)); if (s < 90) return s + ' s'; if (s < 5400) return Math.round(s / 60) + ' min'; if (s < 172800) return Math.floor(s / 3600) + ' h ' + Math.round((s % 3600) / 60) + ' min'; return Math.floor(s / 86400) + ' d ' + Math.round((s % 86400) / 3600) + ' h'; }
function hsBadge(c, esc) { return c ? ` · <span title="In HubSpot">HubSpot: ${esc(c.lead_status || c.lifecycle || 'contact')}${c.owner_name ? ', ' + esc(c.owner_name) : ''}</span>` : ''; }
function statusPill(s, ctx) { const m = { 0: ['Draft', 'p-na'], 1: ['Active', 'p-high'], 2: ['Paused', 'p-med'], 3: ['Completed', 'p-na'] }[s] || ['Other', 'p-na']; return ctx.ui.pill(m[0], m[1]); }
function escClose(e) { if (e.key === 'Escape') closeDrawer(); }
function closeDrawer() { const d = document.getElementById('personDrawer'); if (d) d.remove(); document.removeEventListener('keydown', escClose); }

function wireSync(el, ctx, done) {
  const b = el.querySelector('#syncBtn'); if (!b) return;
  b.onclick = async () => {
    b.disabled = true; let cursor, res, full = !confirm('Pull only the last 30 days? (Cancel pulls the whole history of every campaign, which takes longer.)');
    try {
      for (let guard = 0; guard < 60; guard++) {
        res = await ctx.api.post('instantly/sync', cursor ? { cursor } : { full });
        b.innerHTML = `<span class="spin"></span> ${res.progress ? `${res.progress.done} of ${res.progress.total} campaigns` : 'Syncing'}`;
        for (const w of res.warnings || []) ctx.toast(w);
        if (res.done) break; cursor = res.cursor;
      }
      ctx.toast(`Instantly synced: ${res.campaigns} GSI campaigns, ${res.days} daily rows.`);
      done();
    } catch (e) { ctx.toast('Instantly sync failed: ' + (e.message || e), 'err'); b.disabled = false; b.textContent = 'Sync Instantly now'; }
  };
}
