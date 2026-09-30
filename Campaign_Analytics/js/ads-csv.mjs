// Ad exports from platforms other than LinkedIn (Google Ads, Meta, Microsoft Bing,
// Taboola, X, ChatGPT). Same output shape as the LinkedIn performance parser so the
// rows land in ca_li_perf with a `platform` value: one row per campaign (or ad) per day.
//
// detectPlatform(headers, fileName) -> 'google' | 'meta' | 'bing' | 'taboola' | 'x' | 'chatgpt' | null
// parseAdsCsv(text, fileName, platform?) -> { kind:'performance', platform, rows, columns, warnings, preamble, delimiter, period_start, period_end }
import { parseRows, detectDelimiter, normHeader, num, parseDate } from './csv.mjs';

export const PLATFORM_LABEL = { linkedin: 'LinkedIn', google: 'Google Ads', meta: 'Meta', bing: 'Microsoft Bing', taboola: 'Taboola', x: 'X (Twitter)', chatgpt: 'ChatGPT ads' };

// Header synonyms per field (keys lower-cased, non-letters stripped by normHeader).
const FIELDS = {
  day: ['day', 'date', 'reportingstarts', 'gregoriandate', 'timeperiod', 'daystart', 'startdate', 'reportdate'],
  campaign_group: ['campaigngroup', 'account', 'accountname', 'adaccountname'],
  campaign: ['campaign', 'campaignname'],
  campaign_id: ['campaignid'],
  ad_group: ['adgroup', 'adgroupname', 'adsetname', 'adset', 'lineitem'],
  ad_id: ['adid', 'creativeid', 'itemid'],
  ad_name: ['adname', 'ad', 'creative', 'creativename', 'headline', 'itemname', 'title'],
  objective: ['objective', 'campaignobjective', 'campaigntype', 'goal'],
  format: ['adformat', 'format', 'adtype', 'creativetype'],
  impressions: ['impressions', 'impr', 'imprs', 'visibleimpressions'],
  clicks: ['clicks', 'linkclicks', 'clicksall', 'allclicks', 'totalclicks'],
  spend: ['spend', 'cost', 'spent', 'amountspent', 'amountspentusd', 'amountspentinr', 'totalspent', 'costusd'],
  reach: ['reach', 'uniqueusers', 'uniquereach'],
  leads: ['leads', 'conversions', 'results', 'allconv', 'allconversions', 'conv', 'leadformsubmissions'],
  video_views: ['videoviews', 'views', 'threesecondvideoplays', 'videoplays'],
  engagements: ['engagements', 'postengagement', 'postengagements', 'interactions', 'totalengagements'],
  landing_page_views: ['landingpageviews', 'lpviews'],
  frequency: ['frequency'],
};

/** Which platform an export comes from, from its header row (file name breaks ties). */
export function detectPlatform(headers, fileName = '') {
  const h = new Set((headers || []).map(normHeader));
  const f = String(fileName || '').toLowerCase();
  if (h.has('reportingstarts') || h.has('amountspentusd') || h.has('amountspent') || (h.has('adsetname') && h.has('reach'))) return 'meta';
  if (h.has('gregoriandate') || /bing|microsoft/.test(f)) return 'bing';
  if (h.has('spent') && (h.has('visibleimpressions') || h.has('campaignid') || /taboola/.test(f))) return 'taboola';
  if (h.has('timeperiod') || (/\bx\b|twitter/.test(f) && h.has('spend'))) return 'x';
  if (h.has('impr') || h.has('imprs') || (h.has('cost') && h.has('campaign') && (h.has('day') || h.has('date'))) || /google/.test(f)) return 'google';
  if (/chatgpt|openai/.test(f) && (h.has('spend') || h.has('cost'))) return 'chatgpt';
  return null;
}

export function parseAdsCsv(text, fileName = '', platform = null) {
  const lines = String(text || '').replace(/^﻿/, '').split(/\r?\n/);
  // Google and Bing exports start with a title and a date-range line; the header
  // is the first line that has a day column and a campaign or ad column.
  let headerIdx = -1, headers = [], delim = ',';
  for (let i = 0; i < Math.min(lines.length, 12); i++) {
    if (!lines[i].trim()) continue;
    const d = detectDelimiter(lines[i]);
    const cells = (parseRows(lines[i], d)[0] || []).map(normHeader);
    if (FIELDS.day.some(x => cells.includes(x)) && (FIELDS.campaign.some(x => cells.includes(x)) || FIELDS.ad_name.some(x => cells.includes(x)))) { headerIdx = i; headers = parseRows(lines[i], d)[0]; delim = d; break; }
  }
  if (headerIdx < 0) throw new Error('No header row with a date and a campaign column was found.');
  platform = platform || detectPlatform(headers, fileName);
  if (!platform) throw new Error('Could not tell which ad platform this export is from.');
  const preamble = lines.slice(0, headerIdx).filter(l => l.trim());
  const table = parseRows(lines.slice(headerIdx).join('\n'), delim);
  const idx = {}, columns = {};
  headers.forEach((h, i) => { const n = normHeader(h); for (const [f, syn] of Object.entries(FIELDS)) if (idx[f] === undefined && syn.includes(n)) { idx[f] = i; columns[h] = f; } });
  const get = (r, f) => idx[f] === undefined ? '' : String(r[idx[f]] ?? '').trim();
  const rows = [], warnings = [];
  let bad = 0;
  for (const r of table.slice(1)) {
    if (!r || !r.some(c => String(c).trim())) continue;
    const rawDay = get(r, 'day');
    if (/^total/i.test(rawDay) || /^total/i.test(get(r, 'campaign'))) continue;
    const day = parseDate(rawDay);
    if (!day) { bad++; continue; }
    const campaign = get(r, 'campaign') || get(r, 'ad_group') || '(no campaign)';
    const adName = get(r, 'ad_name') || get(r, 'ad_group') || '';
    const row = {
      day,
      campaign_id: get(r, 'campaign_id') || campaign,
      ad_id: get(r, 'ad_id') || (adName ? campaign + '|' + adName : ''),
      campaign_group: get(r, 'campaign_group') || PLATFORM_LABEL[platform],
      campaign,
      ad_name: adName || campaign,
      objective: get(r, 'objective') || null,
      format: get(r, 'format') || null,
      impressions: num(get(r, 'impressions')),
      clicks: num(get(r, 'clicks')),
      spend: num(get(r, 'spend')),
      reach: num(get(r, 'reach')),
      leads: num(get(r, 'leads')),
      video_views: num(get(r, 'video_views')),
      engagements: num(get(r, 'engagements')),
      conversions: num(get(r, 'leads')),
    };
    const lpv = get(r, 'landing_page_views'); if (lpv) row.landing_page_views = num(lpv);
    const fq = get(r, 'frequency'); if (fq) row.frequency = num(fq);
    rows.push(row);
  }
  if (bad) warnings.push(`${bad} row${bad === 1 ? '' : 's'} had no valid date and were skipped.`);
  if (!rows.length) warnings.push('No data rows found.');
  if (idx.spend === undefined) warnings.push('No spend column recognised: cost per lead will be blank.');
  if (idx.impressions === undefined) warnings.push('No impressions column recognised.');
  const days = rows.map(x => x.day).sort();
  return { kind: 'performance', platform, rows, columns, warnings, preamble, delimiter: delim, period_start: days[0] || null, period_end: days[days.length - 1] || null };
}
