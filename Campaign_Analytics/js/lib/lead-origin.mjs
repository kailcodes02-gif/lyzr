// Where a HubSpot lead came from and what has been done with it, read from the contact properties the
// pull keeps in `props` (functions/api/ca/hubspot/refresh.js PROPS) and the engagements in `notes`.
// Pure functions, unit-tested; the Leads page, the lead drawer and the data API all read these.
//
// Origin: the portal records a lead's entry in several places at once, so every one is shown and a
// short `label` picks the most specific: the form (first_conversion_event_name, lead_form_type), the
// Lead Source enumeration (lead_source: Book a Demo, LinkedIn, a playbook title, an event...), the
// campaign (lead_campaign_name, utm_campaign, first_touch_utm_campaign, the converting campaign), the
// UTM set, HubSpot's original and latest traffic source with drill-downs, and the record source.
//
// Activity: a fixed checklist per lead (form, owner, status, contacted, sales email, call, sequence,
// LinkedIn outreach, reply, meeting, demo status, next activity, marketing email, note), each with the
// date it happened or "none", plus a timeline of every dated event.
import { outreachDates, repliedAt, isDemoBooked, isDemoCompleted, statusLabel, lifecycleLabel, contactedCount } from './leads-agg.mjs';

const tsOf = v => { if (v == null || v === '') return null; const n = Number(v); const d = Number.isFinite(n) && String(v).trim() === String(n) ? new Date(n) : new Date(v); return isNaN(d) ? null : d.toISOString(); };
const str = v => (v == null ? '' : String(v).trim());
const P = c => (c && c.props) || {};

export const TRAFFIC_LABEL = {
  ORGANIC_SEARCH: 'Organic search', PAID_SEARCH: 'Paid search', PAID_SOCIAL: 'Paid social', SOCIAL_MEDIA: 'Organic social',
  EMAIL_MARKETING: 'Email marketing', DIRECT_TRAFFIC: 'Direct', REFERRALS: 'Referral', OTHER_CAMPAIGNS: 'Other campaigns',
  OFFLINE: 'Offline (import, CRM, integration)', AI_REFERRALS: 'AI referral',
};
export const LAST_OUTREACH_LABEL = {
  email_first_outreach: 'Email: first outreach', email_follow_up: 'Email: follow-up', email_sequence_enrolled: 'Email: sequence enrolled',
  linkedin_connection_request: 'LinkedIn: connection request', linkedin_message_inmail: 'LinkedIn: message / InMail',
  phone_connected: 'Phone: connected', phone_no_answer: 'Phone: no answer / voicemail', whatsapp_message: 'WhatsApp message',
  video_message: 'Video message', meeting_scheduled: 'Meeting scheduled', meeting_completed: 'Meeting completed', demo_delivered: 'Demo delivered',
  proposal_pricing_shared: 'Proposal / pricing shared', collateral_shared: 'Collateral shared', internal_referral: 'Internal referral', no_response_exhausted: 'No response: sequence exhausted',
};
const traffic = v => { const s = str(v).toUpperCase(); return TRAFFIC_LABEL[s] || (s ? s.replace(/_/g, ' ').toLowerCase().replace(/^./, x => x.toUpperCase()) : ''); };

/** Everything the portal says about where this lead came from. */
export function originOf(c) {
  const p = P(c);
  const form = str(p.first_conversion_event_name), recentForm = str(p.recent_conversion_event_name);
  const formType = str(p.lead_form_type);
  const leadSource = str(c && c.lead_source) || str(p.lead_source) || str(p.lsa_lead_source);
  const utm = { source: str(p.utm_source) || str(p.first_touch_utm_source), medium: str(p.utm_medium) || str(p.first_touch_utm_medium), campaign: str(p.utm_campaign) || str(p.first_touch_utm_campaign), content: str(p.utm_content) };
  const campaignVia = str(p.lead_campaign_name) ? 'Lead Campaign Name' : utm.campaign ? 'UTM campaign' : str(p.hs_analytics_first_touch_converting_campaign) ? 'First touch converting campaign' : str(p.hs_analytics_last_touch_converting_campaign) ? 'Last touch converting campaign' : str(p.ad_campaign_id) ? 'Ad campaign id' : '';
  const campaign = str(p.lead_campaign_name) || utm.campaign || str(p.hs_analytics_first_touch_converting_campaign) || str(p.hs_analytics_last_touch_converting_campaign) || str(p.ad_campaign_id);
  const trafficSrc = traffic(c && c.source || p.hs_analytics_source);
  const trafficDetail = [str(p.hs_analytics_source_data_1), str(p.hs_analytics_source_data_2)].filter(Boolean).join(' › ') || str(c && c.source_detail);
  const latest = traffic(p.hs_latest_source), latestDetail = [str(p.hs_latest_source_data_1), str(p.hs_latest_source_data_2)].filter(Boolean).join(' › ');
  const label = form || leadSource || formType || campaign || trafficSrc || 'Unknown';
  return {
    form, formType, formAt: tsOf(p.first_conversion_date), recentForm, recentFormAt: tsOf(p.recent_conversion_date), submissions: Number(p.num_conversion_events) || (form ? 1 : 0), uniqueForms: Number(p.num_unique_conversion_events) || 0,
    leadSource, leadSourceCategory: str(p.lead_source_category),
    campaign, campaignVia, utm, adCampaignId: str(p.ad_campaign_id),
    traffic: trafficSrc, trafficDetail, latest, latestDetail, latestAt: tsOf(p.hs_latest_source_timestamp),
    recordSource: str(p.hs_object_source_label), conversionPage: str(p.conversion_page), product: str(p.lyzr_product),
    label,
  };
}
/** Short grouping keys for the origin tables. */
export const originForm = c => { const o = originOf(c); return o.form || (o.formType ? o.formType + ' (form type)' : 'No form name'); };
export const originSource = c => originOf(c).leadSource || 'No lead source';
export const originCampaign = c => originOf(c).campaign || 'No campaign';
export const originTraffic = c => originOf(c).traffic || 'Unknown';

/** rows -> [{ key, rows }] biggest first. */
export function groupRows(rows, keyFn) {
  const by = new Map();
  for (const r of rows || []) { const k = keyFn(r) || 'Unknown'; if (!by.has(k)) by.set(k, []); by.get(k).push(r); }
  return [...by.entries()].map(([key, list]) => ({ key, rows: list })).sort((a, b) => b.rows.length - a.rows.length || String(a.key).localeCompare(String(b.key)));
}

const noteKinds = (c, kind) => (c && c.notes || []).filter(n => String(n.kind || '').toLowerCase() === kind && n.created_at).sort((a, b) => a.created_at < b.created_at ? 1 : -1);

export const CHECKS = [
  { key: 'form', label: 'Form submitted', work: false },
  { key: 'owner', label: 'Owner assigned', work: false },
  { key: 'status', label: 'Lead status set', work: false },
  { key: 'contacted', label: 'Contacted (call, email or meeting logged)', work: true },
  { key: 'email_out', label: 'Sales email sent', work: true },
  { key: 'call', label: 'Call logged', work: true },
  { key: 'sequence', label: 'Sequence enrolled', work: true },
  { key: 'linkedin', label: 'LinkedIn outreach (HeyReach)', work: true },
  { key: 'reply', label: 'Replied', work: false },
  { key: 'meeting', label: 'Meeting booked', work: true },
  { key: 'demo', label: 'Demo or intro status', work: false },
  { key: 'next', label: 'Next activity scheduled', work: true },
  { key: 'marketing', label: 'Marketing email opened or clicked', work: false },
  { key: 'note', label: 'Note added', work: true },
];
/** [{ key, label, work, done, at, detail }] for one lead, in CHECKS order. */
export function activityChecklist(c) {
  const p = P(c);
  const o = originOf(c);
  const emails = noteKinds(c, 'email'), calls = noteKinds(c, 'call'), meetings = noteKinds(c, 'meeting'), notes = noteKinds(c, 'note'), replies = noteKinds(c, 'email_in');
  const outreach = outreachDates(c);
  const lastOut = str(p.last_outreach_activity);
  const seqN = Number(p.hs_sequences_enrolled_count) || 0;
  const hey = tsOf(p.heyreach_last_activity_date) || tsOf(p.heyreach_first_reply_date);
  const replied = repliedAt(c) || (replies[0] && replies[0].created_at) || tsOf(p.heyreach_last_reply_date) || tsOf(p.hs_email_last_reply_date);
  const meeting = tsOf(p.hs_last_booked_meeting_date) || tsOf(p.engagements_last_meeting_booked) || (meetings[0] && meetings[0].created_at);
  const mkt = tsOf(p.hs_email_last_click_date) || tsOf(p.hs_email_last_open_date);
  const val = {
    form: { done: !!o.formAt || !!o.form, at: o.recentFormAt || o.formAt, detail: [o.recentForm || o.form, o.submissions > 1 ? `${o.submissions} submissions` : ''].filter(Boolean).join(' · ') },
    owner: { done: !!(c.owner_name || c.owner_id), at: null, detail: c.owner_name || (c.owner_id ? 'owner id ' + c.owner_id : '') },
    status: { done: !!str(c.lead_status), at: null, detail: [statusLabel(c.lead_status), lifecycleLabel(c.lifecycle) ? 'lifecycle ' + lifecycleLabel(c.lifecycle) : ''].filter(Boolean).join(' · ') },
    contacted: { done: contactedCount(c) > 0 || outreach.length > 0, at: outreach.length ? outreach[outreach.length - 1] : null, detail: [contactedCount(c) ? `${contactedCount(c)} time${contactedCount(c) === 1 ? '' : 's'}` : '', lastOut ? 'last: ' + (LAST_OUTREACH_LABEL[lastOut] || lastOut) : ''].filter(Boolean).join(' · ') },
    email_out: { done: emails.length > 0 || /^email_/.test(lastOut) || /^email$/i.test(str(c.last_activity_type)), at: emails[0] ? emails[0].created_at : (/^email_/.test(lastOut) ? tsOf(p.notes_last_contacted) : /^email$/i.test(str(c.last_activity_type)) ? tsOf(c.last_activity_at) : null), detail: emails.length ? `${emails.length} logged${emails[0].body ? ': ' + String(emails[0].body).replace(/\s+/g, ' ').slice(0, 80) : ''}` : (/^email_/.test(lastOut) ? LAST_OUTREACH_LABEL[lastOut] : '') },
    call: { done: calls.length > 0 || /^phone_/.test(lastOut) || /^call$/i.test(str(c.last_activity_type)), at: calls[0] ? calls[0].created_at : /^call$/i.test(str(c.last_activity_type)) ? tsOf(c.last_activity_at) : null, detail: calls.length ? `${calls.length} logged` : (/^phone_/.test(lastOut) ? LAST_OUTREACH_LABEL[lastOut] : '') },
    sequence: { done: seqN > 0 || String(p.hs_sequences_is_enrolled).toLowerCase() === 'true' || lastOut === 'email_sequence_enrolled', at: tsOf(p.hs_latest_sequence_enrolled_date), detail: [seqN ? `${seqN} sequence${seqN === 1 ? '' : 's'}` : '', str(p.hs_latest_sequence_enrolled), String(p.hs_sequences_is_enrolled).toLowerCase() === 'true' ? 'in a sequence now' : tsOf(p.hs_latest_sequence_ended_date) ? 'ended' : ''].filter(Boolean).join(' · ') },
    linkedin: { done: !!hey || /^linkedin_/.test(lastOut), at: hey, detail: [Number(p.heyreach_reply_count) ? `${p.heyreach_reply_count} HeyReach repl${Number(p.heyreach_reply_count) === 1 ? 'y' : 'ies'}` : '', /^linkedin_/.test(lastOut) ? LAST_OUTREACH_LABEL[lastOut] : ''].filter(Boolean).join(' · ') },
    reply: { done: !!replied, at: replied, detail: replies[0] ? (/^\[auto\]/.test(String(replies[0].body || '')) ? 'automatic reply' : 'wrote back') + (replies[0].body ? ': ' + String(replies[0].body).replace(/^\[auto\]\s*/, '').replace(/\s+/g, ' ').slice(0, 80) : '') : (Number(c.replies_human) ? 'human reply' : Number(c.replies_auto) ? 'automatic reply only' : '') },
    meeting: { done: !!meeting, at: meeting, detail: [str(p.first_meeting_booked_by) ? 'booked by ' + p.first_meeting_booked_by : '', str(p.engagements_last_meeting_booked_campaign)].filter(Boolean).join(' · ') },
    demo: { done: isDemoBooked(c), at: null, detail: isDemoCompleted(c) ? 'completed: ' + statusLabel(c.lead_status) : isDemoBooked(c) ? statusLabel(c.lead_status) || lifecycleLabel(c.lifecycle) : '' },
    next: { done: !!tsOf(p.notes_next_activity_date), at: tsOf(p.notes_next_activity_date), detail: tsOf(p.notes_next_activity_date) && tsOf(p.notes_next_activity_date) < new Date().toISOString() ? 'overdue' : '' },
    marketing: { done: !!mkt, at: mkt, detail: [str(p.hs_email_last_email_name), tsOf(p.hs_email_last_click_date) ? 'clicked' : 'opened'].filter(Boolean).join(' · ') },
    note: { done: notes.length > 0, at: notes[0] ? notes[0].created_at : null, detail: notes.length ? `${notes.length} note${notes.length === 1 ? '' : 's'}` : '' },
  };
  return CHECKS.map(k => ({ ...k, ...(val[k.key] || { done: false, at: null, detail: '' }) }));
}
/** The sales-work checks nobody has done yet, as labels. */
export const missingWork = c => activityChecklist(c).filter(k => k.work && !k.done).map(k => k.label);
/** Short glyph summary: e.g. "email ✓ · call ✗ · meeting ✗". */
export const SHORT = { email_out: 'email', call: 'call', sequence: 'sequence', linkedin: 'LinkedIn', meeting: 'meeting', reply: 'reply' };
export function workSummary(c) { const m = new Map(activityChecklist(c).map(k => [k.key, k.done])); return Object.entries(SHORT).map(([k, l]) => ({ key: k, label: l, done: !!m.get(k) })); }

/** Every dated thing that happened with the lead, newest first: [{ ts, label, detail, kind }]. */
export function timeline(c) {
  const p = P(c); const out = [];
  const push = (ts, label, detail = '', kind = 'prop') => { const t = tsOf(ts); if (t) out.push({ ts: t, label, detail: String(detail || '').replace(/\s+/g, ' ').slice(0, 220), kind }); };
  push(c.created_at, 'Created in HubSpot', originOf(c).recordSource ? 'record source ' + originOf(c).recordSource : '');
  push(p.first_conversion_date, 'Form submitted', p.first_conversion_event_name || '');
  if (p.recent_conversion_date && tsOf(p.recent_conversion_date) !== tsOf(p.first_conversion_date)) push(p.recent_conversion_date, 'Form submitted again', p.recent_conversion_event_name || '');
  push(p.lead_form_submission_date && tsOf(p.lead_form_submission_date) !== tsOf(p.recent_conversion_date) ? p.lead_form_submission_date : null, 'Lead form submitted', p.lead_form_type || '');
  push(p.hs_lifecyclestage_lead_date, 'Became a lead'); push(p.hs_lifecyclestage_marketingqualifiedlead_date, 'Became an MQL'); push(p.hs_lifecyclestage_salesqualifiedlead_date, 'Became an SQL'); push(p.hs_lifecyclestage_opportunity_date, 'Became an opportunity'); push(p.hs_lifecyclestage_customer_date, 'Became a customer');
  push(p.hs_sa_first_engagement_date, 'First engagement by the owner', [p.hs_sa_first_engagement_object_type, p.hs_sa_first_engagement_descr].filter(Boolean).join(': '));
  push(p.hs_latest_sequence_enrolled_date, 'Enrolled in a sequence', p.hs_latest_sequence_enrolled || ''); push(p.hs_latest_sequence_ended_date, 'Sequence ended');
  push(p.notes_last_contacted, 'Last contacted', p.last_outreach_activity ? LAST_OUTREACH_LABEL[p.last_outreach_activity] || p.last_outreach_activity : '');
  push(p.hs_sales_email_last_replied, 'Replied to a sales email'); push(p.hs_email_last_reply_date, 'Replied to a marketing email');
  push(p.hs_last_booked_meeting_date, 'Meeting booked'); push(p.engagements_last_meeting_booked && tsOf(p.engagements_last_meeting_booked) !== tsOf(p.hs_last_booked_meeting_date) ? p.engagements_last_meeting_booked : null, 'Meeting booked (meetings tool)');
  push(p.hs_email_last_send_date, 'Marketing email sent', p.hs_email_last_email_name || ''); push(p.hs_email_last_open_date, 'Marketing email opened', p.hs_email_last_email_name || ''); push(p.hs_email_last_click_date, 'Marketing email clicked', p.hs_email_last_email_name || '');
  push(p.heyreach_first_reply_date, 'LinkedIn reply (HeyReach)'); push(p.heyreach_last_activity_date, 'LinkedIn activity (HeyReach)');
  push(p.hs_latest_source_timestamp, 'Latest visit', [traffic(p.hs_latest_source), p.hs_latest_source_data_1].filter(Boolean).join(' · '));
  push(p.notes_next_activity_date, 'Next activity due', '', 'next');
  if (c.last_activity_at) push(c.last_activity_at, 'Last sales activity', c.last_activity_type || '');
  const KIND = { note: 'Note', email: 'Sales email sent', call: 'Call', meeting: 'Meeting', task: 'Task', email_in: 'Email received' };
  for (const n of c.notes || []) { const body = String(n.body || ''); push(n.created_at, n.kind === 'email_in' && /^\[auto\]/.test(body) ? 'Automatic reply received' : KIND[n.kind] || n.kind || 'Activity', body.replace(/^\[auto\]\s*/, ''), 'note'); }
  const seen = new Set();
  return out.filter(e => { const k = e.ts + '|' + e.label; if (seen.has(k)) return false; seen.add(k); return true; }).sort((a, b) => a.ts < b.ts ? 1 : -1);
}
/** Compact origin + activity for one lead (the data API). */
export function leadFacts(c) {
  const o = originOf(c);
  return { origin: o.label, form: o.form, form_type: o.formType, lead_source: o.leadSource, campaign: o.campaign, campaign_via: o.campaignVia, utm: o.utm, traffic_source: o.traffic, traffic_detail: o.trafficDetail, latest_source: o.latest, record_source: o.recordSource, checklist: Object.fromEntries(activityChecklist(c).map(k => [k.key, k.done ? (k.at || true) : false])), missing_work: missingWork(c) };
}
