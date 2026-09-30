// LinkedIn automation (PhantomBuster). One source: the daily pull of every phantom in the
// workspace and the result file of each outreach run (functions/api/ca/phantom/sync.js).
// Structure follows the PhantomBuster block of the weekly GSI reports: profiles processed,
// invites sent (% of profiles), accepted (% of invites), messages and replies, the week-on-week
// invite ramp, one line per phantom, the recent runs, and a Claude read-out.
import * as P from '../lib/phantom-agg.mjs';
import { mountTrend } from '../trend.mjs';

export const route = 'linkedin/phantom';
export const title = 'PhantomBuster';

const CACHE = { data: null, at: 0, key: '' };
let trend = null;
export function destroy() { if (trend) { trend.destroy(); trend = null; } }

async function load(ctx, from, to, force) {
  const key = from + ':' + to;
  if (CACHE.data && CACHE.key === key && !force && Date.now() - CACHE.at < 10 * 60e3) return CACHE.data;
  const data = await ctx.api.get('phantom', { from, to });
  CACHE.data = data; CACHE.at = Date.now(); CACHE.key = key;
  return data;
}

function wireSync(el, ctx, done) {
  const b = el.querySelector('#syncBtn'); if (!b) return;
  b.onclick = async () => {
    b.disabled = true; let cursor, res;
    try {
      for (let guard = 0; guard < 80; guard++) {
        res = await ctx.api.post('phantom/sync', cursor ? { cursor } : {});
        b.innerHTML = `<span class="spin"></span> ${res.progress ? `${res.progress.done} of ${res.progress.total} phantoms` : 'Syncing'}`;
        for (const w of res.warnings || []) ctx.toast(w);
        if (res.done) break; cursor = res.cursor;
      }
      ctx.toast(`PhantomBuster synced: ${res.agents} phantoms, ${res.runs} new runs.`);
      done();
    } catch (e) { ctx.toast('PhantomBuster sync failed: ' + (e.message || e), 'err'); b.disabled = false; b.textContent = 'Pull PhantomBuster now'; }
  };
}

export async function render(el, ctx) {
  destroy();
  const F = ctx.fmt, { esc, fmt, pct } = F;
  const { from, to } = ctx.state;
  const head = sub => `<div class="seghead">LinkedIn automation · PhantomBuster</div><h1>PhantomBuster</h1><p class="sub">${sub}</p>`;
  const intro = `<div class="intro"><b>What this page counts.</b> A phantom is one PhantomBuster automation running on a team member's LinkedIn account (the Agentic Roadmap phantom, the partner page invites). Every run leaves a result file with one row per profile it worked on; the daily pull reads those files and counts profiles processed, invites sent, invites accepted, messages sent and replies. Acceptances show up on later runs of the same phantom, so the acceptance rate for the last few days is always low at first. Time saved is not available from the API.</div>`;
  el.innerHTML = head(esc(F.rangeLabel(from, to))) + ctx.ui.spinner('Loading PhantomBuster data');
  let data;
  try { data = await load(ctx, from, to); } catch (e) { el.innerHTML = head('') + ctx.ui.empty('PhantomBuster data could not be loaded: ' + (e.message || e)); return; }
  const agents = data.agents || [], runs = data.runs || [], daily = data.daily || [];
  const sync = data.last_sync;
  const isEditor = !!ctx.demo || !!(ctx.settings && ctx.settings.editors && ctx.user && ctx.settings.editors.includes(String(ctx.user.email || '').toLowerCase()));

  if (data.configured === false) {
    el.innerHTML = head(esc(F.rangeLabel(from, to))) + intro + ctx.ui.section('Not connected', '', ctx.ui.empty('PhantomBuster is not connected yet. Add the workspace API key as the Pages secret PHANTOMBUSTER_API_KEY (Settings › API in PhantomBuster) and the 07:00 IST pull will start filling this page. The key is only ever used to read phantoms and their results.'));
    return;
  }
  if (!daily.length && !agents.length) {
    el.innerHTML = head(esc(F.rangeLabel(from, to))) + intro + `<div class="card" style="margin-top:14px"><b>No PhantomBuster data yet.</b> Phantoms and their runs are pulled automatically every morning at 07:00 IST.${isEditor ? ' Pull them now with the button.' : ''}${isEditor ? '<p style="margin-top:12px"><button class="btn primary" id="syncBtn">Pull PhantomBuster now</button></p>' : ''}</div>`;
    wireSync(el, ctx, () => { CACHE.data = null; render(el, ctx); });
    return;
  }

  // ---- numbers ---------------------------------------------------------------------------------
  const cmp = ctx.state.prev || null;
  const prevFrom = cmp ? cmp.from : '9999', prevTo = cmp ? cmp.to : '0000';
  const cur = P.inRange(daily, from, to), prev = P.inRange(daily, prevFrom, prevTo);
  const T = P.totals(cur), TP = P.totals(prev);
  const active = P.activeAgents(cur), activePrev = P.activeAgents(prev);
  const byAgent = P.byAgent(cur), byAgentPrev = P.byAgent(prev);
  const agentName = new Map(agents.map(a => [a.id, a.name]));
  const nameOf = id => agentName.get(id) || id;
  const dl = (a, b, invert) => { if (!cmp) return '<span class="muted">no comparison</span>'; if (!b || a == null) return '<span class="muted">nothing to compare</span>'; const g = (a - b) / b * 100; const good = invert ? g <= 0 : g >= 0; return `<span class="${good ? 'up' : 'down'}">${g > 0 ? '+' : ''}${fmt(g, 0)}%</span> vs ${esc(cmp.label)}`; };
  const statusPill = s => { const v = String(s || '').toLowerCase(); return ctx.ui.pill(s || 'never run', v === 'running' ? 'p-med' : v === 'finished' ? 'p-high' : /error|fail/.test(v) ? 'p-low' : 'p-na'); };
  const mins = (a, b) => a && b ? Math.round((new Date(b) - new Date(a)) / 60000) : null;

  // ---- page ------------------------------------------------------------------------------------
  let h = head(`${esc(F.rangeLabel(from, to))}. Counts come from each run's result file, by the day the run was launched (IST). ${cmp ? `Compared ${esc(F.vsLabel(cmp))}.` : 'No comparison selected.'}`);
  h += intro;
  h += `<div class="card" style="font-size:13px;margin:10px 0 6px;display:flex;gap:14px;flex-wrap:wrap;align-items:center">
    <span><b>PhantomBuster API:</b> ${fmt(agents.length)} phantom${agents.length === 1 ? '' : 's'} in the workspace, ${fmt(agents.filter(a => P.isOutreachScript(a.script) || P.isOutreachScript(a.name)).length)} outreach${sync ? `, synced ${esc(F.timeAgo(sync.finished_at || sync.started_at))}${sync.status === 'error' ? ' <span class="down">(last run failed)</span>' : sync.status === 'running' ? ' (running)' : ''}` : ', never synced'}.</span>
    <span style="margin-left:auto;display:flex;gap:6px">${isEditor ? '<button class="btn tiny" id="syncBtn">Pull PhantomBuster now</button>' : ''}<button class="btn tiny ghost" id="reloadBtn">Reload</button></span></div>
  <div class="toc"><span class="tl">On this page</span><a href="#pb-results">Results</a><a href="#pb-phantoms">Phantoms</a><a href="#pb-trend">Week on week</a><a href="#pb-runs">Runs</a><a href="#pb-ai">AI read-out</a></div>`;

  // 1. results
  h += ctx.ui.section('Results', `For ${esc(F.rangeLabel(from, to))}, every phantom. Invites as a share of profiles processed, acceptances as a share of invites, as in the weekly report.`, ctx.ui.tiles([
    { k: 'Profiles processed', v: fmt(T.profiles), d: dl(T.profiles, TP.profiles) },
    { k: 'Invites sent', v: fmt(T.invites_sent), d: `${pct(T.invite_rate, 0)} of profiles · ${dl(T.invites_sent, TP.invites_sent)}` },
    { k: 'Accepted', v: fmt(T.accepted), d: `${pct(T.acceptance_rate, 0)} of invites · ${dl(T.accepted, TP.accepted)}` },
    { k: 'Messages', v: fmt(T.messages_sent), d: dl(T.messages_sent, TP.messages_sent) },
    { k: 'Replies', v: fmt(T.replies), d: `${T.messages_sent ? pct(T.reply_rate, 0) + ' of messages · ' : ''}${dl(T.replies, TP.replies)}` },
    { k: 'Active phantoms', v: fmt(active.size), d: `of ${fmt(agents.length)} in the workspace · ${dl(active.size, activePrev.size)}` },
  ]), 'pb-results');

  // 2. per phantom
  const phantomRows = agents.map(a => ({ a, t: byAgent.get(a.id) || P.totals([]), p: byAgentPrev.get(a.id) || P.totals([]) }))
    .filter(x => active.has(x.a.id) || P.isOutreachScript(x.a.script) || P.isOutreachScript(x.a.name))
    .sort((x, y) => y.t.invites_sent - x.t.invites_sent || y.t.profiles - x.t.profiles || x.a.name.localeCompare(y.a.name));
  h += ctx.ui.section('Phantoms', 'One line per outreach phantom (Auto Connect, Outreach, Message Sender). Phantoms that only export or scrape are pulled but not counted here.', phantomRows.length ? ctx.ui.table({
    cols: [
      { h: 'Phantom', k: 'name', left: true, f: x => `<b>${esc(x.a.name)}</b><br><span class="muted" style="font-size:12px">${esc((x.a.script || '').replace(/\.js$/, ''))}</span>` },
      { h: 'Last run', k: 'last', f: x => `${statusPill(x.a.status)}<br><span class="muted" style="font-size:12px">${x.a.last_run_at ? esc(F.istDateTime(x.a.last_run_at)) : '–'}</span>` },
      { h: 'Profiles', k: 'profiles', f: x => fmt(x.t.profiles) },
      { h: 'Invites', k: 'invites', f: x => `${fmt(x.t.invites_sent)}${cmp ? `<br><span style="font-size:12px">${dl(x.t.invites_sent, x.p.invites_sent).replace(/ vs .*$/, '')}</span>` : ''}` },
      { h: '% of profiles', k: 'ir', f: x => pct(x.t.invite_rate, 0) },
      { h: 'Accepted', k: 'accepted', f: x => `${fmt(x.t.accepted)}${cmp ? `<br><span style="font-size:12px">${dl(x.t.accepted, x.p.accepted).replace(/ vs .*$/, '')}</span>` : ''}` },
      { h: '% of invites', k: 'ar', f: x => pct(x.t.acceptance_rate, 0) },
      { h: 'Messages', k: 'messages', f: x => fmt(x.t.messages_sent) },
      { h: 'Replies', k: 'replies', f: x => fmt(x.t.replies) },
    ],
    rows: phantomRows,
    total: { name: '<b>All phantoms</b>', last: '', profiles: fmt(T.profiles), invites: fmt(T.invites_sent), ir: pct(T.invite_rate, 0), accepted: fmt(T.accepted), ar: pct(T.acceptance_rate, 0), messages: fmt(T.messages_sent), replies: fmt(T.replies) },
  }) : ctx.ui.empty('No outreach phantom has run in this range.'), 'pb-phantoms');

  // 3. week on week ramp
  h += ctx.ui.section('Week on week', 'The invite ramp over the whole history, every phantom together: how many invites went out each week, how many were accepted, and the acceptance rate. The comparison line is the week before.', '<div id="trendBox"></div>', 'pb-trend');

  // 4. runs
  const runRows = runs.slice(0, 200);
  h += ctx.ui.section('Runs', `${fmt(runs.length)} run${runs.length === 1 ? '' : 's'} launched in ${esc(F.rangeLabel(from, to))}${runs.length > 200 ? ', newest 200 shown' : ''}. One row per launch; the counts are what that run's result file says.`, runRows.length ? ctx.ui.table({
    cols: [
      { h: 'Launched (IST)', k: 'launched_at', left: true, f: r => esc(F.istDateTime(r.launched_at)) },
      { h: 'Phantom', k: 'agent_id', left: true, f: r => esc(nameOf(r.agent_id)) },
      { h: 'Status', k: 'status', f: r => statusPill(r.status) },
      { h: 'Minutes', k: 'mins', f: r => { const m = mins(r.launched_at, r.ended_at); return m == null ? '–' : fmt(m); } },
      { h: 'Profiles', k: 'profiles', f: r => fmt(r.profiles) },
      { h: 'Invites', k: 'invites_sent', f: r => fmt(r.invites_sent) },
      { h: 'Accepted', k: 'accepted', f: r => fmt(r.accepted) },
      { h: 'Messages', k: 'messages_sent', f: r => fmt(r.messages_sent) },
      { h: 'Replies', k: 'replies', f: r => fmt(r.replies) },
    ],
    rows: runRows,
  }) : ctx.ui.empty('No run was launched in this range.'), 'pb-runs');

  // 5. AI read-out
  h += ctx.ui.section('AI read-out', '', '<div id="insBox"></div>', 'pb-ai');
  el.innerHTML = h;

  // ---- wiring ----------------------------------------------------------------------------------
  wireSync(el, ctx, () => { CACHE.data = null; render(el, ctx); });
  el.querySelector('#reloadBtn').onclick = () => { CACHE.data = null; render(el, ctx); };
  trend = mountTrend(el.querySelector('#trendBox'), ctx, { id: 'phantom', items: daily, dayOf: r => r.day, metrics: P.TREND_METRICS, defaults: { gran: 'week', metrics: ['invites_sent', 'accepted', 'acceptRate'], compare: 'prev' }, range: { from, to },
    note: 'Invites and acceptances are counted on the day the run was launched, so acceptances that arrive later are seen on later runs. A week in progress is projected in a straight line.' });

  const weekly = () => { const m = new Map(); for (const r of daily) { const k = F.weekKey(r.day); if (!m.has(k)) m.set(k, []); m.get(k).push(r); } return [...m].sort().slice(-10).map(([week, rows]) => { const t = P.totals(rows); return { week, profiles: t.profiles, invites: t.invites_sent, accepted: t.accepted, acceptance_rate: t.acceptance_rate == null ? null : Math.round(t.acceptance_rate) }; }); };
  const inputProvider = async () => ({
    channel: 'phantombuster',
    range: { from, to, label: F.rangeLabel(from, to) },
    comparison: cmp ? { label: cmp.label, from: cmp.from, to: cmp.to, totals: TP } : null,
    totals: T,
    active_phantoms: active.size,
    phantoms: phantomRows.map(x => ({ name: x.a.name, script: x.a.script, status: x.a.status, last_run_at: x.a.last_run_at, ...x.t })),
    weekly: weekly(),
    runs_in_range: runs.length,
    last_sync: sync ? { status: sync.status, finished_at: sync.finished_at } : null,
    note: 'Counts are derived from each run result file: rows = profiles, rows with an invite flag or status = invites, invited rows now 1st degree = accepted. Acceptances arrive on later runs.',
  });
  ctx.mountInsights(el.querySelector('#insBox'), ctx, { scope: `phantom:${from}:${to}`, kind: 'overview', channel: 'overview', title: 'What the automation says', inputProvider });
}
