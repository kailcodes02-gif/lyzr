import test from 'node:test'
import assert from 'node:assert/strict'
import { dedupeByKey } from '../../../functions/api/ca/_lib/db.js'

test('upsert dedupe: rows sharing the conflict key merge into one (later fields win), order kept', () => {
  const rows = [{ id: 'email-1', contact_id: 'a', body: 'x' }, { id: 'n-2' }, { id: 'email-1', contact_id: 'b' }]
  assert.deepEqual(dedupeByKey(rows, ['id']), [{ id: 'email-1', contact_id: 'b', body: 'x' }, { id: 'n-2' }])
})

test('upsert dedupe: composite keys compare every column', () => {
  const rows = [{ day: 'd1', ad_id: 1, v: 1 }, { day: 'd1', ad_id: 2, v: 2 }, { day: 'd1', ad_id: 1, v: 3 }]
  assert.deepEqual(dedupeByKey(rows, ['day', 'ad_id']).map((r) => r.v), [3, 2])
})
