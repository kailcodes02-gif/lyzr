// GSI/SI conversations pipeline: the HubSpot deals widget from the weekly reports, with
// "what changed" computed from ca_hs_deal_history over the global range. All aggregation
// lives in js/lib/pipeline-agg.mjs (unit-tested); this file only draws.
import { BUCKETS, BUCKET_LABELS, BUCKET_COLORS, filterDeals, searchDeals, sortDeals, partners, kpis, byQuarter, byPartner, byMotion, stageMix, bySubstage, acvByPartner, changesIn, compareChanges, insightInput, isOpen } from '../lib/pipeline-agg.mjs';

export const route = 'hubspot/pipeline';
export const title = 'Pipeline';

const S = { mode: 'all', partner: '', tab: 'timeline', q: '', sort: { key: 'created_at', dir: -1 }, limit: 100 };
let charts = [];
export function destroy() { for (const c of charts) { try { c.destroy(); } catch {} } charts = []; }

// Brand palette (bucket colours live in pipeline-agg.mjs): navy for data, black for closed money, greys for axes.
const NAVY = '#043E77', BLACK = '#1F2022', INK2 = '#6B675F';
const TABS = [{ value: 'timeline', label: 'Timeline' }, { value: 'companies', label: 'Companies' }, { value: 'motion', label: 'Motion' }, { value: 'stages', label: 'Stage mix' }, { value: 'substages', label: 'Sub-stage' }, { value: 'acv', label: 'ACV' }];
const truncate = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; };
const money = (usd, v) => v ? usd(v) : '<span class="muted">no amount</span>';

export async function render(el, ctx) {
  destroy();
  const { esc, fmt, usd, pct, rangeLabel, istDateTime, timeAgo, dayLabel } = ctx.fmt;
  const { tiles, pill, table, seg, section, spinner, empty } = ctx.ui;
  const { from, to, prev } = ctx.state;
  const isEditor = !!ctx.demo || !!(ctx.settings && ctx.settings.editors && ctx.user && ctx.settings.editors.includes(String(ctx.user.email || '').toLowerCase()));
  const head = `<div class="seghead">HubSpot · Pipeline</div><h1>GSI/SI conversations</h1><div class="intro"><b>The partnership pipeline</b>: every HubSpot deal that is a conversation with a GSI or SI, either tagged with the GSI property or attached to a company on the GSI account list (Admin › GSI accounts). Deals are grouped into four buckets from their own pipeline's stages: in conversation, demo (late stage), won and lost. The charts always show the whole pipeline; the "What changed" section reads the sync history for ${esc(rangeLabel(from, to))} so you can see what is new, what moved and what closed in that period. Pulled from HubSpot read-only, every morning at 07:00 IST.</div>`;
  el.innerHTML = head + spinner('Loading the pipeline');
  let data;
  try { data = await ctx.api.get('hubspot/deals', { from, to }); } catch (e) { el.innerHTML = head + `<div class="empty">Pipeline data could not be loaded: ${esc(e.message || e)}</div>`; return; }
  const all = data.deals || [];
  const history = data.history || [];
  const ls = data.last_sync;
  const syncHtml = `<div><b>Last sync</b> <span class="muted">${ls && ls.finished_at ? `${esc(istDateTime(ls.finished_at))} (${esc(timeAgo(ls.finished_at))}) · ${fmt(ls.deals)} deals, ${fmt(ls.changes)} changes${ls.status && ls.status !== 'done' ? ' · ' + esc(ls.status) : ''}${ls.error ? ' · ' + esc(ls.error) : ''}` : 'never'}</span></div>
    ${isEditor ? `<button class="btn tiny primary" id="dealsSync">Sync from HubSpot now</button>` : `<span class="muted" style="font-size:12.5px">Synced automatically every morning at 07:00 IST</span>`}
    <span id="dealsProg" class="muted" style="font-size:12.5px;flex-basis:100%"></span>`;
  const syncCard = `<div class="card" style="display:flex;gap:14px;align-items:center;flex-wrap:wrap;margin:14px 0 18px">${syncHtml}</div>`;
  if (!all.length) {
    el.innerHTML = head + syncCard + empty('No deals have been synced yet. ' + (isEditor ? 'Click "Sync from HubSpot now" to run the first pull, or wait for the morning job.' : 'The morning job will fill this page; an editor can also sync now.'), '');
    wireSync();
    return;
  }
  const bucketPill = b => pill(BUCKET_LABELS[b] || b, b === 'won' ? 'p-high' : b === 'demo' ? 'p-med' : b === 'conversation' ? 'p-low' : 'p-na');
  const allPartners = partners(all);

  function draw() {
    destroy();
    const rows = filterDeals(all, { mode: S.mode, partner: S.partner });
    const k = kpis(rows);
    const ch = changesIn(history, rows, from, to);
    const cmp = compareChanges(history, rows, from, to, prev);
    const vs = (key) => cmp.prev ? `<span class="muted">vs ${fmt(cmp.prev[key])} ${esc(prev.label)}</span>` : '';
    const filterLabel = S.partner ? S.partner : S.mode === 'accenture' ? 'Accenture' : S.mode === 'other' ? 'other GSIs and SIs' : 'all partners';
    const q = (r) => `<span class="muted" style="font-size:11.5px">${esc(dayLabel(r.at.slice(0, 10)))}</span>`;
    const changeList = (list, line) => list.length ? `<div style="max-height:320px;overflow:auto">${list.map(r => `<div style="border-top:1px solid var(--line);padding:7px 0;font-size:13px"><b>${esc(truncate(r.name, 60))}</b> <span class="muted">${esc(r.partner)}</span><br>${line(r)} ${q(r)}</div>`).join('')}</div>` : '<p class="muted" style="font-size:13px">Nothing in this period.</p>';

    el.innerHTML = head + syncCard + `
      <div class="toc"><span class="tl">On this page</span><a href="#p-kpis">Numbers</a><a href="#p-changes">What changed</a><a href="#p-charts">Charts</a><a href="#p-table">All deals</a><a href="#p-ai">AI read-out</a>
        <span style="margin-left:auto;display:flex;gap:14px;align-items:center;font-size:12.5px;flex-wrap:wrap"><span id="modeSeg" style="margin:0;border:0"></span>
        <label style="display:flex;gap:6px;align-items:center">Partner <select id="partnerSel"><option value="">All</option>${allPartners.map(p => `<option value="${esc(p)}" ${S.partner === p ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select></label></span></div>

      ${section('Pipeline today', `Whole pipeline for ${esc(filterLabel)}: ${fmt(rows.length)} deals. Ongoing = in conversation plus demo. Customers = partners with at least one won deal. ACV sums the HubSpot amount; ${fmt(rows.filter(r => !r.amount).length)} deals have no amount.`, tiles([
        { k: 'Total', v: fmt(k.total), d: 'conversations' },
        { k: 'Ongoing', v: fmt(k.ongoing), d: `${fmt(k.ongoing - k.demos)} in conversation, ${fmt(k.demos)} at demo` },
        { k: 'Demos', v: fmt(k.demos), d: 'late stage' },
        { k: 'Wins', v: `<span class="up">${fmt(k.wins)}</span>`, d: 'closed won' },
        { k: 'Losses', v: `<span class="down">${fmt(k.losses)}</span>`, d: 'closed lost' },
        { k: 'Customers', v: fmt(k.customers), d: 'partners with a won deal' },
        { k: 'Closed ACV', v: usd(k.closed_acv), d: `${fmt(k.won_with_amount)} won deals with an amount` },
        { k: 'Open pipeline ACV', v: usd(k.open_acv), d: `${fmt(k.open_with_amount)} open deals with an amount` },
      ]), 'p-kpis')}

      ${section('What changed', `Sync history for ${esc(rangeLabel(from, to))}${cmp.prev ? `, compared with ${esc(prev.label)} (${esc(rangeLabel(prev.from, prev.to))})` : ''}. New deals are dated by their HubSpot create date; moves, amount changes and closes by the sync that noticed them, so the first sync after a quiet spell can bunch changes on one day.`, tiles([
        { k: 'New deals', v: fmt(ch.counts.new), d: vs('new') },
        { k: 'Stage moves', v: fmt(ch.counts.stage), d: vs('stage') },
        { k: 'Amount changes', v: fmt(ch.counts.amount), d: `${ch.counts.amount_delta >= 0 ? '+' : ''}${usd(ch.counts.amount_delta)} net ${vs('amount')}` },
        { k: 'Closed won', v: `<span class="up">${fmt(ch.counts.won)}</span>`, d: vs('won') },
        { k: 'Closed lost', v: `<span class="down">${fmt(ch.counts.lost)}</span>`, d: vs('lost') },
      ]) + `<div class="grid g2" style="margin-top:14px">
        <div class="card"><h3>New deals (${fmt(ch.new.length)})</h3>${changeList(ch.new, r => `entered at ${esc(r.to_value || 'unknown stage')} · ${money(usd, r.amount)}`)}</div>
        <div class="card"><h3>Stage movements (${fmt(ch.stage.length)})</h3>${changeList(ch.stage, r => `${esc(r.from_value || '?')} → <b>${esc(r.to_value || '?')}</b> · ${money(usd, r.amount)}`)}</div>
        <div class="card"><h3>Closed (${fmt(ch.closed.length)})</h3>${changeList(ch.closed, r => `${r.to_value === 'won' ? '<span class="up">Won</span>' : '<span class="down">Lost</span>'} from ${esc(r.from_value || 'open')} · ${money(usd, r.amount)}`)}</div>
        <div class="card"><h3>Amount changes (${fmt(ch.amount.length)})</h3>${changeList(ch.amount, r => `${usd(Number(r.from_value) || 0)} → <b>${usd(Number(r.to_value) || 0)}</b>`)}</div>
      </div>`, 'p-changes')}

      ${section('Charts', 'Timeline: deals by projected close quarter (close date, else create date). Companies: the top partners. Motion: the HubSpot deal type. Stage mix and sub-stage: where deals sit. ACV: money by partner, closed against open.', `<div id="tabSeg"></div><div class="grid g2w"><div class="card"><div class="chartbox tall"><canvas id="tabChart"></canvas></div></div><div id="tabTable"></div></div>`, 'p-charts')}

      ${section('All deals', 'Search, click a header to sort.', `<div class="row" style="margin-bottom:10px"><input type="search" id="dealQ" placeholder="Search deal, partner, stage, motion" value="${esc(S.q)}" style="min-width:280px"><span class="muted" id="dealCount" style="font-size:12.5px"></span></div><div id="dealTable"></div>`, 'p-table')}
      ${section('AI read-out', 'Claude reads the aggregates on this page.', `<div id="pipeInsights"></div>`, 'p-ai')}`;

    // ---- wiring ------------------------------------------------------------------------------
    wireSync();
    seg(el.querySelector('#modeSeg'), [{ value: 'all', label: 'All' }, { value: 'accenture', label: 'Accenture' }, { value: 'other', label: 'Other GSIs' }], v => { S.mode = v; S.partner = ''; draw(); }, S.mode);
    el.querySelector('#partnerSel').onchange = e => { S.partner = e.target.value; draw(); };
    seg(el.querySelector('#tabSeg'), TABS, v => { S.tab = v; drawChart(rows); }, S.tab);
    drawChart(rows);

    // full table
    const COLS = [
      { k: 'name', h: 'Deal', left: true, f: r => `${esc(r.name)}${r.pipeline_label ? `<br><span class="muted" style="font-size:11.5px">${esc(r.pipeline_label)}</span>` : ''}` },
      { k: 'partner', h: 'Partner', left: true, f: r => `<b>${esc(r.partner || 'Unknown')}</b>${r.company_raw && r.company_raw !== r.partner ? `<br><span class="muted" style="font-size:11.5px">${esc(truncate(r.company_raw, 40))}</span>` : ''}` },
      { k: 'stage', h: 'Stage', f: r => bucketPill(r.bucket) },
      { k: 'substage', h: 'Sub-stage', left: true, f: r => `${esc(r.substage || '–')}${r.prev_stage ? `<br><span class="muted" style="font-size:11.5px">was ${esc(r.prev_stage)}</span>` : ''}` },
      { k: 'amount', h: 'Amount', f: r => r.amount ? usd(r.amount) : '<span class="muted">–</span>' },
      { k: 'close_date', h: 'Close date', f: r => r.close_date ? esc(dayLabel(r.close_date)) + ' ' + r.close_date.slice(0, 4) : '<span class="muted">–</span>' },
      { k: 'created_at', h: 'Created (IST)', f: r => esc(istDateTime(r.created_at)) },
      { k: 'motion_label', h: 'Motion', f: r => esc(r.motion_label || '–') },
      { k: 'forecast', h: 'Forecast', f: r => r.forecast ? esc(r.forecast) : '<span class="muted">–</span>' },
    ];
    function drawTable() {
      const list = sortDeals(searchDeals(rows, S.q), S.sort.key, S.sort.dir);
      el.querySelector('#dealCount').textContent = `${fmt(Math.min(list.length, S.limit))} of ${fmt(list.length)} shown${S.q ? ` for "${S.q}"` : ''}`;
      el.querySelector('#dealTable').innerHTML = `<div class="tblwrap"><table><thead><tr>${COLS.map(c => `<th class="${c.left ? 'l' : ''}" data-sort="${c.k}" style="cursor:pointer;user-select:none">${esc(c.h)}${S.sort.key === c.k ? (S.sort.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr></thead><tbody>${list.slice(0, S.limit).map(r => `<tr>${COLS.map(c => `<td class="${c.left ? 'l' : ''}">${c.f(r)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>${list.length > S.limit ? `<p class="muted" style="font-size:12.5px;margin-top:6px"><button class="btn tiny" id="moreBtn">Show ${fmt(Math.min(100, list.length - S.limit))} more</button></p>` : ''}`;
      el.querySelectorAll('th[data-sort]').forEach(th => th.onclick = () => { const key = th.dataset.sort; S.sort = { key, dir: S.sort.key === key ? -S.sort.dir : (key === 'created_at' || key === 'amount' || key === 'close_date' ? -1 : 1) }; drawTable(); });
      const more = el.querySelector('#moreBtn'); if (more) more.onclick = () => { S.limit += 100; drawTable(); };
    }
    drawTable();
    let t = null; el.querySelector('#dealQ').oninput = e => { clearTimeout(t); t = setTimeout(() => { S.q = e.target.value.trim(); S.limit = 100; drawTable(); }, 150); };

    // AI
    ctx.mountInsights(el.querySelector('#pipeInsights'), ctx, { scope: `pipeline:${from}:${to}`, kind: 'overview', channel: 'overview', title: 'What the pipeline says', inputProvider: () => insightInput(rows, history, { from, to, prev, mode: S.mode, partner: S.partner }) });
  }

  // ---- charts (one canvas, redrawn per tab) ----------------------------------------------------
  function drawChart(rows) {
    destroy();
    const canvas = el.querySelector('#tabChart'), side = el.querySelector('#tabTable');
    if (!canvas || typeof Chart === 'undefined') return;
    const bucketSets = list => BUCKETS.map(b => ({ label: BUCKET_LABELS[b], data: list.map(r => r[b]), backgroundColor: BUCKET_COLORS[b], borderWidth: 0, stack: 'a' }));
    const base = (horizontal) => ({ responsive: true, maintainAspectRatio: false, indexAxis: horizontal ? 'y' : 'x', scales: { x: { stacked: true, grid: { display: !horizontal ? false : true, color: '#E3E1DE' }, ticks: { color: INK2, precision: 0 }, beginAtZero: true }, y: { stacked: true, beginAtZero: true, grid: { display: horizontal ? false : true, color: '#E3E1DE' }, ticks: { color: INK2, precision: 0 } } }, plugins: { legend: { position: 'bottom', labels: { color: BLACK, boxWidth: 12 } }, tooltip: { mode: 'index' } } });
    const bucketCols = [...BUCKETS.map(b => ({ h: BUCKET_LABELS[b], k: b, f: r => fmt(r[b]) })), { h: 'Total', k: 'total', f: r => `<b>${fmt(r.total)}</b>` }];
    let chart = null;
    if (S.tab === 'timeline') {
      const qs = byQuarter(rows);
      chart = new Chart(canvas, { type: 'bar', data: { labels: qs.map(r => r.key), datasets: bucketSets(qs) }, options: base(false) });
      side.innerHTML = table({ cols: [{ h: 'Quarter', k: 'key', left: true, f: r => esc(r.key) }, ...bucketCols, { h: 'Open ACV', k: 'open_acv', f: r => usd(r.open_acv) }], rows: qs });
    } else if (S.tab === 'companies') {
      const ps = byPartner(rows, 14);
      chart = new Chart(canvas, { type: 'bar', data: { labels: ps.map(r => r.key), datasets: bucketSets(ps) }, options: base(true) });
      side.innerHTML = table({ cols: [{ h: 'Partner', k: 'key', left: true, f: r => esc(r.key) }, ...bucketCols, { h: 'Open ACV', k: 'open_acv', f: r => usd(r.open_acv) }], rows: ps });
    } else if (S.tab === 'motion') {
      const ms = byMotion(rows);
      chart = new Chart(canvas, { type: 'bar', data: { labels: ms.map(r => r.key), datasets: bucketSets(ms) }, options: base(true) });
      side.innerHTML = table({ cols: [{ h: 'Motion', k: 'key', left: true, f: r => esc(r.key) }, ...bucketCols, { h: 'Pipeline $', k: 'amount', f: r => usd(r.amount) }, { h: 'Open ACV', k: 'open_acv', f: r => usd(r.open_acv) }, { h: 'Closed ACV', k: 'closed_acv', f: r => usd(r.closed_acv) }], rows: ms });
    } else if (S.tab === 'stages') {
      const mix = stageMix(rows);
      chart = new Chart(canvas, { type: 'doughnut', data: { labels: mix.map(r => r.label), datasets: [{ data: mix.map(r => r.count), backgroundColor: mix.map(r => BUCKET_COLORS[r.bucket]), borderWidth: 0 }] }, options: { responsive: true, maintainAspectRatio: false, cutout: '62%', plugins: { legend: { position: 'bottom', labels: { color: BLACK, boxWidth: 12 } } } } });
      side.innerHTML = table({ cols: [{ h: 'Bucket', k: 'label', left: true, f: r => `<span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${BUCKET_COLORS[r.bucket]};margin-right:6px;vertical-align:middle"></span>${esc(r.label)}` }, { h: 'Deals', k: 'count', f: r => fmt(r.count) }, { h: 'Share', k: 'share', f: r => pct(r.share, 0) }, { h: 'Amount', k: 'amount', f: r => usd(r.amount) }], rows: mix, total: { label: 'Total', count: fmt(rows.length), share: '100%', amount: usd(mix.reduce((a, r) => a + r.amount, 0)) } });
    } else if (S.tab === 'substages') {
      const ss = bySubstage(rows);
      chart = new Chart(canvas, { type: 'bar', data: { labels: ss.map(r => r.substage), datasets: [{ label: 'Deals', data: ss.map(r => r.count), backgroundColor: ss.map(r => BUCKET_COLORS[r.bucket]), borderWidth: 0 }] }, options: { ...base(true), plugins: { legend: { display: false }, tooltip: { callbacks: { afterLabel: i => BUCKET_LABELS[ss[i.dataIndex].bucket] } } } } });
      side.innerHTML = table({ cols: [{ h: 'Sub-stage', k: 'substage', left: true, f: r => esc(r.substage) }, { h: 'Bucket', k: 'bucket', f: r => bucketPill(r.bucket) }, { h: 'Deals', k: 'count', f: r => fmt(r.count) }, { h: 'Share', k: 'share', f: r => pct(rows.length ? r.count / rows.length * 100 : null, 0) }, { h: 'Amount', k: 'amount', f: r => usd(r.amount) }], rows: ss });
    } else if (S.tab === 'acv') {
      const ac = acvByPartner(rows, 12);
      chart = new Chart(canvas, { type: 'bar', data: { labels: ac.map(r => r.partner), datasets: [{ label: 'Closed ACV', data: ac.map(r => r.closed), backgroundColor: BLACK, borderWidth: 0, stack: 'a' }, { label: 'Open ACV', data: ac.map(r => r.open), backgroundColor: NAVY, borderWidth: 0, stack: 'a' }] }, options: { ...base(true), scales: { x: { stacked: true, beginAtZero: true, ticks: { color: INK2, callback: v => '$' + ctx.fmt.compact(v) }, grid: { color: '#E3E1DE' } }, y: { stacked: true, grid: { display: false }, ticks: { color: INK2 } } } } });
      side.innerHTML = table({ cols: [{ h: 'Partner', k: 'partner', left: true, f: r => esc(r.partner) }, { h: 'Closed ACV', k: 'closed', f: r => usd(r.closed) }, { h: 'Open ACV', k: 'open', f: r => usd(r.open) }, { h: 'Total', k: 'total', f: r => `<b>${usd(r.total)}</b>` }], rows: ac }) + `<p class="muted" style="font-size:12.5px;margin-top:6px">Top 12 partners by money. Lost deals and deals without an amount are left out. ${fmt(rows.filter(r => isOpen(r) && !r.amount).length)} open deals have no amount yet.</p>`;
    }
    if (chart) charts.push(chart);
  }

  function wireSync() {
    const btn = el.querySelector('#dealsSync'); if (!btn) return;
    btn.onclick = async () => {
      const prog = el.querySelector('#dealsProg'); btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Syncing';
      const warnings = []; let cursor = null, step = 0;
      try {
        for (;;) {
          const r = await ctx.api.post('hubspot/deals-sync', cursor ? { cursor } : {});
          step++; warnings.push(...(r.warnings || []));
          const p = r.progress || {};
          prog.innerHTML = `Step ${step} (${esc(p.phase || '')} ${fmt(p.done)} of ${fmt(p.total)}): ${fmt(r.deals)} deals, ${fmt(r.changes)} changes so far${warnings.length ? ` · ${warnings.length} warning${warnings.length > 1 ? 's' : ''}: ${esc(warnings.slice(-2).join('; '))}` : ''}`;
          if (r.done || !r.cursor || step > 500) break;
          cursor = r.cursor;
        }
        ctx.toast(`Pipeline synced in ${step} step${step > 1 ? 's' : ''}${warnings.length ? ` with ${warnings.length} warning${warnings.length > 1 ? 's' : ''}` : ''}`);
        await render(el, ctx);
      } catch (e) {
        prog.innerHTML = `<span class="err">Sync failed: ${esc(e.message || e)}${e.status === 503 ? ' (HUBSPOT_ACCESS_TOKEN is probably not set on the Pages site)' : ''}</span>`;
        btn.disabled = false; btn.textContent = 'Sync from HubSpot now';
      }
    };
  }
  draw();
}
