// Pure helpers for the PhantomBuster (LinkedIn automation) view. No DOM, no fetch: runs under
// node --test (tests/frontend/phantom-agg.test.mjs). The same counting rules live in
// functions/api/ca/phantom/sync.js, which cannot import from this folder.
//
// A "phantom" is a PhantomBuster agent; a run is one launch of it. Each run leaves a result
// file: one row per LinkedIn profile it worked on. Counting rules (countRows):
//   profiles      = rows in the file
//   invites_sent  = rows whose invite flag is set (inviteSent, invitationSent, connectionRequestSent,
//                   ... true / "YES" / "Success"), or whose status text says an invite went out
//                   ("Invitation sent", "1st follow-up sent", "Request accepted"). Auto Connect
//                   phantoms write no flag: every row without an error is a sent invite (assumeInvite).
//   accepted      = invited rows that are now 1st degree, or carry an accepted flag or status.
//   messages_sent = rows with a messageSent flag or a "message sent" / "follow-up sent" status.
//   replies       = rows with a replied flag or a "replied" / "responded" status.

export const METRICS = ['profiles', 'invites_sent', 'accepted', 'messages_sent', 'replies'];
export const OUTREACH_SCRIPTS = /auto ?connect|outreach|message sender|network booster|auto ?follow/i;
export const isOutreachScript = s => OUTREACH_SCRIPTS.test(String(s || ''));

const n = v => Number(v) || 0;
export const sum = (rows, k) => rows.reduce((a, r) => a + n(r[k]), 0);
export const div = (a, b) => b ? a / b : null;

/** true, "true", "yes", "success", "sent", "done", 1 count as set; everything else does not. */
export const truthy = v => {
  if (v === true || v === 1) return true;
  if (typeof v !== 'string') return false;
  return /^(true|yes|y|success|sent|done|ok|1)$/i.test(v.trim());
};
const flag = (r, keys) => keys.some(k => truthy(r[k]));
const statusOf = r => String(r.status ?? r.outreachStatus ?? r.inviteStatus ?? r.step ?? '').toLowerCase();

const INVITE_FLAGS = ['inviteSent', 'invitationSent', 'connectionRequestSent', 'invited', 'requestSent'];
const ACCEPT_FLAGS = ['accepted', 'invitationAccepted', 'connectionAccepted', 'requestAccepted', 'connected'];
const MESSAGE_FLAGS = ['messageSent', 'messagesSent', 'followUpSent', 'sentMessage'];
const REPLY_FLAGS = ['replied', 'hasReplied', 'responded', 'answered'];

export function rowInvited(r, assumeInvite = false) {
  if (!r || typeof r !== 'object') return false;
  if (flag(r, INVITE_FLAGS)) return true;
  if (INVITE_FLAGS.some(k => k in r && String(r[k]).trim() !== '')) return false;   // explicit NO
  const s = statusOf(r);
  if (/invitation sent|invite sent|request sent|follow-up sent|follow up sent|request accepted|accepted|responded \(connection/.test(s)) return true;
  if (/not invited|couldn't invite|could not invite|error|failed|skipped/.test(s)) return false;
  return assumeInvite && !r.error;
}
export function rowAccepted(r, assumeInvite = false) {
  if (!rowInvited(r, assumeInvite)) return false;
  if (flag(r, ACCEPT_FLAGS)) return true;
  const s = statusOf(r);
  if (/accepted|responded \(connection|follow-up sent|follow up sent/.test(s)) return true;
  return String(r.connectionDegree || r.degree || '').trim().toLowerCase() === '1st';
}
export function rowMessaged(r) {
  if (!r || typeof r !== 'object') return false;
  if (flag(r, MESSAGE_FLAGS)) return true;
  return /message sent|follow-up sent|follow up sent|messaged/.test(statusOf(r));
}
export function rowReplied(r) {
  if (!r || typeof r !== 'object') return false;
  if (flag(r, REPLY_FLAGS)) return true;
  return /replied|responded|answered/.test(statusOf(r));
}

/** Counts for one run from its result rows. assumeInvite: every clean row is a sent invite. */
export function countRows(rows, { assumeInvite = false } = {}) {
  const list = Array.isArray(rows) ? rows.filter(r => r && typeof r === 'object') : [];
  const c = { profiles: list.length, invites_sent: 0, accepted: 0, messages_sent: 0, replies: 0 };
  for (const r of list) {
    if (rowInvited(r, assumeInvite)) c.invites_sent++;
    if (rowAccepted(r, assumeInvite)) c.accepted++;
    if (rowMessaged(r)) c.messages_sent++;
    if (rowReplied(r)) c.replies++;
  }
  return c;
}

/** ms epoch, seconds epoch or ISO -> 'YYYY-MM-DD' in IST ('' when unreadable). */
export function dayIST(ts) {
  if (ts == null || ts === '') return '';
  let ms = typeof ts === 'number' ? ts : /^\d+$/.test(String(ts)) ? Number(ts) : Date.parse(ts);
  if (!Number.isFinite(ms)) return '';
  if (ms < 1e11) ms *= 1000;                                  // seconds
  return new Date(ms + 330 * 60000).toISOString().slice(0, 10);
}

/** Runs -> one row per phantom and launch day, sorted by day then phantom. */
export function rollupDaily(runs) {
  const m = new Map();
  for (const r of runs || []) {
    const day = r.day || dayIST(r.launched_at);
    if (!day || !r.agent_id) continue;
    const k = r.agent_id + '|' + day;
    if (!m.has(k)) m.set(k, { agent_id: r.agent_id, day, profiles: 0, invites_sent: 0, accepted: 0, messages_sent: 0, replies: 0 });
    const d = m.get(k);
    for (const key of METRICS) d[key] += n(r[key]);
  }
  return [...m.values()].sort((a, b) => a.day < b.day ? -1 : a.day > b.day ? 1 : a.agent_id < b.agent_id ? -1 : 1);
}

/** Sums plus the rates the report quotes: invites as % of profiles, accepted as % of invites. */
export function totals(rows) {
  const t = {}; for (const k of METRICS) t[k] = sum(rows || [], k);
  t.invite_rate = t.profiles ? t.invites_sent / t.profiles * 100 : null;
  t.acceptance_rate = t.invites_sent ? t.accepted / t.invites_sent * 100 : null;
  t.reply_rate = t.messages_sent ? t.replies / t.messages_sent * 100 : null;
  return t;
}

export const inRange = (rows, from, to) => (rows || []).filter(r => r.day >= from && r.day <= to);

/** Map agent_id -> totals over the given daily rows. */
export function byAgent(rows) {
  const m = new Map();
  for (const r of rows || []) { if (!m.has(r.agent_id)) m.set(r.agent_id, []); m.get(r.agent_id).push(r); }
  return new Map([...m].map(([k, v]) => [k, totals(v)]));
}

/** Phantoms with any activity in the rows. */
export const activeAgents = rows => new Set((rows || []).filter(r => METRICS.some(k => n(r[k]) > 0)).map(r => r.agent_id));

/** Metrics for js/trend.mjs (items = daily rows, dayOf = r => r.day). */
export const TREND_METRICS = [
  { key: 'invites_sent', label: 'Invites sent', fn: it => sum(it, 'invites_sent'), additive: true },
  { key: 'accepted', label: 'Accepted', fn: it => sum(it, 'accepted'), additive: true },
  { key: 'profiles', label: 'Profiles processed', fn: it => sum(it, 'profiles'), additive: true },
  { key: 'messages_sent', label: 'Messages sent', fn: it => sum(it, 'messages_sent'), additive: true },
  { key: 'replies', label: 'Replies', fn: it => sum(it, 'replies'), additive: true },
  { key: 'acceptRate', label: 'Acceptance rate', fmt: 'pct', axis: 'right', fn: it => totals(it).acceptance_rate },
  { key: 'inviteRate', label: 'Invites as % of profiles', fmt: 'pct', axis: 'right', fn: it => totals(it).invite_rate },
];
