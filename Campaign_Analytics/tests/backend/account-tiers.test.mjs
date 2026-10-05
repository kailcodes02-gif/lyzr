// node --test tests/backend
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as accountTiers from '../../../functions/api/ca/account-tiers.js';
import { cleanTiers, userMessage } from '../../../functions/api/ca/account-tiers.js';
import * as settingsApi from '../../../functions/api/ca/settings.js';
import { SETTING_KEYS } from '../../../functions/api/ca/_lib/settings.js';
import * as backend from '../../../functions/api/ca/_lib/tiers.js';
import { TIERS, TIER_LABEL, TIER_GROUP, ruleTier, tierOf, tierGroupOf } from '../../js/lib/tiers.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const seed = JSON.parse(readFileSync(path.join(here, '../../seed/accounts.json'), 'utf8'));

test('tier constants: five tiers, labels and Tier 1 / Tier 2 groups', () => {
  assert.deepEqual(TIERS, ['GSI', 'SI', 'Big Four', 'MBB', 'Other']);
  assert.deepEqual(Object.keys(TIER_LABEL), TIERS);
  assert.deepEqual(TIER_GROUP, { GSI: 'Tier 1', 'Big Four': 'Tier 1', MBB: 'Tier 1', SI: 'Tier 2', Other: 'Tier 2' });
  assert.ok(SETTING_KEYS.includes('account_tiers'));
});

test('ruleTier: named firms, category, industry plus headcount, else null', () => {
  const t = (a) => { const r = ruleTier(a); return r && r.tier; };
  assert.equal(t({ name: 'Deloitte', domain: 'deloittedigital.com' }), 'Big Four');
  assert.equal(t({ name: 'EY' }), 'Big Four');
  assert.equal(t({ name: 'Keyrus' }), null);                      // "ey" must not match inside a word
  assert.equal(t({ name: 'McKinsey & Company' }), 'MBB');
  assert.equal(t({ name: 'Boston Consulting Group (BCG)' }), 'MBB');
  assert.equal(t({ name: 'Accenture' }), 'GSI');
  assert.equal(t({ name: 'Tata Consultancy Services', domain: 'tcs.com' }), 'GSI');
  assert.equal(t({ name: 'Logica', domain: 'cgi.com' }), 'GSI');   // domain label match
  assert.equal(t({ name: 'Publicis Sapient' }), 'SI');
  assert.equal(t({ name: 'Oliver Wyman', category: 'MBB / Strategy' }), 'SI'); // the named list beats the category
  assert.equal(t({ name: 'Some Co', aliases: ['A.T. Kearney'] }), 'SI');     // aliases count
  assert.equal(t({ name: 'Bharat IT', category: 'Indian IT / BPM', employees: 120000 }), 'GSI');
  assert.equal(t({ name: 'Bharat IT', category: 'Indian IT / BPM', employees: 9000 }), 'SI');
  assert.equal(t({ name: 'Advisors LLP', category: 'Advisory' }), 'SI');
  assert.equal(t({ name: 'Big Co', category: 'Global SI' }), 'GSI');
  assert.equal(t({ name: 'Mid Co', industry: 'it services and it consulting', employees: 1800 }), 'SI');
  assert.equal(t({ name: 'Huge Co', industry: 'information technology & services', employees: '65,000' }), 'GSI');
  assert.equal(t({ name: 'Small Shop', industry: 'it services and it consulting', employees: 400 }), null);
  assert.equal(t({ name: 'Law & Partners', industry: 'law practice', employees: 50 }), null);
  assert.equal(ruleTier(null), null);
  const r = ruleTier({ name: 'KPMG' });
  assert.deepEqual(r, { tier: 'Big Four', conf: 'Rule', basis: 'Named Big Four firm: KPMG' });
});

test('tierOf / tierGroupOf: saved entry wins, then the rule, else Other', () => {
  const accounts = [{ name: 'Wipro' }, { name: 'Corner Shop', industry: 'retail', employees: 20 }];
  const saved = { Wipro: { tier: 'SI', conf: 'High', basis: 'manual', source: 'manual' }, 'Corner Shop': { tier: 'Nope' } };
  assert.equal(tierOf('Wipro', saved, accounts), 'SI');
  assert.equal(tierOf('Wipro', {}, accounts), 'GSI');
  assert.equal(tierOf('Corner Shop', saved, accounts), 'Other');
  assert.equal(tierOf('Unknown Ltd', null, accounts), 'Other');
  assert.equal(tierOf('Bain & Company', {}, []), 'MBB');           // rule on the bare name when the account is unknown
  assert.equal(tierGroupOf('Wipro', {}, accounts), 'Tier 1');
  assert.equal(tierGroupOf('Wipro', saved, accounts), 'Tier 2');
  assert.equal(tierGroupOf('Corner Shop', {}, accounts), 'Tier 2');
});

test('cleanTiers keeps asked names with a known tier, one row per name, confidence defaults to Low', () => {
  const out = cleanTiers([
    { name: 'acme digital', tier: 'SI', conf: 'Medium', basis: 'Regional integrator' },
    { name: 'Acme Digital', tier: 'GSI', conf: 'High', basis: 'duplicate' },
    { name: 'Nobody Inc', tier: 'SI', conf: 'High', basis: '' },
    { name: 'Globex', tier: 'Platinum', conf: 'High', basis: '' },
    { name: 'Initech', tier: 'Other', conf: 'Guess', basis: 'x'.repeat(400) },
  ], ['Acme Digital', 'Globex', 'Initech'], 'claude-sonnet-5');
  assert.deepEqual(out.map(o => [o.name, o.tier, o.conf, o.source, o.model]), [['Acme Digital', 'SI', 'Medium', 'claude', 'claude-sonnet-5'], ['Initech', 'Other', 'Low', 'claude', 'claude-sonnet-5']]);
  assert.equal(out[1].basis.length, 300); assert.ok(out[0].at);
  const msg = userMessage([{ name: 'Acme Digital', domain: 'acme.io', industry: 'it services and it consulting', country: 'India', employees: 1800 }, { name: 'Bare' }]);
  assert.ok(msg.includes('2 companies')); assert.ok(msg.includes('- Acme Digital; domain acme.io; industry it services and it consulting; country India; 1800 employees')); assert.ok(msg.includes('\n- Bare'));
});

test('the backend copy of the tier rules agrees with the canonical js/lib/tiers.mjs on the first 200 seed accounts', () => {
  assert.deepEqual(backend.TIERS, TIERS); assert.deepEqual(backend.TIER_GROUP, TIER_GROUP);
  const sample = seed.slice(0, 200);
  assert.deepEqual(sample.map(a => backend.ruleTier(a)), sample.map(a => ruleTier(a)));
  assert.ok(sample.some(a => ruleTier(a)), 'the sample should contain at least one rule hit');
  assert.ok(sample.some(a => !ruleTier(a)), 'the sample should leave something for Claude');
});

// Minimal fake world: Graph resolves the editor token, Supabase records the upsert, Claude answers with `anthropic`.
function world({ ca_settings = [], anthropic } = {}) {
  const calls = []; const tables = { ca_settings };
  const jsonRes = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
  const fetchStub = async (input, init = {}) => {
    const url = String(input); const headers = init.headers || {}; const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url, method: (init.method || 'GET').toUpperCase(), headers, body });
    if (url.startsWith('https://graph.microsoft.com/')) return headers.Authorization === 'Bearer tok-editor' ? jsonRes({ mail: 'subs@lyzr.com' }) : jsonRes({ error: 'bad' }, 401);
    if (url.includes('/rest/v1/ca_settings')) { if ((init.method || 'GET') === 'GET') { const k = new URL(url).searchParams.get('key'); return jsonRes(k && k.startsWith('eq.') ? tables.ca_settings.filter(r => r.key === k.slice(3)) : tables.ca_settings); } tables.ca_settings = [...tables.ca_settings.filter(r => !body.some(b => b.key === r.key)), ...body]; return new Response(null, { status: 201 }); }
    if (url.includes('/rest/v1/ca_cache')) return (init.method || 'GET') === 'GET' ? jsonRes([]) : new Response(null, { status: 201 });
    if (url.startsWith('https://api.anthropic.com/v1/messages')) return anthropic({ body });
    throw new Error('unexpected fetch ' + url);
  };
  const env = { CA_SUPABASE_URL: 'https://fake-ref.supabase.co', CA_SUPABASE_KEY: 'service-key', ANTHROPIC_API_KEY: 'sk-ant-test', ASSETS: { fetch: async (u) => new Response(readFileSync(path.join(here, '../../seed', new URL(String(u)).pathname.split('/').pop())), { headers: { 'content-type': 'application/json' } }) } };
  return { calls, tables, fetchStub, env };
}
async function run(handler, w, body, token = 'tok-editor') {
  const saved = globalThis.fetch; globalThis.fetch = w.fetchStub;
  try { const res = await handler({ request: new Request('https://app.test/api/ca/x', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), env: w.env }); return { status: res.status, body: await res.json() }; }
  finally { globalThis.fetch = saved; }
}

test('settings validate(account_tiers) keeps known tiers and normalises the entries', async () => {
  const w = world();
  const value = { 'Acme Digital': { tier: 'SI', conf: 'Medium', basis: 'b'.repeat(350), source: 'claude', model: 'claude-sonnet-5', at: '2026-10-01T00:00:00Z' }, ' Wipro ': { tier: 'GSI' }, Globex: { tier: 'Platinum' }, Blank: null, '': { tier: 'SI' } };
  const put = (v, token) => run(settingsApi.onRequestPut, w, { key: 'account_tiers', value: v }, token);
  assert.equal((await put(value, 'tok-viewer')).status, 401);
  assert.equal((await put(['GSI'])).status, 400);
  const r = await put(value);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const row = w.tables.ca_settings.find(x => x.key === 'account_tiers');
  assert.equal(row.updated_by, 'subs@lyzr.com');
  assert.deepEqual(Object.keys(row.value), ['Acme Digital', 'Wipro']);
  assert.equal(row.value['Acme Digital'].basis.length, 300);
  assert.equal(row.value['Acme Digital'].source, 'claude'); assert.equal(row.value['Acme Digital'].model, 'claude-sonnet-5');
  assert.deepEqual(row.value.Wipro, { tier: 'GSI', conf: 'Medium', basis: '', source: 'manual', at: null });
});

test('POST account-tiers: rules first (free), the rest in one low-effort Sonnet call, merged into the setting, remaining for the next loop', async () => {
  const seen = [];
  const w = world({
    ca_settings: [{ key: 'account_tiers', value: { Accenture: { tier: 'GSI', conf: 'Rule', basis: 'x', source: 'rule', at: '2026-10-01T00:00:00Z' } } }],
    anthropic: ({ body }) => { seen.push(body); const names = body.messages[0].content.split('\n').filter(l => l.startsWith('- ')).map(l => l.slice(2).split(';')[0]); return new Response(JSON.stringify({ model: body.model, content: [{ type: 'tool_use', name: 'account_tiers', input: { tiers: names.map(n => ({ name: n, tier: 'Other', conf: 'Low', basis: 'Not an SI' })) } }] }), { status: 200, headers: { 'content-type': 'application/json' } }); },
  });
  const noRule = seed.filter(a => !ruleTier(a)).slice(0, 5).map(a => a.name);
  const r = await run(accountTiers.onRequestPost, w, { accounts: ['Accenture', 'Deloitte', 'McKinsey & Company', ...noRule], limit: 3 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.rule, 2); assert.equal(r.body.claude, 3); assert.equal(r.body.remaining, 2); assert.equal(r.body.model, 'claude-sonnet-5');
  assert.deepEqual(r.body.tiers.slice(0, 2).map(t => [t.name, t.tier, t.source]), [['Deloitte', 'Big Four', 'rule'], ['McKinsey & Company', 'MBB', 'rule']]);
  assert.equal(seen.length, 1, 'one Claude call');
  assert.equal(seen[0].model, 'claude-sonnet-5'); assert.deepEqual(seen[0].output_config, { effort: 'low' }); assert.equal(seen[0].max_tokens, 4000);
  assert.equal(seen[0].tool_choice.name, 'account_tiers'); assert.equal(seen[0].system[0].cache_control.type, 'ephemeral');
  assert.equal(seen[0].messages[0].content.split('\n- ').length - 1, 3, 'only the limit goes to Claude');
  const row = w.tables.ca_settings.find(x => x.key === 'account_tiers');
  assert.equal(Object.keys(row.value).length, 1 + 2 + 3, 'Accenture kept (already classified, not forced), 2 rule rows and 3 Claude rows added');
  assert.equal(row.value.Deloitte.tier, 'Big Four'); assert.equal(row.value[noRule[0]].source, 'claude'); assert.equal(row.updated_by, 'subs@lyzr.com');
  // force re-classifies Accenture by rule without calling Claude.
  const r2 = await run(accountTiers.onRequestPost, w, { accounts: ['Accenture'], force: true });
  assert.deepEqual([r2.body.rule, r2.body.claude, r2.body.remaining, r2.body.model], [1, 0, 0, null]); assert.equal(seen.length, 1);
  assert.equal((await run(accountTiers.onRequestPost, w, {}, 'tok-viewer')).status, 401);
});

test('POST account-tiers: a 400 that rejects output_config is retried once without it', async () => {
  const seen = [];
  const w = world({ anthropic: ({ body }) => { seen.push(body); if (body.output_config) return new Response(JSON.stringify({ error: { message: 'output_config: Extra inputs are not permitted' } }), { status: 400 }); return new Response(JSON.stringify({ model: 'claude-sonnet-5', content: [{ type: 'tool_use', name: 'account_tiers', input: { tiers: [{ name: 'Zeta Widgets', tier: 'Other', conf: 'Low', basis: 'Vendor' }] } }] }), { status: 200 }); } });
  const r = await run(accountTiers.onRequestPost, w, { accounts: ['Zeta Widgets'] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(seen.length, 2); assert.ok(seen[0].output_config); assert.equal(seen[1].output_config, undefined);
  assert.deepEqual(r.body.tiers.map(t => [t.name, t.tier, t.source]), [['Zeta Widgets', 'Other', 'claude']]);
});
