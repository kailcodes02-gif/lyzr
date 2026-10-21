// li-leads (GET / POST / DELETE), screenshots (POST, Claude vision) and the leads/linkedin data API source,
// over a fake Supabase (ca_insights as the document store, ca_cache) and a fake Anthropic API.
// node --test 'Campaign_Analytics/tests/backend/*.test.mjs'
import test from 'node:test';
import assert from 'node:assert/strict';

import * as liLeads from '../../../functions/api/ca/li-leads.js';
import * as screenshots from '../../../functions/api/ca/screenshots.js';
import { runSource, SOURCES, toCsv } from '../../../functions/api/ca/_lib/query.js';

const SUPA = 'https://fake-ref.supabase.co';
const jsonRes = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const likeRe = p => new RegExp('^' + p.replace(/\\(.)|([.*+?^${}()|[\]])|%|_/g, (m, esc, special) => esc ? esc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : special ? '\\' + special : m === '%' ? '.*' : '.') + '$');

function world({ insights = [], anthropic } = {}) {
  const calls = [];
  const tables = { ca_insights: insights.map(r => ({ ...r })), ca_cache: [], ca_settings: [] };
  const users = { 'tok-editor': { displayName: 'Subs', mail: 'subs@lyzr.com' }, 'tok-viewer': { displayName: 'Viewer', mail: 'viewer@lyzr.ai' } };
  async function fetchStub(input, init = {}) {
    const url = String(input); const method = (init.method || 'GET').toUpperCase(); const headers = init.headers || {};
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url, method, headers, body });
    if (url.startsWith('https://graph.microsoft.com/')) { const tok = String(headers.Authorization || '').replace('Bearer ', ''); return users[tok] ? jsonRes(users[tok]) : jsonRes({ error: 'bad' }, 401); }
    if (url.startsWith('https://api.anthropic.com/')) return anthropic ? anthropic({ body, headers }) : jsonRes({ error: 'no stub' }, 500);
    if (!url.startsWith(SUPA + '/rest/v1/')) throw new Error('unexpected fetch ' + url);
    const u = new URL(url); const table = u.pathname.split('/').pop();
    let rows = tables[table] || (tables[table] = []);
    const match = r => { for (const [k, v] of u.searchParams) { if (['select', 'order', 'limit', 'offset', 'on_conflict'].includes(k)) continue; if (v.startsWith('eq.') && String(r[k]) !== v.slice(3)) return false; if (v.startsWith('like.') && !likeRe(v.slice(5)).test(String(r[k]))) return false; if (v.startsWith('in.(')) { const set = new Set(v.slice(4, -1).split(',').map(s => s.replace(/"/g, ''))); if (!set.has(String(r[k]))) return false; } } return true; };
    if (method === 'GET') { let out = rows.filter(match); const lim = u.searchParams.get('limit'); if (lim) out = out.slice(0, Number(lim)); const range = headers.Range; if (range) { const [a, b] = range.split('-').map(Number); out = out.slice(a, b + 1); } return jsonRes(out); }
    if (method === 'POST') { const key = u.searchParams.get('on_conflict'); for (const r of Array.isArray(body) ? body : [body]) { const i = key ? rows.findIndex(x => x[key] === r[key]) : -1; if (i >= 0) rows[i] = { ...rows[i], ...r }; else rows.push({ ...r }); } return new Response(null, { status: 201 }); }
    if (method === 'DELETE') { tables[table] = rows.filter(r => !match(r)); return new Response(null, { status: 204 }); }
    return new Response(null, { status: 204 });
  }
  const env = { CA_SUPABASE_URL: SUPA, CA_SUPABASE_KEY: 'service-key', ANTHROPIC_API_KEY: 'sk-ant-test' };
  return { calls, tables, env, fetchStub };
}
const req = (method, pathAndQuery, { token = 'tok-editor', body } = {}) => new Request('https://lyzr.kailash-gm.com/api/ca/' + pathAndQuery, { method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
async function run(handler, request, w) {
  const saved = globalThis.fetch; globalThis.fetch = w.fetchStub;
  try { const res = await handler({ request, env: w.env }); const text = await res.text(); return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers }; }
  finally { globalThis.fetch = saved; }
}

const lead = (o = {}) => ({ submitted_at: '2026-09-14', first_name: 'Asha', last_name: 'Rao', email: 'asha@ey.com', company: 'EY', title: 'Partner', country: 'India', campaign: 'Playbooks|GSI', form: 'Roadmap', ...o });
const DOCS = () => [
  { scope: 'leads:li-api', content: { source: 'api', file_name: 'LinkedIn API pull', uploaded_at: '2026-10-21T01:00:00Z', rows: [lead(), lead({ email: 'ben@deloitte.com', first_name: 'Ben', company: 'Deloitte', submitted_at: '2026-10-02' })] }, created_at: '2026-10-21T01:00:00Z', model: 'li-api' },
  { scope: 'leads:11111111-aaaa', content: { source: 'csv', file_name: 'sept.csv', uploaded_by: 'isha@whitepath.in', uploaded_at: '2026-09-20T00:00:00Z', rows: [lead(), lead({ email: 'chen@infosys.com', first_name: 'Chen', company: 'Infosys', submitted_at: '2026-08-30' })] }, created_at: '2026-09-20T00:00:00Z', model: 'lead-file' },
  { scope: 'leads:2026-09-01:2026-09-30', content: { headline: 'old HubSpot read-out cached under the leads: prefix', findings: [] }, created_at: '2026-09-30T00:00:00Z', model: 'claude-sonnet-5' },
  { scope: 'screen:22222222-bbbb', content: { file_name: 'list.png', uploaded_by: 'anju@lyzr.ai', uploaded_at: '2026-10-10T00:00:00Z', kind: 'leads', title: 'ME leads', summary: 'Two leads.', period: { from: '2026-10-01', to: '2026-10-09' }, leads: [{ first_name: 'Omar', last_name: 'K', company: 'PwC', title: 'Director', submitted_at: '2026-10-05' }, lead()], metrics: [{ campaign: '', metric: 'Leads', value: 2, unit: 'count', period: 'Oct' }], tables: [], notes: '' }, created_at: '2026-10-10T00:00:00Z', model: 'claude-sonnet-5' },
  { scope: '_li_oauth', content: { access_token: 'secret' }, created_at: '2026-10-01T00:00:00Z' },
];

test('li-leads GET: merges lead files, the API pull and screenshot leads; counts repeats once; skips non-lead rows; cached', async () => {
  const w = world({ insights: DOCS() });
  let r = await run(liLeads.onRequestGet, req('GET', 'li-leads', { token: null }), w);
  assert.equal(r.status, 401);
  r = await run(liLeads.onRequestGet, req('GET', 'li-leads', { token: 'tok-viewer' }), w);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const b = r.body;
  assert.equal(b.leads.length, 4, 'Asha once (API first), Ben, Chen, Omar');
  assert.equal(b.duplicates, 2, 'Asha in the file and in the screenshot');
  const asha = b.leads.find(l => l.email === 'asha@ey.com');
  assert.deepEqual([asha.source, asha.doc_id], ['api', 'leads:li-api']);
  assert.equal(b.leads.find(l => l.first_name === 'Chen').source, 'csv');
  assert.equal(b.leads.find(l => l.first_name === 'Omar').source, 'screenshot');
  assert.deepEqual(b.docs.map(d => [d.id, d.source, d.count, d.kept]), [['leads:li-api', 'api', 2, 2], ['leads:11111111-aaaa', 'csv', 2, 1]]);
  assert.equal(b.screens.length, 1);
  assert.deepEqual([b.screens[0].kind, b.screens[0].leads_count, b.screens[0].metrics.length], ['leads', 2, 1]);
  assert.ok(!JSON.stringify(b).includes('secret'), 'private _ records are never served');
  assert.equal(r.headers.get('x-ca-cache'), 'miss');
  const like = w.calls.find(c => c.url.includes('ca_insights') && c.url.includes('scope=like.leads'));
  assert.ok(like, 'reads documents by prefix');
  assert.ok(w.tables.ca_cache.some(x => /li-leads/.test(x.key)), 'the answer is stored in the shared cache');
});

test('li-leads POST: editors only, limits, keeps only leads not held yet, writes leads:<uuid>, bumps the cache', async () => {
  const w = world({ insights: DOCS() });
  let r = await run(liLeads.onRequestPost, req('POST', 'li-leads', { token: 'tok-viewer', body: { rows: [lead()] } }), w);
  assert.equal(r.status, 403);
  r = await run(liLeads.onRequestPost, req('POST', 'li-leads', { body: { rows: [] } }), w);
  assert.equal(r.status, 400);
  r = await run(liLeads.onRequestPost, req('POST', 'li-leads', { body: { rows: Array.from({ length: 20001 }, () => lead()) } }), w);
  assert.equal(r.status, 413);
  const rows = [lead(), lead({ email: 'CHEN@infosys.com', first_name: 'Chen', company: 'Infosys', submitted_at: '08/30/2026' }), lead({ email: 'dev@wipro.com', first_name: 'Dev', company: 'Wipro' }), lead({ email: 'dev@wipro.com', first_name: 'Dev', company: 'Wipro' }), { company: 'Nobody' }, lead({ email: '', first_name: 'Eve', last_name: 'S', company: 'TCS', extra_q: 'Audit' })];
  r = await run(liLeads.onRequestPost, req('POST', 'li-leads', { body: { file_name: 'oct.csv', rows } }), w);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.match(r.body.id, /^leads:[0-9a-f-]{36}$/);
  assert.deepEqual([r.body.inserted, r.body.skipped, r.body.duplicates, r.body.invalid], [2, 4, 3, 1]);
  const doc = w.tables.ca_insights.find(x => x.scope === r.body.id);
  assert.equal(doc.content.file_name, 'oct.csv');
  assert.equal(doc.content.uploaded_by, 'subs@lyzr.com');
  assert.deepEqual(doc.content.rows.map(x => x.first_name), ['Dev', 'Eve']);
  assert.deepEqual(doc.content.rows[1].extra, { extra_q: 'Audit' });
  assert.equal(doc.content.rows[0].source, undefined, 'rows are stored without the source field');
  assert.ok(w.tables.ca_cache.some(x => x.key === '_version'), 'the shared cache version is bumped');
  // the same file again: nothing new, nothing written
  const before = w.tables.ca_insights.length;
  r = await run(liLeads.onRequestPost, req('POST', 'li-leads', { body: { file_name: 'oct.csv', rows } }), w);
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.id, r.body.inserted], [null, 0]);
  assert.equal(w.tables.ca_insights.length, before);
});

test('li-leads DELETE: editors only, valid ids, never the API pull, 404 for unknown or non-lead rows', async () => {
  const w = world({ insights: DOCS() });
  let r = await run(liLeads.onRequestDelete, req('DELETE', 'li-leads?id=screen:22222222-bbbb', { token: 'tok-viewer' }), w);
  assert.equal(r.status, 403);
  r = await run(liLeads.onRequestDelete, req('DELETE', 'li-leads?id=settings'), w);
  assert.equal(r.status, 400);
  r = await run(liLeads.onRequestDelete, req('DELETE', 'li-leads?id=leads:li-api'), w);
  assert.equal(r.status, 400);
  r = await run(liLeads.onRequestDelete, req('DELETE', 'li-leads?id=leads:nope'), w);
  assert.equal(r.status, 404);
  r = await run(liLeads.onRequestDelete, req('DELETE', 'li-leads?id=' + encodeURIComponent('leads:2026-09-01:2026-09-30')), w);
  assert.equal(r.status, 400, 'colons beyond the prefix are not a document id');
  r = await run(liLeads.onRequestDelete, req('DELETE', 'li-leads?id=screen:22222222-bbbb'), w);
  assert.equal(r.status, 200);
  assert.ok(!w.tables.ca_insights.some(x => x.scope === 'screen:22222222-bbbb'));
  assert.ok(w.calls.some(c => c.method === 'DELETE' && c.url.includes('scope=eq.screen%3A22222222-bbbb') || c.method === 'DELETE' && c.url.includes('scope=eq.screen:22222222-bbbb')));
  assert.ok(w.tables.ca_cache.some(x => x.key === '_version'));
  r = await run(liLeads.onRequestDelete, req('DELETE', 'li-leads?id=leads:11111111-aaaa'), w);
  assert.equal(r.status, 200);
});

const PNG = Buffer.from('fake png bytes for the test').toString('base64');
const extractReply = body => jsonRes({ model: body.model, stop_reason: 'tool_use', usage: { input_tokens: 1500, output_tokens: 300 }, content: [{ type: 'tool_use', name: 'extract', input: {
  kind: 'nonsense', title: 'Lead gen form — September', summary: 'Two leads — both at EY.', period: { from: 'Sep 1, 2026', to: '2026-09-30' },
  leads: [{ first_name: 'Asha', last_name: 'Rao', email: 'ASHA@EY.COM', company: 'EY', title: 'Partner', submitted_at: '09/14/2026' }, { first_name: '', last_name: '', email: '', company: '' }],
  metrics: [{ campaign: 'Playbooks', metric: 'Spend', value: '$1,234.50', unit: 'USD', period: 'Sep' }, { campaign: 'Playbooks', metric: 'CTR', value: 'n/a' }, { metric: '' }],
  tables: [{ title: 'Forms', columns: ['Form', 'Leads'], rows: [['Roadmap', 12]] }], notes: 'Right edge cut off',
} }] });

test('screenshots POST: Sonnet 5 with the image and a forced extract call; cleaned result stored as screen:<uuid>', async () => {
  let sent = null;
  const w = world({ anthropic: ({ body, headers }) => { sent = { body, headers }; return extractReply(body); } });
  let r = await run(screenshots.onRequestPost, req('POST', 'screenshots', { token: null, body: {} }), w);
  assert.equal(r.status, 401);
  r = await run(screenshots.onRequestPost, req('POST', 'screenshots', { token: 'tok-viewer', body: { media_type: 'image/bmp', data: PNG } }), w);
  assert.equal(r.status, 400);
  r = await run(screenshots.onRequestPost, req('POST', 'screenshots', { token: 'tok-viewer', body: { media_type: 'image/png', data: 'not base64!!' } }), w);
  assert.equal(r.status, 400);
  r = await run(screenshots.onRequestPost, req('POST', 'screenshots', { token: 'tok-viewer', body: { file_name: 'big.png', media_type: 'image/png', data: 'A'.repeat(Math.ceil(5 * 1024 * 1024 * 4 / 3) + 8) } }), w);
  assert.equal(r.status, 413, 'over 5 MB decoded is refused before any model call');
  assert.equal(sent, null);
  assert.equal(screenshots.decodedBytes('QUJD'), 3);
  assert.equal(screenshots.decodedBytes('QUI='), 2);

  r = await run(screenshots.onRequestPost, req('POST', 'screenshots', { token: 'tok-viewer', body: { file_name: 'forms.png', media_type: 'image/png', data: 'data:image/png;base64,' + PNG, hint: 'Lead gen forms, Sept' } }), w);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  // the request
  assert.equal(sent.body.model, 'claude-sonnet-5');
  assert.equal(screenshots.MODEL, 'claude-sonnet-5');
  assert.deepEqual(sent.body.tool_choice, { type: 'tool', name: 'extract', disable_parallel_tool_use: true });
  assert.equal(sent.body.tools[0].name, 'extract');
  assert.deepEqual(sent.body.tools[0].input_schema.properties.kind.enum, ['leads', 'campaign_metrics', 'lead_form_metrics', 'demographics', 'other']);
  const img = sent.body.messages[0].content.find(c => c.type === 'image');
  assert.deepEqual(img.source, { type: 'base64', media_type: 'image/png', data: PNG }, 'the data URL prefix is stripped');
  assert.ok(sent.body.messages[0].content.find(c => c.type === 'text').text.includes('Lead gen forms, Sept'));
  assert.equal(sent.headers['x-api-key'], 'sk-ant-test');
  assert.match(sent.body.system[0].text, /Never invent/);
  // the stored document
  const b = r.body;
  assert.match(b.id, /^screen:[0-9a-f-]{36}$/);
  assert.deepEqual([b.kind, b.title, b.summary], ['other', 'Lead gen form, September', 'Two leads, both at EY.']);
  assert.deepEqual(b.period, { from: '2026-09-01', to: '2026-09-30' });
  assert.equal(b.leads.length, 1);
  assert.deepEqual([b.leads[0].email, b.leads[0].submitted_at], ['asha@ey.com', '2026-09-14']);
  assert.deepEqual(b.metrics.map(m => m.value), [1234.5, 'n/a']);
  assert.deepEqual(b.tables[0].rows, [['Roadmap', '12']]);
  assert.equal(b.uploaded_by, 'viewer@lyzr.ai');
  assert.equal(b.model, 'claude-sonnet-5');
  const stored = w.tables.ca_insights.find(x => x.scope === b.id);
  assert.equal(stored.content.file_name, 'forms.png');
  assert.equal(stored.model, 'claude-sonnet-5');
  assert.ok(w.tables.ca_cache.some(x => x.key === '_version'));
  // and it shows up in GET li-leads
  const g = await run(liLeads.onRequestGet, req('GET', 'li-leads'), w);
  assert.equal(g.body.screens.length, 1);
  assert.equal(g.body.leads[0].source, 'screenshot');
  const s = await run(screenshots.onRequestGet, req('GET', 'screenshots'), w);
  assert.equal(s.body.screens[0].id, b.id);
});

test('screenshots POST: no key 503, rate limit 429, upstream error 500, max_tokens and missing tool call', async () => {
  let w = world({ anthropic: () => jsonRes({}) }); w.env.ANTHROPIC_API_KEY = '';
  let r = await run(screenshots.onRequestPost, req('POST', 'screenshots', { body: { media_type: 'image/jpeg', data: PNG } }), w);
  assert.equal(r.status, 503);
  w = world({ anthropic: () => jsonRes({ error: { type: 'rate_limit_error' } }, 429) });
  r = await run(screenshots.onRequestPost, req('POST', 'screenshots', { body: { media_type: 'image/jpeg', data: PNG } }), w);
  assert.equal(r.status, 429);
  w = world({ anthropic: () => jsonRes({ error: 'overloaded' }, 529) });
  r = await run(screenshots.onRequestPost, req('POST', 'screenshots', { body: { media_type: 'image/jpeg', data: PNG } }), w);
  assert.equal(r.status, 500, 'upstream failures are reported as 500 (Cloudflare hides 502 bodies)');
  assert.match(r.body.error, /Model error 529/);
  w = world({ anthropic: ({ body }) => jsonRes({ model: body.model, stop_reason: 'max_tokens', content: [] }) });
  r = await run(screenshots.onRequestPost, req('POST', 'screenshots', { body: { media_type: 'image/jpeg', data: PNG } }), w);
  assert.match(r.body.error, /Crop it/);
  w = world({ anthropic: ({ body }) => jsonRes({ model: body.model, stop_reason: 'end_turn', content: [{ type: 'text', text: 'hi' }] }) });
  r = await run(screenshots.onRequestPost, req('POST', 'screenshots', { body: { media_type: 'image/jpeg', data: PNG } }), w);
  assert.match(r.body.error, /did not return a reading/);
  assert.equal(w.tables.ca_insights.length, 0, 'nothing stored on failure');
});

test('data API leads/linkedin: merged leads with from/to on submitted_at, filters, CSV-ready rows', async () => {
  const w = world({ insights: DOCS() });
  assert.ok(SOURCES.some(s => s.name === 'leads/linkedin'));
  const saved = globalThis.fetch; globalThis.fetch = w.fetchStub;
  try {
    let out = await runSource(w.env, null, 'leads/linkedin', { from: '2026-09-01', to: '2026-09-30' });
    assert.equal(out.total, 1);
    assert.equal(out.rows[0].email, 'asha@ey.com');
    out = await runSource(w.env, null, 'leads/linkedin', {});
    assert.equal(out.total, 4);
    assert.equal(out.duplicates_left_out, 2);
    assert.deepEqual(out.by_source, { api: 2, csv: 1, screenshot: 1 });
    out = await runSource(w.env, null, 'leads/linkedin', { source: 'screenshot' });
    assert.deepEqual(out.rows.map(r => r.first_name), ['Omar']);
    out = await runSource(w.env, null, 'leads/linkedin', { company: 'deloitte' });
    assert.equal(out.total, 1);
    const csv = toCsv(out.rows);
    assert.ok(csv.split('\n')[0].includes('submitted_at') && csv.includes('ben@deloitte.com'));
    assert.ok(!csv.includes('secret'));
  } finally { globalThis.fetch = saved; }
});
