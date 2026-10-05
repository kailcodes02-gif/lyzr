// Where a lead came from (form, lead source, campaign, UTM, traffic) and the activity checklist / timeline.
import test from 'node:test';
import assert from 'node:assert/strict';
import { originOf, originForm, originSource, originCampaign, originTraffic, groupRows, activityChecklist, missingWork, workSummary, timeline, leadFacts, CHECKS } from '../../js/lib/lead-origin.mjs';

const lead = (props = {}, extra = {}) => ({ hs_id: '1', first_name: 'A', last_name: 'B', email: 'a@ey.com', account: 'EY', jobtitle: 'Partner', band: 'MD', lead_source: 'Book a Demo', source: 'PAID_SOCIAL', source_detail: 'LinkedIn', lead_status: 'Working', lifecycle: 'lead', owner_name: 'Anju', created_at: '2026-09-01T10:00:00Z', notes: [], props: { first_conversion_event_name: 'Book a Demo', first_conversion_date: '2026-09-01T10:00:00Z', hs_analytics_source: 'PAID_SOCIAL', hs_analytics_source_data_1: 'LinkedIn', ...props }, ...extra });

test('originOf: form, lead source, campaign precedence and traffic source', () => {
  const o = originOf(lead({ lead_form_type: 'Book a Demo', lead_campaign_name: 'GSI Q3', utm_campaign: 'utm-x', utm_source: 'linkedin', utm_medium: 'paid-social', hs_analytics_first_touch_converting_campaign: 'conv', hs_object_source_label: 'FORM', hs_latest_source: 'ORGANIC_SEARCH', hs_latest_source_data_1: 'google' }));
  assert.equal(o.form, 'Book a Demo'); assert.equal(o.formType, 'Book a Demo'); assert.equal(o.leadSource, 'Book a Demo');
  assert.equal(o.campaign, 'GSI Q3'); assert.equal(o.campaignVia, 'Lead Campaign Name');
  assert.deepEqual(o.utm, { source: 'linkedin', medium: 'paid-social', campaign: 'utm-x', content: '' });
  assert.equal(o.traffic, 'Paid social'); assert.equal(o.trafficDetail, 'LinkedIn'); assert.equal(o.latest, 'Organic search'); assert.equal(o.latestDetail, 'google'); assert.equal(o.recordSource, 'FORM');
  assert.equal(o.label, 'Book a Demo');
  // UTM campaign, then converting campaign, then ad id, when no Lead Campaign Name
  assert.equal(originOf(lead({ utm_campaign: 'utm-x', hs_analytics_first_touch_converting_campaign: 'conv' })).campaignVia, 'UTM campaign');
  assert.equal(originOf(lead({ first_touch_utm_campaign: 'first' })).campaign, 'first');
  assert.equal(originOf(lead({ hs_analytics_last_touch_converting_campaign: 'last' })).campaignVia, 'Last touch converting campaign');
  assert.equal(originOf(lead({ ad_campaign_id: '123' })).campaign, '123');
  assert.equal(originOf(lead({}, { lead_source: '' })).label, 'Book a Demo', 'form name labels the lead');
  assert.equal(originOf(lead({ first_conversion_event_name: '' }, { lead_source: '' })).label, 'Paid social', 'falls back to the traffic source');
  assert.equal(originOf({ props: {} }).label, 'Unknown');
});

test('origin grouping keys and groupRows ordering', () => {
  const rows = [lead(), lead({ first_conversion_event_name: 'Playbook' }, { hs_id: '2', lead_source: '100+ AI Use Cases' }), lead({}, { hs_id: '3' }), lead({ first_conversion_event_name: '' }, { hs_id: '4', lead_source: '' })];
  assert.deepEqual(groupRows(rows, originForm).map(g => [g.key, g.rows.length]), [['Book a Demo', 2], ['No form name', 1], ['Playbook', 1]]);
  assert.deepEqual(groupRows(rows, originSource).map(g => g.key), ['Book a Demo', '100+ AI Use Cases', 'No lead source']);
  assert.equal(groupRows(rows, originCampaign)[0].key, 'No campaign');
  assert.equal(groupRows(rows, originTraffic)[0].key, 'Paid social');
  assert.deepEqual(groupRows([], originForm), []);
});

test('activityChecklist: dated when done, none when not; notes feed the email/call/note rows', () => {
  const quiet = activityChecklist(lead());
  assert.equal(quiet.length, CHECKS.length);
  const by = Object.fromEntries(quiet.map(k => [k.key, k]));
  assert.equal(by.form.done, true); assert.equal(by.form.at, '2026-09-01T10:00:00.000Z');
  assert.equal(by.owner.done, true); assert.equal(by.status.done, true);
  for (const k of ['contacted', 'email_out', 'call', 'sequence', 'linkedin', 'reply', 'meeting', 'demo', 'next', 'marketing', 'note']) assert.equal(by[k].done, false, k);
  assert.deepEqual(missingWork(lead()), ['Contacted (call, email or meeting logged)', 'Sales email sent', 'Call logged', 'Sequence enrolled', 'LinkedIn outreach (HeyReach)', 'Meeting booked', 'Next activity scheduled', 'Note added']);
  const busy = lead({ num_contacted_notes: 2, notes_last_contacted: '2026-09-03T09:00:00Z', last_outreach_activity: 'email_follow_up', hs_sequences_enrolled_count: 1, hs_latest_sequence_enrolled_date: '2026-09-02T09:00:00Z', heyreach_last_activity_date: '2026-09-04T09:00:00Z', heyreach_reply_count: 1, hs_sales_email_last_replied: '2026-09-05T09:00:00Z', hs_last_booked_meeting_date: '2026-09-06T09:00:00Z', notes_next_activity_date: '2099-01-01T09:00:00Z', hs_email_last_open_date: '2026-09-02T12:00:00Z', hs_email_last_email_name: 'Newsletter' }, { lead_status: 'Demo Booked', notes: [{ kind: 'email', created_at: '2026-09-02T09:00:00Z', body: 'Intro email' }, { kind: 'call', created_at: '2026-09-03T09:00:00Z', body: 'Spoke' }, { kind: 'note', created_at: '2026-09-03T10:00:00Z', body: 'Keen' }] });
  const b2 = Object.fromEntries(activityChecklist(busy).map(k => [k.key, k]));
  assert.equal(b2.contacted.done, true); assert.ok(b2.contacted.detail.includes('2 times') && b2.contacted.detail.includes('Email: follow-up'));
  assert.equal(b2.email_out.at, '2026-09-02T09:00:00Z'); assert.ok(b2.email_out.detail.includes('Intro email'));
  assert.equal(b2.call.done, true); assert.equal(b2.sequence.done, true); assert.equal(b2.linkedin.done, true); assert.ok(b2.linkedin.detail.includes('1 HeyReach reply'));
  assert.equal(b2.reply.at, '2026-09-05T09:00:00.000Z'); assert.equal(b2.meeting.done, true); assert.equal(b2.demo.done, true); assert.equal(b2.demo.detail, 'Demo Booked');
  assert.equal(b2.next.done, true); assert.equal(b2.next.detail, ''); assert.equal(b2.marketing.done, true); assert.ok(b2.marketing.detail.includes('Newsletter')); assert.equal(b2.note.done, true);
  assert.deepEqual(missingWork(busy), []);
  assert.deepEqual(workSummary(busy).map(w => w.done), [true, true, true, true, true, true]);
  // the portal's last_outreach_activity alone marks an email or a call as done
  const onlyProp = Object.fromEntries(activityChecklist(lead({ last_outreach_activity: 'phone_connected' })).map(k => [k.key, k]));
  assert.equal(onlyProp.call.done, true); assert.equal(onlyProp.call.detail, 'Phone: connected'); assert.equal(onlyProp.email_out.done, false);
  // an overdue next activity says so; an automatic reply is named
  const over = Object.fromEntries(activityChecklist(lead({ notes_next_activity_date: '2020-01-01T00:00:00Z' }, { notes: [{ kind: 'email_in', created_at: '2026-09-02T00:00:00Z', body: '[auto] Out of office' }] })).map(k => [k.key, k]));
  assert.equal(over.next.detail, 'overdue'); assert.ok(over.reply.detail.startsWith('automatic reply'));
});

test('timeline: every dated property and note once, newest first', () => {
  const t = timeline(lead({ recent_conversion_date: '2026-09-10T00:00:00Z', recent_conversion_event_name: 'Playbook', hs_lifecyclestage_marketingqualifiedlead_date: '2026-09-11T00:00:00Z', notes_last_contacted: '2026-09-03T09:00:00Z', last_outreach_activity: 'linkedin_message_inmail', hs_latest_source_timestamp: '2026-09-12T00:00:00Z', hs_latest_source: 'DIRECT_TRAFFIC', hs_object_source_label: 'FORM' }, { notes: [{ kind: 'call', created_at: '2026-09-03T09:00:00Z', body: 'Spoke' }, { kind: 'email_in', created_at: '2026-09-04T09:00:00Z', body: '[auto] away' }] }));
  assert.equal(t[0].label, 'Latest visit'); assert.equal(t[0].detail, 'Direct');
  assert.ok(t.some(e => e.label === 'Became an MQL') && t.some(e => e.label === 'Form submitted again' && e.detail === 'Playbook'));
  assert.ok(t.some(e => e.label === 'Last contacted' && e.detail === 'LinkedIn: message / InMail'));
  assert.ok(t.some(e => e.label === 'Automatic reply received' && e.detail === 'away'));
  assert.equal(t.filter(e => e.label === 'Created in HubSpot').length, 1); assert.ok(t.find(e => e.label === 'Created in HubSpot').detail.includes('FORM'));
  for (let i = 1; i < t.length; i++) assert.ok(t[i - 1].ts >= t[i].ts, 'sorted desc');
  assert.deepEqual(timeline({ props: {} }), []);
});

test('leadFacts: compact origin + checklist for the data API', () => {
  const f = leadFacts(lead({ lead_campaign_name: 'GSI Q3', num_contacted_notes: 1, notes_last_contacted: '2026-09-03T09:00:00Z' }));
  assert.equal(f.origin, 'Book a Demo'); assert.equal(f.campaign, 'GSI Q3'); assert.equal(f.traffic_source, 'Paid social');
  assert.equal(f.checklist.contacted, '2026-09-03T09:00:00.000Z'); assert.equal(f.checklist.call, false); assert.equal(f.checklist.owner, true);
  assert.ok(f.missing_work.includes('Call logged') && !f.missing_work.includes('Contacted (call, email or meeting logged)'));
});
