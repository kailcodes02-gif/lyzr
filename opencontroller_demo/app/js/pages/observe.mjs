import { pageHead, statCards, panel, table, btn, seg, select, chips, tabs, pill, sheet, toast, esc, icon, empty, kv, toggle, search, modal, field, input, selectField } from '../ui.mjs';
import { S } from '../store.mjs';
import { PROJECTS, EVALUATORS, EVAL_TASKS, DATASETS, PROMPTS, EVAL_CONNECTIONS } from '../data.mjs';
import { lineChart, sparkline, heatGrid, stackedBars } from '../charts.mjs';
import { money, money4, int, pct, ago, latency, tokens, compact, now, DAY, HOUR, dayLabel, timeLabel, groupBy, sum } from '../util.mjs';
import { track } from '../../../shared/session.mjs';

const WIN = [['24h', 'Last 24 hours', DAY], ['7d', 'Last 7 days', 7 * DAY], ['30d', 'Last 30 days', 30 * DAY]];
const winOf = (v) => WIN.find((w) => w[0] === (v.win || '7d')) || WIN[1];
const proj = (id) => PROJECTS.find((p) => p.id === id);
function scoped(v, projectId) {
  const w = winOf(v)[2];
  const t = now();
  const all = projectId ? S.traces.filter((x) => x.project === projectId) : S.traces;
  return { cur: all.filter((x) => t - x.start <= w), prev: all.filter((x) => t - x.start > w && t - x.start <= 2 * w), w };
}
const p99 = (l) => { if (!l.length) return 0; const s = l.map((x) => x.latencyMs).sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * 0.99))]; };
const delta = (a, b) => (b ? `${a >= b ? '+' : '−'}${Math.round(Math.abs((a - b) / b) * 100)}%` : 'new');
function buckets(list, w, n, f) {
  const size = w / n; const t = now();
  const out = Array(n).fill(0);
  for (const x of list) { const i = n - 1 - Math.floor((t - x.start) / size); if (i >= 0 && i < n) out[i] += f(x); }
  return out;
}

function kpis(cur, prev, w) {
  const fail = cur.filter((x) => x.status === 'failed');
  const er = cur.length ? fail.length / cur.length : 0;
  const per = prev.length ? prev.filter((x) => x.status === 'failed').length / prev.length : 0;
  const cost = sum(cur, (x) => x.cost), pcost = sum(prev, (x) => x.cost);
  const calls = sum(cur, (x) => x.calls), pcalls = sum(prev, (x) => x.calls);
  const n = 40;
  const gw = cur.length ? cur.filter((x) => x.gateway).length / cur.length : 0;
  return statCards([
    { label: 'Traces', value: compact(cur.length), delta: delta(cur.length, prev.length), deltaTone: cur.length >= prev.length ? 'up' : 'down', sub: `${compact(sum(cur, (x) => x.spans))} spans`, extra: sparkline(buckets(cur, w, n, () => 1), 'var(--c-accent)') },
    { label: 'Error rate', value: pct(er), delta: `${er >= per ? '+' : '−'}${Math.abs((er - per) * 100).toFixed(1)} pts`, deltaTone: er > per ? 'bad' : 'good', sub: `${int(fail.length)} failed runs`, extra: sparkline(buckets(fail, w, n, () => 1), 'var(--c-red)', { bars: true }) },
    { label: 'Model calls', value: compact(calls), delta: delta(calls, pcalls), sub: `${tokens(sum(cur, (x) => x.tokensIn + x.tokensOut))} tokens`, extra: sparkline(buckets(cur, w, n, (x) => x.calls), 'var(--c-accent)') },
    { label: 'Cost', value: money(cost), delta: delta(cost, pcost), deltaTone: cost > pcost ? 'bad' : 'good', sub: `${money4(cur.length ? cost / cur.length : 0)} a run`, extra: sparkline(buckets(cur, w, n, (x) => x.cost), 'var(--c-accent)') },
    { label: 'P99 latency', value: latency(p99(cur)), delta: delta(p99(cur), p99(prev)), deltaTone: p99(cur) <= p99(prev) ? 'good' : 'bad', sub: `average ${latency(cur.length ? sum(cur, (x) => x.latencyMs) / cur.length : 0)}`, extra: sparkline(buckets(cur, w, n, (x) => x.latencyMs / 1000), 'var(--c-accent)') },
    { label: 'Through the gateway', value: pct(gw, 1), tone: 'amber', sub: `${compact(cur.length - cur.filter((x) => x.gateway).length)} calls went around it` },
  ], 6);
}

const LAT_B = [[0, 2e3, '0'], [2e3, 5e3, '2 s'], [5e3, 10e3, '5 s'], [10e3, 30e3, '10 s'], [30e3, 60e3, '30 s'], [60e3, 180e3, '1 min'], [180e3, 600e3, '3 min'], [600e3, Infinity, '10 min']];
function latencyGrid(cur, w, errorsOnly) {
  const cols = w <= DAY ? 48 : w <= 7 * DAY ? 56 : 60;
  const size = w / cols; const t = now();
  const cells = new Map();
  for (const x of cur) {
    const c = cols - 1 - Math.floor((t - x.start) / size); if (c < 0) continue;
    const r = LAT_B.findIndex(([lo, hi]) => x.latencyMs >= lo && x.latencyMs < hi);
    const k = `${c}:${r}`;
    if (!cells.has(k)) cells.set(k, { col: c, row: r, ok: 0, fail: 0 });
    cells.get(k)[x.status === 'failed' ? 'fail' : 'ok']++;
  }
  for (const cell of cells.values()) { const at = t - (cols - 1 - cell.col) * size; cell.tip = `${dayLabel(at)} at ${timeLabel(at)} · ${LAT_B[cell.row][2]}–${LAT_B[cell.row + 1] ? LAT_B[cell.row + 1][2] : 'more'} ${cell.ok} ok · ${cell.fail} failed`; }
  const xl = [0, Math.floor(cols / 3), Math.floor((2 * cols) / 3), cols - 1].map((c) => { const at = t - (cols - 1 - c) * size; return `${dayLabel(at)} ${timeLabel(at)}`; });
  return heatGrid({ cells: [...cells.values()], cols, rows: LAT_B.length, yLabels: LAT_B.map((b) => b[2]), xLabels: xl, errorsOnly });
}

const BREAK = { models: ['Model', (x) => x.model], providers: ['Provider', (x) => x.provider], agents: ['Agent', (x) => x.agent || 'No agent named'], tools: ['Tool or MCP', (x) => x.tool || 'No tool'], teams: ['Team', (x) => (proj(x.project) || {}).team || 'No team'], users: ['User', (x) => x.user], customers: ['Customer', () => 'No customer'], keys: ['Gateway key', (x) => (x.gateway ? (x.project === PROJECTS[0].id ? 'nordic-capital-agents' : 'ask-ctrl') : 'Around the gateway')], projects: ['Project', (x) => (proj(x.project) || {}).name] };
export function breakdown(cur, prev, by, opts = Object.keys(BREAK).filter((k) => k !== 'projects')) {
  const [label, f] = BREAK[by];
  const total = cur.length || 1; const totalCost = sum(cur, (x) => x.cost) || 1;
  const prevBy = new Map([...groupBy(prev, f)].map(([k, l]) => [k, sum(l, (x) => x.cost)]));
  const rows = [...groupBy(cur, f)].map(([k, l]) => { const fail = l.filter((x) => x.status === 'failed'); const c = sum(l, (x) => x.cost); const pc = prevBy.get(k); return [`<b>${esc(k)}</b>`, int(l.length), pct(l.length / total, 1), pct(fail.length / l.length, 1), latency(sum(l, (x) => x.latencyMs) / l.length), tokens(sum(l, (x) => x.tokensIn)), tokens(sum(l, (x) => x.cached)), tokens(sum(l, (x) => x.tokensOut)), money4(c / l.length), money(sum(fail, (x) => x.cost)), '—', money(c), pc ? delta(c, pc) : 'new', pct(c / totalCost, 1)]; })
    .sort((a, b) => parseFloat(b[11].replace(/[$,]/g, '')) - parseFloat(a[11].replace(/[$,]/g, '')));
  return panel({ title: 'Breakdown', desc: 'Model calls, and tool calls, grouped.', right: seg('by', opts.map((k) => [k, { models: 'Models', providers: 'Providers', agents: 'Agents', tools: 'Tools & MCP', teams: 'Teams', users: 'Users', customers: 'Customers', keys: 'Gateway keys', projects: 'Projects' }[k]]), by, { sm: true }),
    body: table({ cls: 'wide', cols: [{ label }, ...['Calls', 'Share', 'Error rate', 'Avg latency', 'Input', 'Cached', 'Output', 'Per call', 'Failed spend', 'Unpriced', 'Cost', 'vs before', 'Share of cost'].map((l) => ({ label: l, cls: 'r' }))], rows: rows.map((r) => r.map((c, i) => (i ? `<span class="num">${c}</span>` : c))), empty: 'Nothing in this window.' }) });
}

function runList(title, l, f) { return panel({ title, h: 'h3', body: `<div class="rows">${l.map((x) => `<button type="button" class="row" data-act="trace" data-id="${x.id}"><span class="trunc">${esc(x.name)}</span><span class="muted small">${esc((proj(x.project) || {}).name || '')} · ${ago(x.start)}</span><span class="grow"></span><span class="num">${f(x)}</span></button>`).join('') || '<p class="muted">Nothing in this window.</p>'}</div>` }); }

function overviewBody(v, projectId) {
  const { cur, prev, w } = scoped(v, projectId);
  const metric = v.metric || 'requests';
  const n = w <= DAY ? 24 : w <= 7 * DAY ? 28 : 30;
  const f = { requests: () => 1, tokens: (x) => x.tokensIn + x.tokensOut, cache: (x) => x.cached, cost: (x) => x.cost, calls: (x) => x.calls, latency: (x) => x.latencyMs / 1000 }[metric];
  const ok = buckets(cur.filter((x) => x.status !== 'failed'), w, n, f), bad = buckets(cur.filter((x) => x.status === 'failed'), w, n, f);
  const labels = Array.from({ length: n }, (_, i) => { const at = now() - (n - 1 - i) * (w / n); return w <= DAY ? timeLabel(at) : dayLabel(at); });
  const issues = S.issues.filter((i) => !projectId || i.project === projectId);
  const fmt = metric === 'cost' ? money4 : metric === 'latency' ? (x) => `${x.toFixed(1)} s` : (x) => compact(x);
  return kpis(cur, prev, w)
    + panel({ title: 'Latency', desc: `p99 ${latency(p99(cur))} · longest ${latency(Math.max(0, ...cur.map((x) => x.latencyMs)))} · ${cur.filter((x) => x.status !== 'failed').length} succeeded · ${cur.filter((x) => x.status === 'failed').length} with failures. A red square can hold successes too; hover one for both counts.`, right: seg('lat', [['all', 'All'], ['errors', 'Errors only']], v.lat || 'all', { sm: true }), body: latencyGrid(cur, w, v.lat === 'errors') })
    + panel({ title: 'Activity', right: seg('metric', [['requests', 'Requests'], ['tokens', 'Tokens'], ['cache', 'Prompt cache'], ['cost', 'Cost'], ['calls', 'Model calls'], ['latency', 'Latency']], metric, { sm: true }), body: lineChart({ lines: [{ name: 'Succeeded', color: 'var(--c-accent)', values: ok }, { name: 'Failed', color: 'var(--c-red)', values: bad }], labels, fmt }) + `<div class="legend"><span><i class="lg-acc"></i>Succeeded</span><span><i class="lg-shadow"></i>Failed</span></div>` })
    + `<div class="grid-3">${panel({ title: 'Top issues', h: 'h3', body: `<div class="rows">${issues.map((i) => `<div class="row col"><span>${pill(i.kind, i.kind === 'LLM' ? 'blue' : i.kind === 'AGENT' ? 'amber' : 'grey')} <b>${esc(i.name)}</b></span><span class="muted small">${esc(i.error)} · in ${esc((proj(i.project) || {}).name)} · ${i.count}× · ${ago(i.lastSeen)}</span></div>`).join('') || '<p class="muted">No issues.</p>'}</div>` })}
      ${runList('Slowest runs', cur.slice().sort((a, b) => b.latencyMs - a.latencyMs).slice(0, 6), (x) => latency(x.latencyMs))}${runList('Costliest runs', cur.slice().sort((a, b) => b.cost - a.cost).slice(0, 6), (x) => money4(x.cost))}</div>`
    + breakdown(cur, prev, v.by || 'models');
}

function obsOverview({ v }) {
  const { cur } = scoped(v);
  const res = [['Projects', PROJECTS.length - 1, '#/observability/projects', 'projects'], ['Sessions', Math.round(cur.length / 11), null, 'chat'], ['Issues', sum(S.issues, (i) => i.count), null, 'issue'], ['Agents', new Set(cur.map((x) => x.agent).filter(Boolean)).size, null, 'agent'], ['Models', new Set(cur.map((x) => x.model)).size, null, 'model'], ['Providers', new Set(cur.map((x) => x.provider)).size, null, 'cloud'], ['Tools', new Set(cur.map((x) => x.tool).filter(Boolean)).size, null, 'tool'], ['MCP servers', 4, '#/llm-gateway/mcp-servers', 'mcp'], ['Teams', 0, null, 'users'], ['Users', new Set(cur.map((x) => x.user)).size, null, 'user'], ['Customers', 0, null, 'building'], ['Gateway keys', 6, '#/llm-gateway/virtual-keys', 'key']];
  const byProj = [...groupBy(cur, (x) => x.project)].map(([id, l]) => ({ p: proj(id), cost: sum(l, (x) => x.cost), runs: l.length })).sort((a, b) => b.cost - a.cost);
  const total = sum(byProj, (x) => x.cost) || 1;
  return pageHead({ title: 'Observability', desc: "Every agent's runs across your projects: what there is, whether it is healthy, what broke and what it cost.", right: select('win', WIN.map(([k, l]) => [k, l]), winOf(v)[0], { aria: 'Window' }) + btn('Ask Ctrl', { icon: 'ask', act: 'ctrl-open' }) })
    + `<div class="grid-2-1">${panel({ title: 'Resources', desc: `What your agents used across ${PROJECTS.length - 1} projects, ${winOf(v)[1].toLowerCase()}.`, body: `<div class="res-grid">${res.map(([l, n, h, ic]) => `<${h ? `a href="${h}"` : 'div'} class="res">${icon(ic, 15)}<span>${l}</span><b class="num">${int(n)}</b></${h ? 'a' : 'div'}>`).join('')}</div>` })}
      ${panel({ title: 'Cost by project', desc: `${money(sum(byProj, (x) => x.cost))} in all, ${winOf(v)[1].toLowerCase()}`, body: `<div class="rows">${byProj.map((x) => `<a class="row col" href="#/observability/p/${x.p.id}/overview"><span class="row-split"><b>${esc(x.p.name)}</b><span class="num">${money(x.cost)}</span></span><span class="bar-amber"><i style="width:${(x.cost / total) * 100}%"></i></span><span class="muted small">${int(x.runs)} runs</span></a>`).join('')}</div>` })}</div>`
    + overviewBody(v);
}

function projects({ v }) {
  const t = now();
  const rows = PROJECTS.map((p) => { const l = S.traces.filter((x) => x.project === p.id && t - x.start <= 7 * DAY); return { p, l, err: l.filter((x) => x.status === 'failed').length, cost: sum(l, (x) => x.cost) }; }).sort((a, b) => b.l.length - a.l.length);
  const total = sum(rows, (r) => r.cost) || 1;
  const f = v.f || 'all';
  const shown = rows.filter((r) => f === 'all' || (f === 'errors' ? r.err > 0 || (r.p.errRate > 0 && !r.l.length && r.p.last) : !r.l.length));
  return pageHead({ title: 'Projects', desc: `${PROJECTS.length} projects. Busiest first, last 7 days; those with no traces in it last.` })
    + chips('f', [['all', 'All', PROJECTS.length], ['errors', 'With errors', rows.filter((r) => r.err > 0 || (r.p.errRate > 0 && !r.l.length && r.p.last)).length], ['none', 'No traces', rows.filter((r) => !r.l.length).length]], f)
    + table({ cols: [{ label: 'Project' }, { label: 'Traces', cls: 'r' }, { label: 'Error rate', cls: 'r' }, { label: 'Model calls', cls: 'r' }, { label: 'Cost', cls: 'r' }, { label: 'Share of cost', w: '140px' }, { label: 'Last trace' }],
      rows: shown.map(({ p, l, err, cost }) => ({ attrs: `class="row-link" data-act="go" data-href="#/observability/p/${p.id}/overview"`, cells: [`<a class="lnk" href="#/observability/p/${p.id}/overview"><b>${esc(p.name)}</b></a><p class="muted small">${esc(p.agent || p.description)}</p>`, `<span class="num">${int(l.length)}</span>`, `<span class="num">${l.length ? pct(err / l.length) : '—'}</span>`, `<span class="num">${int(sum(l, (x) => x.calls))}</span>`, `<span class="num">${money(cost)}</span>`, `<span class="share"><i style="width:${(cost / total) * 100}%"></i><em>${pct(cost / total)}</em></span>`, l.length ? `<span class="muted">${ago(l[0].start)}</span>` : `<span class="muted">${p.last ? ago(p.last) : 'None in this window'}</span>`] })) });
}

function cost({ v }) {
  const { cur, prev, w } = scoped(v);
  const c = sum(cur, (x) => x.cost), pc = sum(prev, (x) => x.cost);
  const tin = sum(cur, (x) => x.tokensIn), cached = sum(cur, (x) => x.cached);
  const series = v.series || 'total';
  const n = w <= DAY ? 24 : w <= 7 * DAY ? 7 : 30;
  const labels = Array.from({ length: n }, (_, i) => { const at = now() - (n - 1 - i) * (w / n); return w <= DAY ? timeLabel(at) : dayLabel(at); });
  const keyF = { total: () => 'Total', projects: (x) => proj(x.project).name, models: (x) => x.model, providers: (x) => x.provider, agents: (x) => x.agent || 'No agent named' }[series];
  const groups = [...groupBy(cur, keyF)].sort((a, b) => sum(b[1], (x) => x.cost) - sum(a[1], (x) => x.cost)).slice(0, 6);
  const colors = ['var(--c-accent)', 'var(--c-amber)', 'var(--c-green)', 'var(--c-violet)', 'var(--c-red)', 'var(--c-teal)'];
  return pageHead({ title: 'Cost', desc: 'What traced model calls cost, how fast it is growing, and how much caching saves.', right: select('win', WIN.map(([k, l]) => [k, l]), winOf(v)[0], { aria: 'Window' }) })
    + statCards([{ label: 'Cost', value: money(c), delta: delta(c, pc), deltaTone: 'bad', sub: `${money(pc)} the window before` }, { label: 'Monthly pace', value: money((c / w) * 30 * DAY) }, { label: 'Per run', value: money4(cur.length ? c / cur.length : 0) }, { label: "Failed calls' spend", value: money(sum(cur.filter((x) => x.status === 'failed'), (x) => x.cost)) }], 4)
    + statCards([{ label: 'Model calls', value: compact(sum(cur, (x) => x.calls)) }, { label: 'Input tokens', value: tokens(tin) }, { label: 'Cached input', value: tokens(cached), sub: `${pct(tin ? cached / tin : 0)} of input read from the cache` }, { label: 'Output tokens', value: tokens(sum(cur, (x) => x.tokensOut)) }], 4)
    + `<div class="banner banner-amber">${icon('info', 15)}<span>2 models have no price set (text-embedding-3-large, gemini-2.5-flash), so their calls are counted at $0. Set prices in the gateway's Pricing Overrides.</span></div>`
    + panel({ title: 'Spend over time', right: seg('series', [['total', 'Total'], ['projects', 'Projects'], ['models', 'Models'], ['providers', 'Providers'], ['agents', 'Agents']], series, { sm: true }), body: stackedBars({ series: groups.map(([k, l], i) => ({ name: k, color: colors[i], values: buckets(l, w, n, (x) => x.cost) })), labels, height: 200, fmt: (x) => money(x) }) + `<div class="legend">${groups.map(([k], i) => `<span><i style="background:${colors[i]}"></i>${esc(k)}</span>`).join('')}</div>` })
    + runList('Costliest runs', cur.slice().sort((a, b) => b.cost - a.cost).slice(0, 8), (x) => money4(x.cost))
    + breakdown(cur, prev, v.by || 'projects', ['projects', 'models', 'providers', 'agents', 'tools', 'users', 'keys']);
}

// ---- one project ----
function projectPage(ctx) {
  const [id, tab] = ctx.params;
  const p = proj(id);
  if (!p) return empty('No such project', 'It may have been removed.', btn('Projects', { href: '#/observability/projects' }));
  const v = ctx.v;
  const head = `<a class="crumb-back" href="#/observability/projects">${icon('back', 14)}Projects</a>` + pageHead({ title: p.name, desc: p.description, right: select('win', WIN.map(([k, l]) => [k, l]), winOf(v)[0], { aria: 'Window' }) });
  const tabsHtml = `<div class="tabs" role="tablist">${[['overview', 'Overview'], ['traces', 'Traces'], ['spans', 'Spans'], ['sessions', 'Sessions'], ['issues', 'Issues'], ['cost', 'Cost'], ['settings', 'Settings']].map(([k, l]) => `<a role="tab" class="${tab === k ? 'on' : ''}" aria-selected="${tab === k}" href="#/observability/p/${id}/${k}">${l}</a>`).join('')}</div>`;
  const { cur, prev } = scoped(v, id);
  let body = '';
  if (tab === 'overview') body = (cur.length ? overviewBody(v, id) : empty('No traces in this window', 'Send traces with the x-project header set to this project, or widen the window.'))
    + panel({ title: 'Project details', body: kv([['Project id', `<code>${p.id}</code>`], ['Agent', p.agent ? `<a class="lnk" href="#/inventory?tab=list&q=${encodeURIComponent(p.agent.slice(0, 12))}">${esc(p.agent)}</a>` : null], ['Team', p.team ? esc(p.team) : null], ['Sent with', `<code>x-project: ${esc(p.name)}</code>`], ['Made', p.madeBy ? `${esc(p.madeBy)}, ${ago(p.madeAt)}` : ago(p.madeAt)]]) + `<a class="lnk" href="#/observability/p/${id}/settings">Setup: send traces to it</a>` });
  if (tab === 'traces') {
    const st = v.status || 'all';
    const q = (v.q || '').toLowerCase();
    const l = cur.filter((x) => (st === 'all' || (st === 'failed' ? x.status === 'failed' : x.status !== 'failed')) && (!q || x.name.includes(q) || (x.input || '').toLowerCase().includes(q)));
    const page = v.page || 0;
    body = `<div class="toolbar wrap">${search('q', v.q, 'Search traces')}${select('status', [['all', 'Any status'], ['ok', 'Succeeded'], ['failed', 'Failed']], st, { aria: 'Status' })}${toggle('live', v.live, { label: 'Live' })}${btn('Default view', { sm: true, caret: true, act: 'noop' })}${btn('Add filter', { sm: true, icon: 'plus', act: 'noop' })}</div>`
      + kpis(cur, prev, winOf(v)[2])
      + table({ cols: ['Status', 'Kind', 'Name', 'Input', 'Output', 'Agent', 'Start time', 'Latency', 'Tokens', 'Cost'].map((x, i) => ({ label: x, cls: i >= 7 ? 'r' : '' })), empty: 'No traces match.',
        rows: l.slice(page * 50, page * 50 + 50).map((x) => ({ attrs: `class="row-link" data-act="trace" data-id="${x.id}"`, cells: [x.status === 'failed' ? pill('Failed', 'red') : pill('OK', 'green'), `<code>${x.kind}</code>`, esc(x.name), `<span class="trunc muted">${S && ctx.store.prefs.role === 'Viewer' ? 'hidden for your role' : esc(x.input)}</span>`, `<span class="muted">${ctx.store.prefs.role === 'Viewer' ? 'hidden for your role' : x.status === 'failed' ? esc(x.error) : 'Matched 4 of 4 lines'}</span>`, esc(x.agent ? x.agent.slice(0, 22) + '…' : '—'), `<span class="muted">${ago(x.start)}</span>`, `<span class="num">${latency(x.latencyMs)}</span>`, `<span class="num">${tokens(x.tokensIn + x.tokensOut)}</span>`, `<span class="num">${money4(x.cost)}</span>`] })) })
      + (l.length > 50 ? `<div class="pager"><span>${page * 50 + 1}–${Math.min(l.length, page * 50 + 50)} of ${int(l.length)}</span>${btn('Previous', { sm: true, act: 'set', data: { key: 'page', val: page - 1 }, disabled: !page })}${btn('Next', { sm: true, act: 'set', data: { key: 'page', val: page + 1 }, disabled: (page + 1) * 50 >= l.length })}</div>` : '');
  }
  if (tab === 'spans') {
    const spans = cur.slice(0, 40).flatMap((x) => [['agent.run', 'AGENT', x.latencyMs], [`chat ${x.model}`, 'LLM', Math.round(x.latencyMs * 0.6)], ...(x.tool ? [[x.tool, 'SPAN', Math.round(x.latencyMs * 0.2)]] : [])].map(([n, k, l]) => ({ n, k, l, x })));
    body = table({ cols: [{ label: 'Kind' }, { label: 'Span' }, { label: 'Trace' }, { label: 'Start' }, { label: 'Latency', cls: 'r' }], rows: spans.slice(0, 80).map((s) => [`<code>${s.k}</code>`, esc(s.n), `<button type="button" class="lnk" data-act="trace" data-id="${s.x.id}">${s.x.id.slice(0, 12)}</button>`, `<span class="muted">${ago(s.x.start)}</span>`, `<span class="num">${latency(s.l)}</span>`]), empty: 'No spans in this window.' });
  }
  if (tab === 'sessions') {
    const ses = [...groupBy(cur, (x) => `${x.user}|${dayLabel(x.start)}`)].slice(0, 40);
    body = table({ cols: [{ label: 'Session' }, { label: 'User' }, { label: 'Traces', cls: 'r' }, { label: 'Cost', cls: 'r' }, { label: 'Last' }], rows: ses.map(([k, l]) => [`<code>ses_${k.length.toString(16)}${l[0].id.slice(3, 9)}</code>`, esc(l[0].user), `<span class="num">${l.length}</span>`, `<span class="num">${money4(sum(l, (x) => x.cost))}</span>`, `<span class="muted">${ago(l[0].start)}</span>`]), empty: 'No sessions in this window.' });
  }
  if (tab === 'issues') body = table({ cols: [{ label: 'Kind' }, { label: 'Name' }, { label: 'Error' }, { label: 'Count', cls: 'r' }, { label: 'Last seen' }], rows: S.issues.filter((i) => i.project === id).map((i) => [pill(i.kind, 'grey'), esc(i.name), `<span class="t-red">${esc(i.error)}</span>`, `<span class="num">${i.count}</span>`, `<span class="muted">${ago(i.lastSeen)}</span>`]), empty: 'No issues.' });
  if (tab === 'cost') { const c = sum(cur, (x) => x.cost); body = statCards([{ label: 'Cost', value: money(c), delta: delta(c, sum(prev, (x) => x.cost)) }, { label: 'Per run', value: money4(cur.length ? c / cur.length : 0) }, { label: 'Cached input', value: tokens(sum(cur, (x) => x.cached)) }, { label: 'Runs', value: int(cur.length) }], 4) + breakdown(cur, prev, v.by || 'models', ['models', 'providers', 'tools', 'users']); }
  if (tab === 'settings') body = `<form data-form="proj">` + panel({ title: 'General', body: `<div class="form-grid">${field('Name', input('name', { value: p.name }))}${field('Description', input('description', { value: p.description }))}${field('Project id', `<code>${p.id}</code>`)}${field('Made', esc(p.madeBy ? `${p.madeBy}, ${ago(p.madeAt)}` : ago(p.madeAt)))}</div>` })
    + panel({ title: 'Ownership', body: `<div class="form-grid">${field('Agent', selectField('agent', [['', 'None'], ...S.assets.filter((a) => a.kind === 'agent').slice(0, 40).map((a) => [a.name, a.name])], p.agent || ''))}${field('Team', selectField('team', [['', 'None'], 'Platform', 'Sales Engineering', 'Customer Support', 'Finance Ops', 'People Ops'], p.team || ''))}</div>` })
    + panel({ title: 'Sending traces', desc: 'Send OpenTelemetry traces with this header and they land in this project.', body: `<pre class="code">x-project: ${esc(p.name)}\n\n# OpenTelemetry exporter\nOTEL_EXPORTER_OTLP_ENDPOINT=https://${esc(location.host || 'opencontroller.example')}/v1/otlp\nOTEL_EXPORTER_OTLP_HEADERS="authorization=Bearer $OPENCONTROLLER_API_KEY,x-project=${esc(p.name)}"</pre>` }) + `<div class="btn-row">${btn('Save', { submit: true, kind: 'primary', perm: 'integrations' })}</div></form>`;
  return head + tabsHtml + body;
}

function traceSheet(id, prefs) {
  const x = S.traces.find((t) => t.id === id); if (!x) return;
  const hidden = prefs.role === 'Viewer';
  const parts = [['agent.run', 0, 1, 'agent'], [`chat ${x.model}`, 0.05, 0.6, 'llm'], ...(x.tool ? [[x.tool, 0.66, 0.22, 'tool']] : []), [`chat ${x.model}`, 0.9, 0.09, 'llm']];
  sheet({ title: x.name, sub: `Trace · ${(proj(x.project) || {}).name} · ${ago(x.start)}`, wide: true,
    body: kv([['Status', x.status === 'failed' ? pill('Failed', 'red') : pill('OK', 'green')], ['Agent', esc(x.agent || '—')], ['Model', `<code>${esc(x.model)}</code> · ${esc(x.provider)}`], ['Latency', latency(x.latencyMs)], ['Tokens', `${tokens(x.tokensIn)} in · ${tokens(x.cached)} cached · ${tokens(x.tokensOut)} out`], ['Cost', money4(x.cost)], ['Through the gateway', x.gateway ? 'Yes' : 'No'], x.error && ['Error', `<span class="t-red">${esc(x.error)}</span>`]])
      + `<h4 class="sub-h">Spans</h4><div class="waterfall">${parts.map(([n, s, d, k]) => `<div class="wf-row"><span class="trunc">${esc(n)}</span><span class="wf-track"><i class="wf-${k}" style="left:${s * 100}%;width:${Math.max(1, d * 100)}%"></i></span><span class="num muted">${latency(x.latencyMs * d)}</span></div>`).join('')}</div>`
      + `<h4 class="sub-h">Input</h4>${hidden ? '<p class="muted">Hidden for your role: it may quote what the agent was asked.</p>' : `<pre class="code">${esc(x.input)}</pre>`}<h4 class="sub-h">Output</h4>${hidden ? '<p class="muted">Hidden for your role.</p>' : `<pre class="code">${esc(x.status === 'failed' ? x.error : 'Matched 4 of 4 invoice lines to PO 77812. Vendor: Nordic Supplies AB. Total: €12,480.00.')}</pre>`}` });
}

// ---------------- evals ----------------
function evalsOverview({ v }) {
  const steps = [['Connect a model to grade with', true, '#/evals/connections'], ['Make a test set', true, '#/evals/datasets'], [`Make a grader (${EVALUATORS.length})`, true, '#/evals/evaluators'], ['Check the grader agrees with you', false, '#/evals/scores'], ['Test a new version', true, '#/evals/datasets'], [`Connect your agents' traces (${PROJECTS.length - 1})`, true, '#/evals/connections'], ['Watch production with a monitor', false, '#/evals/monitors']];
  const w = { '24h': DAY, '7d': 7 * DAY, '30d': 30 * DAY }[v.win || '7d'];
  const sc = S.scores.filter((s) => now() - s.at <= w);
  const byEv = [...groupBy(sc, (s) => s.evaluator)];
  return pageHead({ title: 'Evals', desc: "Judge your agents' traces with graders, test sets and monitors, so a regression shows before your users notice.", right: seg('win', [['24h', 'Last 24 hours'], ['7d', 'Last 7 days'], ['30d', 'Last 30 days']], v.win || '7d', { sm: true }) + btn('Ask Ctrl', { icon: 'ask', act: 'ctrl-open' }) })
    + panel({ title: 'Get started', desc: `${steps.filter((s) => s[1]).length} of ${steps.length} done`, body: `<ol class="steps-list">${steps.map(([l, d, h]) => `<li class="${d ? 'done' : ''}"><a href="${h}"><span class="sl-ic">${d ? icon('check', 13) : ''}</span>${esc(l)}</a></li>`).join('')}</ol>` })
    + panel({ title: 'Resources', body: `<div class="res-grid">${[['Evaluators', EVALUATORS.length, '#/evals/evaluators'], ['Templates', 12, null], ['Tasks', EVAL_TASKS.length, '#/evals/tasks'], ['Running', 0, '#/evals/tasks'], ['Monitors', 0, '#/evals/monitors'], ['Datasets', DATASETS.length, '#/evals/datasets'], ['Results', sc.length, '#/evals/scores'], ['Errors', 0, null], ['Trace stores', 1, '#/evals/connections'], ['Models', 1, '#/evals/connections']].map(([l, n, h]) => `<${h ? `a href="${h}"` : 'div'} class="res"><span>${l}</span><b class="num">${n}</b></${h ? 'a' : 'div'}>`).join('')}</div>` })
    + `<div class="grid-2">${panel({ title: 'Quality by evaluator', body: byEv.length ? `<div class="rows">${byEv.map(([e, l]) => { const good = l.filter((s) => s.value === 1).length; return `<div class="row col"><span class="row-split"><b>${esc(e)}</b><span class="num">${pct(good / l.length)}</span></span><span class="bar-green"><i style="width:${(good / l.length) * 100}%"></i></span><span class="muted small">${l.length} judged</span></div>`; }).join('')}</div>` : '<p class="muted">Nothing judged in this window.</p>' })}
      ${panel({ title: 'Latest verdicts', body: `<div class="rows">${sc.slice(0, 8).map((s) => `<a class="row" href="#/evals/scores"><b>${esc(s.evaluator)}</b>${pill(s.label, s.value ? 'green' : 'red')}<span class="muted">· ${s.value}</span><span class="grow"></span><span class="muted small">${ago(s.at)}</span></a>`).join('') || '<p class="muted">Nothing judged in this window.</p>'}</div>` })}</div>`
    + statCards([{ label: 'Results', value: int(sc.length) }, { label: 'Quality', value: sc.length ? pct(sc.filter((s) => s.value).length / sc.length) : '—' }, { label: 'Error rate', value: '0%' }, { label: 'Judge tokens', value: tokens(sum(EVALUATORS, (e) => e.tokens7d)) }], 4);
}
const evalsPages = {
  evaluators: () => pageHead({ title: 'Evaluators', desc: 'Graders that read one step of a trace and answer with a label.', actions: btn('New evaluator', { icon: 'plus', act: 'noop-admin', perm: 'integrations' }) }) + table({ cols: ['Evaluator', 'Judge', 'Reads', 'Answers', 'Model', 'Scores, 7 days', 'Tokens, 7 days', 'Changed'].map((l, i) => ({ label: l, cls: i === 5 || i === 6 ? 'r' : '' })), rows: EVALUATORS.map((e) => [`<b>${esc(e.name)}</b>`, esc(e.judge), esc(e.reads), `${pill(e.labels[0], 'green')} ${pill(e.labels[1], 'red')}`, `<span class="muted small">${esc(e.model)}</span>`, `<span class="num">${e.scores7d}</span>`, `<span class="num">${tokens(e.tokens7d)}</span>`, `<span class="muted">${ago(e.changed)}</span>`]) }),
  tasks: () => pageHead({ title: 'Tasks', desc: 'An evaluator run over traces: continuously on new ones, or once over a backfill.' }) + table({ cols: ['Task', 'Evaluator', 'Runs', 'Status', 'Read', 'Judged', 'Errors', 'Judge tokens'].map((l, i) => ({ label: l, cls: i >= 4 ? 'r' : '' })), rows: EVAL_TASKS.map((t) => ({ attrs: `class="row-link" data-act="go" data-href="#/evals/tasks/${t.id}"`, cells: [`<a class="lnk" href="#/evals/tasks/${t.id}"><b>${esc(t.name)}</b></a>`, esc(t.evaluator), `${t.mode} · ${t.sample}%`, pill(t.status, { Done: 'green', Stopped: 'grey', Failed: 'red', Running: 'blue' }[t.status]), `<span class="num">${t.read}</span>`, `<span class="num">${t.judged}</span>`, `<span class="num">${t.errors}</span>`, `<span class="num">${tokens(t.judgeTokens)}</span>`] })) }),
  scores: ({ v }) => { const ev = v.ev || 'all'; const lab = v.lab || 'all'; const l = S.scores.filter((s) => (ev === 'all' || s.evaluator === ev) && (lab === 'all' || (lab === 'good' ? s.value === 1 : s.value === 0))); return pageHead({ title: 'Scores', desc: 'Every verdict the evaluators gave.' }) + `<div class="toolbar">${select('ev', [['all', 'Every evaluator'], ...EVALUATORS.map((e) => [e.name, e.name])], ev, { aria: 'Evaluator' })}${select('lab', [['all', 'Any score'], ['good', 'Passing'], ['bad', 'Failing']], lab, { aria: 'Score' })}<span class="muted">${l.length} scores</span></div>` + table({ cols: [{ label: 'Judged' }, { label: 'Evaluator' }, { label: 'Score' }, { label: 'Explanation' }, { label: 'Of' }], rows: l.map((s) => [`<span class="muted">${ago(s.at)}</span>`, esc(s.evaluator), `${pill(s.label, s.value ? 'green' : 'red')} <span class="muted">· ${s.value}</span>`, '<span class="muted">hidden: it may quote what the agent was asked or answered</span>', s.of]) }); },
  monitors: () => pageHead({ title: 'Monitors', desc: 'An evaluator watching production traffic, with an alert when quality drops.' }) + `<div class="hero-empty">${icon('pulse', 28)}<h2>Catch a regression before your users do</h2><p class="muted">A monitor samples new traces, grades them, and alerts a channel when the pass rate drops below what you set.</p>${btn('New monitor', { icon: 'plus', kind: 'primary', act: 'new-monitor', perm: 'integrations' })}</div>`,
  datasets: () => pageHead({ title: 'Datasets', desc: 'Test sets: inputs with the answers you expect, to try a new prompt or model on before it ships.' }) + table({ cols: [{ label: 'Dataset' }, { label: 'Rows', cls: 'r' }, { label: 'Latest experiment' }, { label: 'Changed' }], rows: DATASETS.map((d) => [`<b>${esc(d.name)}</b>`, `<span class="num">${d.rows}</span>`, d.latest ? `${esc(d.latest.what)} · ${dayLabel(d.latest.at)}, ${timeLabel(d.latest.at)} · ${d.latest.status === 'failed' ? pill('failed', 'red') : pill('done', 'green')}` : '<span class="muted">None yet</span>', `<span class="muted">${ago(d.changed)}</span>`]) }),
  prompts: () => pageHead({ title: 'Prompts', desc: 'Versioned prompts, with the model each runs on.' }) + table({ cols: [{ label: 'Prompt' }, { label: 'Latest version' }, { label: 'Model' }, { label: 'Changed' }], rows: PROMPTS.map((p) => [`<b>${esc(p.name)}</b>`, esc(p.version), `<code>${esc(p.model)}</code>`, `<span class="muted">${ago(p.changed)}</span>`]) }),
  connections: () => pageHead({ title: 'Connections', desc: 'Where evals read traces from, and the models that grade them.' }) + table({ cols: [{ label: 'Name' }, { label: 'Type' }, { label: 'Address' }, { label: '', cls: 'r' }], rows: EVAL_CONNECTIONS.map((c) => [`<b>${esc(c.name)}</b>`, esc(c.type), `<code>${esc(c.address)}</code>`, btn('Check', { sm: true, act: 'check-conn', data: { n: c.name } })]) }),
};
function taskPage(ctx) {
  const t = EVAL_TASKS.find((x) => x.id === ctx.params[0]);
  if (!t) return empty('No such task', '', btn('Tasks', { href: '#/evals/tasks' }));
  const sc = S.scores.filter((s) => s.evaluator === t.evaluator).slice(0, t.judged || 0);
  return `<a class="crumb-back" href="#/evals/tasks">${icon('back', 14)}Tasks</a>` + pageHead({ title: t.name, desc: `${t.evaluator} · ${t.mode} · ${t.sample}% of traces` }) + statCards([{ label: 'Status', value: pill(t.status, { Done: 'green', Stopped: 'grey', Failed: 'red' }[t.status] || 'blue') }, { label: 'Read', value: int(t.read) }, { label: 'Judged', value: int(t.judged) }, { label: 'Errors', value: int(t.errors) }], 4)
    + (t.status === 'Failed' ? `<div class="banner banner-red">${icon('alert', 15)}<span>The judge model answered 401: the openai-judge key was rotated. Update it in Connections.</span></div>` : '')
    + table({ cols: [{ label: 'Judged' }, { label: 'Score' }, { label: 'Of' }], rows: sc.map((s) => [`<span class="muted">${ago(s.at)}</span>`, pill(s.label, s.value ? 'green' : 'red'), s.of]), empty: 'Nothing judged yet.' });
}

export const ROUTES = [
  { path: '/observability', render: obsOverview, init: () => ({ win: '7d', by: 'models', metric: 'requests', lat: 'all' }), actions: { trace: (el, ctx) => traceSheet(el.dataset.id, ctx.store.prefs) } },
  { path: '/observability/projects', render: projects, init: () => ({ f: 'all' }), actions: { go: (el) => { location.hash = el.dataset.href; } } },
  { path: '/observability/cost', render: cost, init: () => ({ win: '7d', series: 'total', by: 'projects' }), actions: { trace: (el, ctx) => traceSheet(el.dataset.id, ctx.store.prefs) } },
  { path: /^\/observability\/p\/(prj_[0-9a-z]+)\/(overview|traces|spans|sessions|issues|cost|settings)$/, render: projectPage, init: () => ({ win: '7d', by: 'models', status: 'all' }), actions: {
    trace: (el, ctx) => traceSheet(el.dataset.id, ctx.store.prefs),
    noop: () => toast('Saved views and extra filters are in the full product.'),
    'form:proj': () => { toast('Saved.'); },
  } },
  { path: '/evals', render: evalsOverview, init: () => ({ win: '7d' }) },
  { path: /^\/evals\/tasks\/(task_[0-9a-f]+)$/, render: taskPage },
  ...Object.entries(evalsPages).map(([k, render]) => ({ path: `/evals/${k}`, render, actions: { go: (el) => { location.hash = el.dataset.href; }, 'check-conn': (el) => toast(`${el.dataset.n}: reachable, answered in ${el.dataset.n.includes('click') ? '84' : '312'} ms.`), 'noop-admin': () => toast('Evaluators are made from templates in the full product.'), 'new-monitor': () => modal({ title: 'New monitor', body: `${field('Evaluator', selectField('ev', EVALUATORS.map((e) => e.name), 'correctness'))}${field('Project', selectField('p', PROJECTS.map((p) => p.name), 'nordic-capital'))}${field('Alert below pass rate (%)', input('min', { type: 'number', value: '85' }))}`, submit: 'Start watching', onSubmit: () => { toast('In the demo, monitors are not saved. In the product it starts grading new traces now.'); } }) } })),
  { path: '/fine-tuning', render: () => pageHead({ title: 'Fine-tuning', desc: 'Train smaller models on the traces you judged good.' }) + `<div class="console-ph"><div>${icon('finetune', 28)}<h3>The fine-tuning studio has not answered</h3><p class="muted">It may not support being shown inside opencontroller yet, or the address in Settings may be wrong.</p>${btn('Open on its own', { icon: 'external', act: 'ft' })}</div></div>`, actions: { ft: () => toast('The studio is not connected in the demo.') } },
];
