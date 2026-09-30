// Demo-mode PhantomBuster data: two made-up phantoms shaped like the GSI LinkedIn automation of
// Jul to Sep 2026 (the Agentic Roadmap phantom ramped 39 -> 139 -> 304 -> 549 invites a week and
// then hit the plan ceiling). Deterministic (seeded) so the demo is stable. Nothing here is real.
//
//   phantomMock                      { agents, runs, daily, last_sync }
//   phantomGet(params)               same shape as GET /api/ca/phantom, runs filtered by from/to
//   phantomSyncPost(body)            two-step fake cursor, same shape as POST /api/ca/phantom/sync
import { rollupDaily } from '../lib/phantom-agg.mjs';

const AGENTS = [
  { id: 'pb-demo-1', name: 'Agentic Roadmap Phantom (Ani)', script: 'LinkedIn Outreach.js', start: '2026-07-06', weekly: [39, 139, 304, 549, 550, 548, 552, 546, 551, 549, 553, 547], acceptP: 0.19, msgP: 0.6, replyP: 0.12 },
  { id: 'pb-demo-2', name: 'GSI partner page invites (Jessica)', script: 'LinkedIn Auto Connect.js', start: '2026-08-03', weekly: [0, 0, 0, 0, 60, 120, 180, 220, 240, 235, 245, 238], acceptP: 0.14, msgP: 0, replyP: 0 },
];
const TODAY = '2026-09-30';

function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const addDays = (iso, k) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + k); return d.toISOString().slice(0, 10); };
const round = v => Math.max(0, Math.round(v));

function build() {
  const r = rng(20260930);
  const daily = [];
  const first = '2026-07-06';                               // a Monday, 12 weeks up to 2026-09-27, then 3 more days
  for (const a of AGENTS) {
    for (let w = 0; w < 12; w++) {
      const weekInvites = a.weekly[w] || 0;
      if (!weekInvites) continue;
      // five working days, uneven split, a little noise
      const parts = [0.16, 0.22, 0.24, 0.2, 0.18].map(p => p * (0.85 + r() * 0.3));
      const tot = parts.reduce((x, y) => x + y, 0);
      for (let dow = 0; dow < 5; dow++) {
        const day = addDays(first, w * 7 + dow);
        if (day > TODAY) break;
        const invites = round(weekInvites * parts[dow] / tot);
        const profiles = a.script.includes('Outreach') ? round(invites * (2.6 + r() * 0.5)) : invites;
        const accepted = round(invites * a.acceptP * (0.7 + r() * 0.6));
        const messages = round(accepted * a.msgP);
        const replies = round(messages * a.replyP);
        daily.push({ agent_id: a.id, day, profiles, invites_sent: invites, accepted, messages_sent: messages, replies });
      }
    }
    // the week in progress (Mon 28 Sep to Wed 30 Sep)
    for (let dow = 0; dow < 3; dow++) {
      const day = addDays(first, 12 * 7 + dow);
      const invites = round((a.weekly[11] || 0) / 5 * (0.9 + r() * 0.2));
      if (!invites) continue;
      const accepted = round(invites * a.acceptP * 0.5);
      daily.push({ agent_id: a.id, day, profiles: a.script.includes('Outreach') ? round(invites * 2.8) : invites, invites_sent: invites, accepted, messages_sent: round(accepted * a.msgP), replies: 0 });
    }
  }
  daily.sort((x, y) => x.day < y.day ? -1 : x.day > y.day ? 1 : x.agent_id < y.agent_id ? -1 : 1);

  // runs: one launch per phantom per day for the last ten launch days, with the counts of that day
  const runs = [];
  const lastDays = [...new Set(daily.map(d => d.day))].slice(-10);
  let k = 0;
  for (const d of daily) {
    if (!lastDays.includes(d.day)) continue;
    k++;
    const launched = new Date(d.day + 'T04:30:00Z');       // 10:00 IST
    const mins = 20 + Math.floor(r() * 40);
    runs.push({ id: 'run-demo-' + String(k).padStart(2, '0'), agent_id: d.agent_id, launched_at: launched.toISOString(), ended_at: new Date(launched.getTime() + mins * 60000).toISOString(), status: 'finished', profiles: d.profiles, invites_sent: d.invites_sent, accepted: d.accepted, messages_sent: d.messages_sent, replies: d.replies, synced_at: '2026-09-30T01:35:00.000Z' });
  }
  runs.sort((a, b) => a.launched_at < b.launched_at ? 1 : -1);

  const agents = AGENTS.map(a => ({ id: a.id, name: a.name, script: a.script, last_run_at: runs.find(x => x.agent_id === a.id)?.ended_at || null, status: 'finished', synced_at: '2026-09-30T01:35:00.000Z' }));
  const last_sync = { id: 'sync-demo', started_by: 'cron@campaign-analytics', started_at: '2026-09-30T01:30:00.000Z', finished_at: '2026-09-30T01:35:00.000Z', status: 'done', agents: agents.length, runs: runs.length };
  return { agents, runs, daily, last_sync };
}

export const phantomMock = build();

/** GET /api/ca/phantom?from&to */
export function phantomGet(params = {}) {
  const { from = '0000', to = '9999' } = params;
  const dayOf = ts => new Date(new Date(ts).getTime() + 330 * 60000).toISOString().slice(0, 10);
  return {
    agents: phantomMock.agents.map(a => ({ ...a })),
    runs: phantomMock.runs.filter(x => { const d = dayOf(x.launched_at); return d >= from && d <= to; }).map(x => ({ ...x })),
    daily: phantomMock.daily.map(x => ({ ...x })),
    last_sync: { ...phantomMock.last_sync },
    configured: true,
    from, to,
  };
}

/** POST /api/ca/phantom/sync { cursor? }: two steps, like the real endpoint. */
export function phantomSyncPost(body = {}) {
  const total = phantomMock.agents.length;
  if (!body.cursor) return { done: false, cursor: { step: 1, queue: phantomMock.agents.map(a => a.id), index: 0 }, agents: total, runs: 0, warnings: [], progress: { phase: 'runs', done: 0, total } };
  const now = new Date().toISOString();
  phantomMock.last_sync = { ...phantomMock.last_sync, started_by: 'demo@lyzr.com', started_at: new Date(Date.now() - 3000).toISOString(), finished_at: now, status: 'done', agents: total, runs: phantomMock.runs.length };
  // keep the daily rows consistent with the runs, as the real sync does at the end
  const rolled = rollupDaily(phantomMock.runs);
  for (const d of rolled) { const i = phantomMock.daily.findIndex(x => x.agent_id === d.agent_id && x.day === d.day); if (i >= 0) phantomMock.daily[i] = d; else phantomMock.daily.push(d); }
  return { done: true, agents: total, runs: phantomMock.runs.length, warnings: [], progress: { phase: 'done', done: total, total } };
}
