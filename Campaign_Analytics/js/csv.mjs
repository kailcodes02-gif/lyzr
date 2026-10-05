// LinkedIn Campaign Manager CSV parser. No dependency on PapaParse so the same
// code runs in the browser and in node tests. Handles the report preamble,
// quoted commas, comma / tab / semicolon delimiters and UTF-16 exports.
//
// parseLinkedInCsv(text, fileName) ->
//   { kind:'performance'|'demographics', period_start, period_end,
//     columns:{ rawHeader: mappedField }, rows:[normalised], warnings:[], preamble:[], delimiter }

// ---- header synonyms (keys are lowercased with non-letters stripped) ----
// Field order matters: the 2026 "Ad Performance Report" export has Campaign Name = the campaign
// group and Ad Set Name = what this dashboard calls the campaign (stage, approach, ad set tables
// all key on it). `campaign` claims Ad Set Name first, then campaign_group takes Campaign Name.
// Older exports (Campaign Group Name + Campaign Name) still map the same way.
const PERF_FIELDS = {
  day: ['startdateinutc', 'startdate', 'date', 'day', 'dateinutc', 'reportdate'],
  campaign: ['adsetname', 'adset', 'campaignname', 'campaign'],
  campaign_group: ['campaigngroupname', 'campaigngroup', 'adcampaigngroupname', 'campaignname', 'campaign'],
  campaign_id: ['campaignid', 'adsetid'],
  ad_id: ['adid', 'creativeid', 'sponsoredcreativeid'],
  ad_name: ['adname', 'creativename', 'adheadline', 'headline', 'introductorytext', 'introtext', 'adtitle'],
  ad_headline: ['adheadline', 'headline'],
  ad_text: ['adintroductiontext', 'introductorytext', 'introtext', 'adline'],
  objective: ['adsetobjective', 'campaignobjective', 'objective', 'objectivetype'],
  format: ['adsettype', 'adformat', 'creativetype', 'format', 'campaigntype'],
  impressions: ['impressions'],
  clicks: ['clicks', 'totalclicks'],
  spend: ['totalspent', 'spend', 'cost', 'amountspent', 'totalspend'],
  reach: ['reach', 'uniqueimpressions'],
  leads: ['leads', 'leadformsubmissions', 'leadformsubmits', 'totalleads'],
  lead_forms_opened: ['leadformopens', 'leadformsopened', 'leadformopened', 'formopens'],
  video_views: ['videoviews', 'views'],
  sends: ['sends', 'messagesends', 'sponsoredmessagingsends'],
  opens: ['opens', 'messageopens', 'sponsoredmessagingopens'],
  engagements: ['totalengagements', 'engagements', 'totalsocialactions'],
  reactions: ['reactions', 'likes'],
  comments: ['comments'],
  shares: ['shares'],
  follows: ['follows'],
  viral_impressions: ['viralimpressions'],
  conversions: ['conversions', 'totalconversions', 'externalwebsiteconversions'],
};
const DEMO_FIELDS = {
  segment: ['segment', 'segmenttype', 'demographic', 'demographiccategory', 'dimension'],
  value: ['segmentvalue', 'value', 'name', 'demographicvalue', 'dimensionvalue'],
  campaign: PERF_FIELDS.campaign,
  campaign_group: PERF_FIELDS.campaign_group,
  campaign_id: PERF_FIELDS.campaign_id,
};
// A demographics export can also put the dimension in the first column header
// (e.g. "Company", "Job Title"); we treat that column as the value and fix the segment.
// "Company Name Segment" (the 2026 Demographics Report export) -> companyname
const segKey = h => normHeader(h).replace(/segment$/, '');
const SEGMENT_HEADERS = {
  company: 'Company', companyname: 'Company', membercompany: 'Company',
  jobtitle: 'Job Title', title: 'Job Title', memberjobtitle: 'Job Title',
  jobseniority: 'Job Seniority', seniority: 'Job Seniority',
  jobfunction: 'Job Function', function: 'Job Function',
  country: 'Country', countryregion: 'Country', membercountry: 'Country',
  location: 'Location', memberlocation: 'Location', region: 'Location',
  companysize: 'Company Size', companyindustry: 'Industry', industry: 'Industry', memberindustry: 'Industry',
  contextualcountryregion: 'Country', contextualcountry: 'Country', county: 'County', designatedmarketarea: 'DMA', dma: 'DMA',
  countyregion: 'Country', memberregion: 'Location', jobtitles: 'Job Title', companies: 'Company',
};
export const METRIC_FIELDS = ['impressions', 'clicks', 'spend', 'reach', 'leads', 'lead_forms_opened', 'video_views', 'sends', 'opens', 'engagements', 'reactions', 'comments', 'shares', 'follows', 'viral_impressions', 'conversions'];
const TEXT_FIELDS = ['day', 'campaign_group', 'campaign', 'campaign_id', 'ad_id', 'ad_name', 'ad_headline', 'ad_text', 'objective', 'format', 'segment', 'value'];

export const normHeader = h => String(h || '').toLowerCase().replace(/[^a-z]/g, '');

// ---- numbers and dates ----
export function num(v) {
  if (v == null) return 0;
  const s = String(v).replace(/["'$,%\s]/g, '').replace(/^[-–—]$/, '');
  if (s === '' || s === '-') return 0;
  const n = Number(s.replace(/[^0-9.eE+-]/g, ''));
  return isNaN(n) ? 0 : n;
}
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const iso = (y, m, d) => (y < 100 ? 2000 + y : y) + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
export function parseDate(v) {
  if (v == null) return null;
  const s = String(v).trim().replace(/^"|"$/g, '');
  if (!s) return null;
  let m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return iso(+m[1], +m[2], +m[3]);            // 2026-07-03 or ISO datetime
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/))) return iso(+m[3], +m[1], +m[2]);       // M/D/YYYY (US, as LinkedIn exports)
  if ((m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/))) { const mo = MONTHS[m[1].slice(0, 3).toLowerCase()]; if (mo) return iso(+m[3], mo, +m[2]); } // Jul 3, 2026 / Jul 3 2026
  if ((m = s.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})/))) { const mo = MONTHS[m[2].slice(0, 3).toLowerCase()]; if (mo) return iso(+m[3], mo, +m[1]); } // 3 Jul 2026
  if ((m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/))) return iso(+m[1], +m[2], +m[3]);
  return null;
}

// ---- low level CSV ----
export function detectDelimiter(line) {
  const c = { ',': 0, '\t': 0, ';': 0 };
  let q = false;
  for (const ch of line) { if (ch === '"') q = !q; else if (!q && ch in c) c[ch]++; }
  return c['\t'] > c[','] && c['\t'] >= c[';'] ? '\t' : c[';'] > c[','] ? ';' : ',';
}
// RFC 4180 style: quoted fields may contain the delimiter, doubled quotes and newlines.
export function parseRows(text, delim = ',') {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
// Bytes -> text. LinkedIn exports are often UTF-16 LE with a BOM.
export function decodeCsvBuffer(buf) {
  const b = new Uint8Array(buf);
  if (b.length >= 2 && b[0] === 0xFF && b[1] === 0xFE) return new TextDecoder('utf-16le').decode(b.subarray(2));
  if (b.length >= 2 && b[0] === 0xFE && b[1] === 0xFF) return new TextDecoder('utf-16be').decode(b.subarray(2));
  if (b.length >= 3 && b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) return new TextDecoder('utf-8').decode(b.subarray(3));
  // No BOM: guess UTF-16 when every other byte is zero in the first 64 bytes.
  let zeros = 0; for (let i = 1; i < Math.min(64, b.length); i += 2) if (b[i] === 0) zeros++;
  return new TextDecoder(zeros > 20 ? 'utf-16le' : 'utf-8').decode(b);
}

// Find the two dates on a "Report period" / "Date range" line of the preamble.
export function periodFromPreamble(lines) {
  // "Report Start: April 1, 2026, 12:00 AM" and "Report End: ..." on separate lines (Demographics Report export).
  const edges = {};
  for (const raw of lines) {
    const line = Array.isArray(raw) ? raw.join(' ') : String(raw);
    const m = line.match(/report\s*(start|end)\s*:?\s*(.+)$/i); if (!m) continue;
    const d = parseDate(m[2].trim()); if (d) edges[m[1].toLowerCase()] = d;
  }
  if (edges.start && edges.end) return { start: edges.start < edges.end ? edges.start : edges.end, end: edges.start < edges.end ? edges.end : edges.start };
  for (const raw of lines) {
    const line = Array.isArray(raw) ? raw.join(' ') : String(raw);
    if (!/report\s*period|date\s*range|time\s*range|reporting\s*period|period/i.test(line)) continue;
    const found = [];
    const re = /(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\/\d{1,2}\/\d{2,4}|[A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4}|\d{1,2}\s+[A-Za-z]{3,9}\.?,?\s+\d{4})/g;
    let m; while ((m = re.exec(line))) { const d = parseDate(m[1]); if (d) found.push(d); }
    if (found.length >= 2) return { start: found[0] < found[1] ? found[0] : found[1], end: found[0] < found[1] ? found[1] : found[0] };
    if (found.length === 1) return { start: found[0], end: found[0] };
  }
  return null;
}

function mapHeaders(headers, fields) {
  const columns = {}; const used = new Set();
  const norm = headers.map(normHeader);
  for (const [field, syns] of Object.entries(fields)) {
    for (const s of syns) { // synonym order = priority
      const idx = norm.findIndex((h, i) => h === s && !used.has(i));
      if (idx >= 0) { columns[headers[idx]] = field; used.add(idx); break; }
    }
  }
  return columns;
}

// One Demographics Report export holds up to ten tables, one per breakdown (Company Name, Company
// Industry, Company Size, Contextual Country/Region, Location, Job Seniority, Job Title, Job Function,
// County, Designated Market Area), separated by blank lines and each headed "<dimension> Segment".
// Every table is read; rows carry their segment. A single-table file goes through unchanged.
export function parseLinkedInCsv(text, fileName = '') {
  if (text && text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const lines = String(text || '').split(/\r\n|\n|\r/);
  const blocks = []; let cur = null;
  for (let i = 0; i < lines.length; i++) { const blank = !lines[i].trim() || /^[\s,\t;"]*$/.test(lines[i]); if (blank) { cur = null; continue; } if (!cur) { cur = { start: i, lines: [] }; blocks.push(cur); } cur.lines.push(lines[i]); }
  const isSeg = b => { const first = (parseRows(b.lines[0], detectDelimiter(b.lines[0]))[0] || [])[0]; return !!(first && SEGMENT_HEADERS[segKey(first)] && /impressions|sends/i.test(b.lines[0])); };
  const segBlocks = blocks.filter(isSeg);
  if (segBlocks.length < 2) return parseOneTable(text, fileName);
  const preamble = blocks.filter(b => !isSeg(b) && b.start < segBlocks[0].start).flatMap(b => b.lines);
  const out = { kind: 'demographics', period_start: null, period_end: null, columns: {}, rows: [], warnings: [], preamble: [], delimiter: detectDelimiter(segBlocks[0].lines[0]), fileName, segments: [] };
  for (const b of segBlocks) {
    const one = parseOneTable([...preamble, '', ...b.lines].join('\n'), fileName);
    if (one.kind !== 'demographics') continue;
    out.rows.push(...one.rows); Object.assign(out.columns, one.columns);
    out.preamble = one.preamble; if (!out.period_start) { out.period_start = one.period_start; out.period_end = one.period_end; }
    for (const w of one.warnings) if (!/Ignored text columns|No data rows/.test(w) && !out.warnings.includes(w)) out.warnings.push(w);
    const seg = one.rows[0] && one.rows[0].segment; if (seg && !out.segments.includes(seg)) out.segments.push(seg);
  }
  if (!out.rows.length) out.warnings.push('No data rows found.');
  return out;
}

function parseOneTable(text, fileName = '') {
  const warnings = [];
  if (text && text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const lines = String(text || '').split(/\r\n|\n|\r/);
  // Header = first line that mentions Impressions or Sends (the preamble never does).
  let hi = lines.findIndex(l => /impressions|\bsends\b/i.test(l));
  if (hi < 0) { hi = lines.findIndex(l => l.split(/[,\t;]/).length >= 4); if (hi < 0) throw new Error(`${fileName || 'This file'} does not look like a LinkedIn Campaign Manager export (no Impressions or Sends column).`); warnings.push('No Impressions or Sends column found; used the first wide row as the header.'); }
  const preamble = lines.slice(0, hi).map(l => l.replace(/^"|"$/g, '').replace(/[,\t;]+$/, '').trim()).filter(Boolean);
  const delimiter = detectDelimiter(lines[hi]);
  const table = parseRows(lines.slice(hi).join('\n'), delimiter).filter(r => r.some(c => String(c).trim() !== ''));
  const headers = table[0].map(h => String(h).trim());
  const body = table.slice(1).filter(r => !/^(total|totals|grand total)$/i.test(String(r[0]).trim()));

  // Kind: a Segment column (or a first column that is itself a demographic dimension) = demographics.
  const demoCols = mapHeaders(headers, DEMO_FIELDS);
  const normed = headers.map(normHeader);
  let fixedSegment = null;
  if (!Object.values(demoCols).includes('segment')) {
    const firstDim = headers.find(h => SEGMENT_HEADERS[segKey(h)] && !PERF_FIELDS.day.includes(normHeader(h)));
    if (firstDim && !normed.some(h => PERF_FIELDS.day.includes(h))) { fixedSegment = SEGMENT_HEADERS[segKey(firstDim)]; demoCols[firstDim] = 'value'; delete demoCols[Object.keys(demoCols).find(k => demoCols[k] === 'value' && k !== firstDim)]; }
  }
  const hasSegment = Object.values(demoCols).includes('segment') || !!fixedSegment;
  const hasDay = normed.some(h => PERF_FIELDS.day.includes(h));
  const kind = hasSegment ? 'demographics' : 'performance';
  if (kind === 'performance' && !hasDay) warnings.push('No date column found. Export with a daily breakdown (Ads > Export > Time breakdown: Daily) so the trend and range filter work.');

  const columns = kind === 'performance' ? mapHeaders(headers, PERF_FIELDS) : { ...demoCols, ...mapHeaders(headers, Object.fromEntries(METRIC_FIELDS.map(f => [f, PERF_FIELDS[f]]))) };
  // Unknown numeric columns -> extra
  const unknownIdx = headers.map((h, i) => (columns[h] || !h) ? -1 : i).filter(i => i >= 0);
  const extraCols = unknownIdx.filter(i => { const vals = body.map(r => r[i]).filter(v => v != null && !/^[\s"'\-–—]*$/.test(String(v))); if (!vals.length) return false; const numeric = vals.filter(v => /^[\s"$]*-?[\d,]*\.?\d+%?"?\s*$/.test(String(v))).length; return numeric / vals.length >= 0.8; });
  const ignored = unknownIdx.filter(i => !extraCols.includes(i)).map(i => headers[i]);
  if (ignored.length) warnings.push('Ignored text columns: ' + ignored.join(', '));
  for (const i of extraCols) columns[headers[i]] = 'extra:' + headers[i];

  const idxOf = {}; for (const [h, f] of Object.entries(columns)) idxOf[f] = headers.indexOf(h);
  const rows = []; let badDates = 0;
  for (const r of body) {
    const o = {};
    for (const f of TEXT_FIELDS) if (idxOf[f] != null && idxOf[f] >= 0 && (kind === 'demographics' || !['segment', 'value'].includes(f))) o[f] = String(r[idxOf[f]] ?? '').trim();
    if (kind === 'performance') {
      const d = parseDate(o.day); if (o.day && !d) badDates++; o.day = d || '';
      // The 2026 export leaves Ad Name blank for most ads: fall back to the headline, then the intro text.
      if (!o.ad_name) o.ad_name = (o.ad_headline || o.ad_text || '').split(/\r?\n/)[0].replace(/\s+/g, ' ').trim().slice(0, 120);
      delete o.ad_headline; delete o.ad_text;
    }
    else { if (fixedSegment) o.segment = fixedSegment; if (!o.segment) o.segment = ''; }
    for (const f of METRIC_FIELDS) o[f] = idxOf[f] != null && idxOf[f] >= 0 ? num(r[idxOf[f]]) : 0;
    const extra = {}; for (const i of extraCols) extra[headers[i]] = num(r[i]);
    if (extraCols.length) o.extra = extra;
    if (kind === 'performance' && !o.day && hasDay) continue; // no usable date
    if (kind === 'demographics' && !o.value) continue;
    rows.push(o);
  }
  if (badDates) warnings.push(`${badDates} rows had a date that could not be read and were skipped.`);
  if (!rows.length) warnings.push('No data rows found.');

  let period_start = null, period_end = null;
  if (kind === 'performance') { const days = rows.map(r => r.day).filter(Boolean).sort(); period_start = days[0] || null; period_end = days[days.length - 1] || null; }
  else { const p = periodFromPreamble(preamble); if (p) { period_start = p.start; period_end = p.end; } else warnings.push('Could not read the report period from the file. Enter the export window before uploading.'); }
  const missing = kind === 'performance' ? ['impressions', 'clicks', 'spend'].filter(f => !Object.values(columns).includes(f)) : [];
  if (missing.length) warnings.push('Missing columns: ' + missing.join(', ') + ' (treated as 0).');
  return { kind, period_start, period_end, columns, rows, warnings, preamble, delimiter, fileName };
}
