// node --test 'Campaign_Analytics/tests/backend/*.test.mjs'
// Pure helpers behind the workspace-wide Instantly sync and the email GET.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mapCampaign } from '../../../functions/api/ca/instantly/sync.js'
import { workspaceTotals } from '../../../functions/api/ca/email.js'

test('mapCampaign: gsi flag, name and status fall back to the analytics row', () => {
  const a = { campaign_id: 'x1', campaign_name: 'Fintech CFOs', campaign_status: 2, emails_sent_count: '120', contacted_count: 40, leads_count: 500, bounced_count: 3 }
  const g = mapCampaign({ id: 'x1', name: 'Fintech CFOs', status: 1 }, a, '2026-10-01T00:00:00Z')
  assert.equal(g.gsi, true)
  assert.equal(g.status, 1)
  const o = mapCampaign({ id: 'x1', name: a.campaign_name, status: a.campaign_status }, a, '2026-10-01T00:00:00Z', false)
  assert.equal(o.gsi, false)
  assert.deepEqual([o.id, o.name, o.status, o.sent, o.contacted, o.leads_count, o.bounced], ['x1', 'Fintech CFOs', 2, 120, 40, 500, 3])
  assert.equal(mapCampaign({ id: 9 }, null, 't').name, 'Untitled campaign')
  assert.equal(mapCampaign({ id: 9 }, null, 't').raw, null)
})

test('workspaceTotals: sums every campaign and counts the GSI ones', () => {
  assert.deepEqual(workspaceTotals([{ gsi: true, sent: 10, contacted: 4 }, { gsi: false, sent: '90', contacted: 30 }, { sent: 5, contacted: 'x' }]), { sent: 105, contacted: 34, campaigns: 3, gsi_campaigns: 2 })
  assert.deepEqual(workspaceTotals(null), { sent: 0, contacted: 0, campaigns: 0, gsi_campaigns: 0 })
})
