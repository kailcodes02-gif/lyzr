// node --test tests/backend
import test from 'node:test';
import assert from 'node:assert/strict';
import { cacheKey, cachedGet, cacheResponse, bumpCacheVersion, CACHE_SCHEMA, VERSION_KEY, MIGRATION_WARNING, DEFAULT_TTL_MS } from '../../../functions/api/ca/_lib/cache.js';

const H = 60 * 60 * 1000;
const iso = (ms) => new Date(ms).toISOString();

// Fake PostgREST client: rows keyed by `key`; records every call.
function fakeDb(rows = [], { failSelect, failUpsert } = {}) {
  const store = new Map(rows.map((r) => [r.key, r]));
  const calls = { select: [], upsert: [] };
  return {
    store, calls,
    async select(table, opts) {
      calls.select.push({ table, opts });
      if (failSelect) throw new Error(failSelect);
      const m = /^in\.\((.*)\)$/.exec(opts.params.key);
      const keys = m[1].split(',').map((k) => k.replace(/^"|"$/g, ''));
      return keys.map((k) => store.get(k)).filter(Boolean);
    },
    async upsert(table, list) {
      calls.upsert.push({ table, rows: list });
      if (failUpsert) throw new Error(failUpsert);
      for (const r of list) store.set(r.key, r);
      return null;
    },
  };
}
const req = (headers = {}) => new Request('http://x/api/ca/linkedin?from=2026-09-01', { headers });
const env = { CA_SUPABASE_URL: 'http://db', CA_SUPABASE_KEY: 'k' };
const BODY = { perf: [1, 2, 3], uploads: [] };

test('cacheKey is stable under param order and drops empty values', () => {
  const a = cacheKey('linkedin', { to: '2026-09-30', from: '2026-09-01', platform: 'linkedin', all: '' });
  const b = cacheKey('/linkedin', { platform: 'linkedin', from: '2026-09-01', to: '2026-09-30', x: undefined, y: null });
  assert.equal(a, b);
  assert.equal(a, `${CACHE_SCHEMA}:linkedin?from=2026-09-01&platform=linkedin&to=2026-09-30`);
  assert.equal(cacheKey('coverage'), `${CACHE_SCHEMA}:coverage`);
  assert.equal(cacheKey('coverage', {}), cacheKey('coverage'));
  assert.notEqual(cacheKey('email', { offset: 0 }), cacheKey('email', { offset: 15000 }));
});

test('miss computes, stores the serialized body and reports the compute time', async () => {
  const d = fakeDb();
  let computed = 0;
  const r = await cachedGet(env, req(), { path: 'linkedin', params: { from: '2026-09-01' }, db: d }, async () => { computed++; return BODY; });
  assert.equal(computed, 1);
  assert.equal(r.hit, 'miss');
  assert.deepEqual(r.body, BODY);
  assert.equal(r.text, JSON.stringify(BODY));
  assert.equal(r.warning, null);
  assert.ok(Date.now() - Date.parse(r.at) < 5000);
  assert.equal(d.calls.select.length, 1, 'one select for _version and the key');
  assert.match(d.calls.select[0].opts.params.key, /^in\.\("_version","v\d+:linkedin\?from=2026-09-01"\)$/);
  assert.equal(d.calls.upsert.length, 1);
  const row = d.calls.upsert[0].rows[0];
  assert.equal(row.key, cacheKey('linkedin', { from: '2026-09-01' }));
  assert.equal(row.body, JSON.stringify(BODY));
  assert.equal(row.bytes, JSON.stringify(BODY).length);
  const res = cacheResponse(r);
  assert.equal(res.headers.get('x-ca-cache'), 'miss');
  assert.equal(res.headers.get('x-ca-cached-at'), r.at);
  assert.equal(await res.text(), JSON.stringify(BODY));
});

test('hit within TTL returns the stored body without computing', async () => {
  const key = cacheKey('linkedin', { from: '2026-09-01' });
  const at = iso(Date.now() - 2 * H);
  const d = fakeDb([
    { key: VERSION_KEY, body: iso(Date.now() - 5 * H), at: iso(Date.now() - 5 * H) },
    { key, body: JSON.stringify({ perf: ['stored'] }), at },
  ]);
  let computed = 0;
  const r = await cachedGet(env, req(), { path: 'linkedin', params: { from: '2026-09-01' }, db: d }, async () => { computed++; return BODY; });
  assert.equal(computed, 0);
  assert.equal(r.hit, 'hit');
  assert.deepEqual(r.body, { perf: ['stored'] });
  assert.equal(r.at, at);
  assert.equal(d.calls.upsert.length, 0);
  assert.equal(cacheResponse(r).headers.get('x-ca-cache'), 'hit');
});

test('an entry older than _version is recomputed and overwritten', async () => {
  const key = cacheKey('linkedin', { from: '2026-09-01' });
  const d = fakeDb([
    { key: VERSION_KEY, body: iso(Date.now() - 1 * H), at: iso(Date.now() - 1 * H) },   // an upload an hour ago
    { key, body: JSON.stringify({ perf: ['stale'] }), at: iso(Date.now() - 3 * H) },   // stored before it
  ]);
  let computed = 0;
  const r = await cachedGet(env, req(), { path: 'linkedin', params: { from: '2026-09-01' }, db: d }, async () => { computed++; return BODY; });
  assert.equal(computed, 1);
  assert.equal(r.hit, 'miss');
  assert.deepEqual(r.body, BODY);
  assert.equal(d.store.get(key).body, JSON.stringify(BODY));
});

test('an entry past the TTL is recomputed', async () => {
  const key = cacheKey('linkedin', { from: '2026-09-01' });
  const d = fakeDb([{ key, body: JSON.stringify({ perf: ['old'] }), at: iso(Date.now() - DEFAULT_TTL_MS - 60000) }]);
  let computed = 0;
  const r = await cachedGet(env, req(), { path: 'linkedin', params: { from: '2026-09-01' }, db: d }, async () => { computed++; return BODY; });
  assert.equal(computed, 1);
  assert.equal(r.hit, 'miss');
  assert.equal(d.calls.upsert.length, 1);
  // A shorter ttlMs makes the same 2-hour-old entry stale too.
  const d2 = fakeDb([{ key, body: JSON.stringify({ perf: ['old'] }), at: iso(Date.now() - 2 * H) }]);
  const r2 = await cachedGet(env, req(), { path: 'linkedin', params: { from: '2026-09-01' }, ttlMs: H, db: d2 }, async () => BODY);
  assert.equal(r2.hit, 'miss');
});

test('x-ca-refresh: 1 bypasses a valid entry, recomputes and stores, and bumps nothing', async () => {
  const key = cacheKey('linkedin', { from: '2026-09-01' });
  const d = fakeDb([{ key, body: JSON.stringify({ perf: ['stored'] }), at: iso(Date.now() - 1000) }]);
  let computed = 0;
  const r = await cachedGet(env, req({ 'x-ca-refresh': '1' }), { path: 'linkedin', params: { from: '2026-09-01' }, db: d }, async () => { computed++; return BODY; });
  assert.equal(computed, 1);
  assert.equal(r.hit, 'bypass');
  assert.equal(d.calls.select.length, 0, 'no read on a bypass');
  assert.equal(d.calls.upsert.length, 1);
  assert.equal(d.store.get(key).body, JSON.stringify(BODY));
  assert.equal(d.store.has(VERSION_KEY), false);
  assert.equal(cacheResponse(r).headers.get('x-ca-cache'), 'bypass');
});

test('an oversized body is served but not stored', async () => {
  const d = fakeDb();
  const big = { rows: 'x'.repeat(5000) };
  const r = await cachedGet(env, req(), { path: 'linkedin', params: {}, maxBytes: 1000, db: d }, async () => big);
  assert.equal(r.hit, 'miss');
  assert.deepEqual(r.body, big);
  assert.equal(d.calls.upsert.length, 0);
  assert.equal(r.warning, null);
});

test('a read error (table missing) falls back to compute with the migration warning and skips the store', async () => {
  const d = fakeDb([], { failSelect: 'Database GET 404: relation "public.ca_cache" does not exist' });
  const body = { contacts: [], warnings: [] };
  const r = await cachedGet(env, req(), { path: 'hubspot', params: { from: '', to: '', all: '' }, db: d }, async () => body);
  assert.equal(r.hit, 'miss');
  assert.equal(r.warning, MIGRATION_WARNING);
  assert.deepEqual(r.body.warnings, [MIGRATION_WARNING], 'pushed into the body when it has a warnings array');
  assert.equal(JSON.parse(r.text).warnings[0], MIGRATION_WARNING);
  assert.equal(d.calls.upsert.length, 0);
  // A body without a warnings array is left untouched.
  const r2 = await cachedGet(env, req(), { path: 'linkedin', params: {}, db: fakeDb([], { failSelect: 'boom' }) }, async () => ({ perf: [] }));
  assert.deepEqual(r2.body, { perf: [] });
  assert.equal(r2.warning, MIGRATION_WARNING);
});

test('a store error never fails the request; an unconfigured database just computes', async () => {
  const d = fakeDb([], { failUpsert: 'Database POST 500' });
  const r = await cachedGet(env, req(), { path: 'coverage', db: d }, async () => BODY);
  assert.equal(r.hit, 'miss');
  assert.deepEqual(r.body, BODY);
  const r2 = await cachedGet({}, req(), { path: 'coverage' }, async () => BODY);
  assert.equal(r2.hit, 'miss');
  assert.equal(r2.warning, MIGRATION_WARNING);
});

test('the store is handed to waitUntil when one is given', async () => {
  const d = fakeDb();
  const deferred = [];
  const r = await cachedGet(env, req(), { path: 'coverage', db: d, waitUntil: (p) => deferred.push(p) }, async () => BODY);
  assert.equal(r.hit, 'miss');
  assert.equal(deferred.length, 1);
  await Promise.all(deferred);
  assert.equal(d.calls.upsert.length, 1);
});

test('bumpCacheVersion upserts _version with now and swallows errors', async () => {
  const d = fakeDb();
  assert.equal(await bumpCacheVersion(d), true);
  const v = d.store.get(VERSION_KEY);
  assert.ok(v && Date.now() - Date.parse(v.at) < 5000 && v.body === v.at);
  assert.equal(await bumpCacheVersion(fakeDb([], { failUpsert: 'no table' })), false);
  assert.equal(await bumpCacheVersion({}), false, 'no database configured');
  // After a bump, an entry stored just before it is ignored.
  const key = cacheKey('coverage');
  d.store.set(key, { key, body: JSON.stringify({ old: true }), at: iso(Date.parse(v.at) - 1000) });
  const r = await cachedGet(env, req(), { path: 'coverage', db: d }, async () => ({ fresh: true }));
  assert.equal(r.hit, 'miss');
  assert.deepEqual(r.body, { fresh: true });
});
