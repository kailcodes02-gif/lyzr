// node --test 'Campaign_Analytics/tests/frontend/*.test.mjs'
import test from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../../js/lib/phantom-agg.mjs';
import { phantomMock, phantomGet, phantomSyncPost } from '../../js/mock/phantom.mjs';

test('countRows: Outreach rows use status text, invitationSent and connectionDegree', () => {
  const rows = [
    { status: 'Not invited yet', connectionDegree: '2nd' },
    { status: 'Not invited yet', connectionDegree: '1st' },            // already connected, never invited: not an acceptance
    { status: 'Invitation sent', invitationSent: 'YES', connectionDegree: '2nd' },
    { status: 'Request accepted', invitationSent: 'YES', connectionDegree: '1st' },
    { status: '1st follow-up sent', invitationSent: 'YES', connectionDegree: '1st' },
    { status: 'Responded (Connection request)', invitationSent: 'YES', connectionDegree: '1st' },
    { status: "Couldn't invite", invitationSent: 'NO' },
    null, 'junk',
  ];
  assert.deepEqual(P.countRows(rows), { profiles: 7, invites_sent: 4, accepted: 3, messages_sent: 1, replies: 1 });
});

test('countRows: Auto Connect rows carry no flag, every clean row is a sent invite', () => {
  const rows = [
    { fullName: 'A', connectionDegree: '2nd', timestamp: '2026-09-30T11:32:07.359Z' },
    { fullName: 'B', connectionDegree: '2nd' },
    { fullName: 'C', error: 'Already invited' },
    { fullName: 'D', connectionDegree: '1st' },                       // invited earlier, accepted since
  ];
  assert.deepEqual(P.countRows(rows, { assumeInvite: true }), { profiles: 4, invites_sent: 3, accepted: 1, messages_sent: 0, replies: 0 });
  assert.deepEqual(P.countRows(rows), { profiles: 4, invites_sent: 0, accepted: 0, messages_sent: 0, replies: 0 }, 'without assumeInvite nothing is counted as an invite');
});

test('countRows: boolean and "Success" flags, message and reply flags, Message Sender rows are not invites', () => {
  const rows = [
    { inviteSent: true, accepted: true },
    { connectionRequestSent: 'Success', accepted: false },
    { invitationSent: 'NO' },
    { messageSent: 'Success', replied: 'YES' },                       // Message Sender: no invite involved
    { status: 'Message sent' },
  ];
  assert.deepEqual(P.countRows(rows), { profiles: 5, invites_sent: 2, accepted: 1, messages_sent: 2, replies: 1 });
  assert.equal(P.countRows(null).profiles, 0);
  assert.equal(P.truthy('yes'), true); assert.equal(P.truthy('no'), false); assert.equal(P.truthy(0), false);
});

test('isOutreachScript and dayIST', () => {
  assert.equal(P.isOutreachScript('LinkedIn Auto Connect.js'), true);
  assert.equal(P.isOutreachScript('LinkedIn Outreach.js'), true);
  assert.equal(P.isOutreachScript('LinkedIn Message Sender.js'), true);
  assert.equal(P.isOutreachScript('LinkedIn Connections Export.js'), false);
  assert.equal(P.isOutreachScript('LinkedIn Inbox Scraper.js'), false);
  assert.equal(P.dayIST(1790767842387), '2026-09-30');                // 06:10 UTC = 11:40 IST
  assert.equal(P.dayIST('2026-09-30T20:00:00Z'), '2026-10-01');       // 01:30 IST next day
  assert.equal(P.dayIST(1790767842), '2026-09-30');                   // seconds
  assert.equal(P.dayIST('nope'), ''); assert.equal(P.dayIST(null), '');
});

test('rollupDaily groups runs by phantom and IST launch day and sums the counts', () => {
  const runs = [
    { id: 'r1', agent_id: 'a', launched_at: '2026-09-29T04:30:00Z', profiles: 10, invites_sent: 8, accepted: 1, messages_sent: 0, replies: 0 },
    { id: 'r2', agent_id: 'a', launched_at: '2026-09-29T12:00:00Z', profiles: 5, invites_sent: 4, accepted: 2, messages_sent: 1, replies: 1 },
    { id: 'r3', agent_id: 'a', launched_at: '2026-09-29T19:00:00Z', profiles: 1, invites_sent: 1, accepted: 0, messages_sent: 0, replies: 0 },   // 00:30 IST on the 30th
    { id: 'r4', agent_id: 'b', launched_at: '2026-09-29T05:00:00Z', profiles: 3, invites_sent: 3, accepted: 0, messages_sent: 0, replies: 0 },
    { id: 'r5', agent_id: 'b', launched_at: null, profiles: 99 },
  ];
  assert.deepEqual(P.rollupDaily(runs), [
    { agent_id: 'a', day: '2026-09-29', profiles: 15, invites_sent: 12, accepted: 3, messages_sent: 1, replies: 1 },
    { agent_id: 'b', day: '2026-09-29', profiles: 3, invites_sent: 3, accepted: 0, messages_sent: 0, replies: 0 },
    { agent_id: 'a', day: '2026-09-30', profiles: 1, invites_sent: 1, accepted: 0, messages_sent: 0, replies: 0 },
  ]);
});

test('totals with rates, byAgent, activeAgents, inRange', () => {
  const daily = [
    { agent_id: 'a', day: '2026-09-01', profiles: 100, invites_sent: 40, accepted: 8, messages_sent: 4, replies: 1 },
    { agent_id: 'a', day: '2026-09-02', profiles: 100, invites_sent: 60, accepted: 12, messages_sent: 6, replies: 0 },
    { agent_id: 'b', day: '2026-09-02', profiles: 0, invites_sent: 0, accepted: 0, messages_sent: 0, replies: 0 },
  ];
  const t = P.totals(daily);
  assert.deepEqual([t.profiles, t.invites_sent, t.accepted, t.invite_rate, t.acceptance_rate, t.reply_rate], [200, 100, 20, 50, 20, 10]);
  const z = P.totals([]);
  assert.equal(z.invite_rate, null); assert.equal(z.acceptance_rate, null); assert.equal(z.reply_rate, null);
  assert.equal(P.byAgent(daily).get('a').invites_sent, 100);
  assert.deepEqual([...P.activeAgents(daily)], ['a']);
  assert.equal(P.inRange(daily, '2026-09-02', '2026-09-02').length, 2);
  assert.equal(P.TREND_METRICS.find(m => m.key === 'acceptRate').fn(daily), 20);
});

test('mock: two phantoms, about 12 weeks of daily rows, about 20 runs, GET filters runs by range, sync is two steps', () => {
  assert.equal(phantomMock.agents.length, 2);
  const days = [...new Set(phantomMock.daily.map(d => d.day))].sort();
  assert.ok(days.length >= 55 && days.length <= 70, `${days.length} distinct days`);
  assert.equal(days[0], '2026-07-06'); assert.equal(days[days.length - 1], '2026-09-30');
  assert.ok(phantomMock.runs.length >= 15 && phantomMock.runs.length <= 25, `${phantomMock.runs.length} runs`);
  assert.deepEqual(P.rollupDaily(phantomMock.runs).length, phantomMock.runs.length, 'one run per phantom per day in the mock');
  // the ramp the reports describe: week 4 of the Agentic Roadmap phantom is about 549 invites
  const wk = (id, start, end) => P.totals(phantomMock.daily.filter(d => d.agent_id === id && d.day >= start && d.day <= end)).invites_sent;
  assert.ok(wk('pb-demo-1', '2026-07-06', '2026-07-12') < wk('pb-demo-1', '2026-07-27', '2026-08-02'));
  assert.ok(Math.abs(wk('pb-demo-1', '2026-07-27', '2026-08-02') - 549) <= 5);
  const g = phantomGet({ from: '2026-09-22', to: '2026-09-24' });
  assert.equal(g.configured, true);
  assert.equal(g.daily.length, phantomMock.daily.length, 'daily is always the whole history');
  assert.ok(g.runs.length > 0 && g.runs.every(r => { const d = P.dayIST(r.launched_at); return d >= '2026-09-22' && d <= '2026-09-24'; }));
  const a = phantomSyncPost({});
  assert.equal(a.done, false); assert.ok(a.cursor);
  const b = phantomSyncPost({ cursor: a.cursor });
  assert.equal(b.done, true); assert.equal(b.agents, 2);
  assert.equal(phantomMock.last_sync.status, 'done');
});
