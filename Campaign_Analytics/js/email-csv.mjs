// Instantly per-campaign analytics CSV ("<Campaign>_analytics_DD_MM_YYYY, HH_MM_SS.csv").
// Columns: Associated account, Contact, Step, Event, Link Clicked, Created At.
// One row per event. The export is cumulative for the campaign, so uploading a
// newer export of the same campaign only adds what is new (the server key is
// campaign + contact + step + event + time + link).
//
// parseInstantlyCsv(text, fileName) ->
//   { channel:'email', kind:'events', campaign, rows:[{campaign, contact, step, event, ts, sender, link, lag_s, raw_event}],
//     stats:{ events, sent, opened, clicked, other, contacts, from, to }, warnings:[], columns }
import { parseRows, detectDelimiter, normHeader } from './csv.mjs';

const FIELDS = {
  sender: ['associatedaccount', 'account', 'sendingaccount', 'fromemail', 'sender'],
  contact: ['contact', 'leademail', 'email', 'lead'],
  step: ['step', 'sequencestep'],
  event: ['event', 'eventtype', 'type'],
  link: ['linkclicked', 'link', 'url'],
  ts: ['createdat', 'timestamp', 'date', 'time'],
};
const REQUIRED = ['contact', 'event', 'ts'];

/** True when the header row looks like an Instantly event export. */
export function isInstantlyHeader(headers) {
  const h = new Set((headers || []).map(normHeader));
  return h.has('contact') && h.has('event') && (h.has('createdat') || h.has('timestamp')) && (h.has('associatedaccount') || h.has('step') || h.has('linkclicked'));
}

/** Campaign name from the export file name. Keeps Instantly's own spelling (underscores and all) so it matches the API. */
export function campaignFromFile(name) {
  let s = String(name || '').replace(/^.*[\\/]/, '').replace(/\.(csv|txt|tsv)$/i, '');
  s = s.replace(/_analytics_\d{1,2}_\d{1,2}_\d{4}.*$/i, '').replace(/\s*\(\d+\)\s*$/, '');
  return s.trim() || 'Untitled campaign';
}
/** Human label for a campaign name: underscores to spaces, collapsed. */
export const campaignLabel = name => String(name || '').replace(/_/g, ' ').replace(/\s+-\s+/g, ' - ').replace(/\s{2,}/g, ' ').trim();

export function eventCode(raw) {
  const e = String(raw || '').toLowerCase().replace(/[^a-z]/g, '');
  if (e === 'sent' || e === 'emailsent') return 'sent';
  if (e === 'opened' || e === 'open' || e === 'emailopened') return 'opened';
  if (e.includes('click')) return 'clicked';
  if (e.includes('bounce')) return 'bounced';
  if (e.includes('autoreply') || e.includes('outofoffice')) return 'auto_reply';
  if (e.includes('repl')) return 'replied';
  if (e.includes('unsub')) return 'unsubscribed';
  return 'other';
}

export function parseInstantlyCsv(text, fileName = '') {
  const lines = String(text || '').replace(/^﻿/, '').split(/\r?\n/);
  const first = lines.findIndex(l => l.trim());
  if (first < 0) throw new Error('The file is empty.');
  const delim = detectDelimiter(lines[first]);
  const table = parseRows(lines.slice(first).join('\n'), delim);
  const headers = table[0] || [];
  if (!isInstantlyHeader(headers)) throw new Error('Not an Instantly analytics export (expected Contact, Event and Created At columns).');
  const idx = {};
  const columns = {};
  headers.forEach((h, i) => {
    const n = normHeader(h);
    for (const [f, syn] of Object.entries(FIELDS)) if (idx[f] === undefined && syn.includes(n)) { idx[f] = i; columns[h] = f; }
  });
  const missing = REQUIRED.filter(f => idx[f] === undefined);
  if (missing.length) throw new Error('Missing columns: ' + missing.join(', '));
  const campaign = campaignFromFile(fileName);
  const warnings = [];
  const rows = [];
  let bad = 0;
  for (const r of table.slice(1)) {
    if (!r || !r.some(c => String(c).trim())) continue;
    const get = f => idx[f] === undefined ? '' : String(r[idx[f]] ?? '').trim();
    const contact = get('contact').toLowerCase();
    const t = Date.parse(get('ts'));
    if (!contact || Number.isNaN(t)) { bad++; continue; }
    const raw = get('event');
    const step = parseInt(String(get('step')).replace(/[^0-9]/g, ''), 10);
    const event = eventCode(raw);
    rows.push({ campaign, contact, step: Number.isFinite(step) ? step : 0, event, ts: new Date(t).toISOString(), sender: get('sender').toLowerCase(), link: event === 'clicked' ? get('link') : '', lag_s: null, raw_event: raw });
  }
  if (bad) warnings.push(`${bad} row${bad === 1 ? '' : 's'} had no contact or no valid time and were skipped.`);
  // Seconds from the Sent of the same contact + step to each click: the fast-click (scanner) signal.
  const sentAt = new Map();
  for (const r of rows) if (r.event === 'sent') { const k = r.contact + '|' + r.step; const t = Date.parse(r.ts); if (!sentAt.has(k) || t < sentAt.get(k)) sentAt.set(k, t); }
  for (const r of rows) if (r.event === 'clicked') { const s = sentAt.get(r.contact + '|' + r.step); if (s != null) r.lag_s = Math.round((Date.parse(r.ts) - s) / 1000); }
  const count = e => rows.filter(r => r.event === e).length;
  const ts = rows.map(r => r.ts).sort();
  const stats = { events: rows.length, sent: count('sent'), opened: count('opened'), clicked: count('clicked'), other: rows.length - count('sent') - count('opened') - count('clicked'), contacts: new Set(rows.map(r => r.contact)).size, from: ts[0] ? ts[0].slice(0, 10) : null, to: ts.length ? ts[ts.length - 1].slice(0, 10) : null };
  if (!rows.length) warnings.push('No events found in the file.');
  const noOpenSteps = [...new Set(rows.filter(r => r.event === 'sent').map(r => r.step))].filter(st => !rows.some(r => r.event === 'opened' && r.step === st) && rows.some(r => r.event === 'clicked' && r.step === st));
  if (noOpenSteps.length) warnings.push(`Step ${noOpenSteps.join(', ')} ha${noOpenSteps.length === 1 ? 's' : 've'} clicks but no opens: open tracking looks off for ${noOpenSteps.length === 1 ? 'that step' : 'those steps'}, so opens under-report.`);
  return { channel: 'email', kind: 'events', campaign, rows, stats, warnings, columns, delimiter: delim };
}
