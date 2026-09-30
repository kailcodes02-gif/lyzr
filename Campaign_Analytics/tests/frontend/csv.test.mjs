// node --test tests/frontend
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLinkedInCsv, parseDate, num, periodFromPreamble, decodeCsvBuffer, detectDelimiter } from '../../js/csv.mjs';

const PERF = [
  'Ad Performance Report',
  'Report period: 9/1/2026 - 9/24/2026',
  'Account: Lyzr (123456)',
  '',
  'Start Date (in UTC),Campaign Group Name,Campaign Name,Campaign ID,Ad ID,Ad Name,Campaign Objective,Ad Format,Impressions,Clicks,Total Spent,Reach,Leads,Lead Form Opens,Video Views,Sends,Opens,Total Engagements,Reactions,Comments,Shares,Follows,Viral Impressions,Conversions,Average CPM',
  '9/1/2026,"LinkedIn Ads-GSI & SI|Playbook Lead Gen","Native Targeting(Heatmap)|GSI|Playbooks-2 Sept\'26",200000,1013,"Agentic AI Roadmap, the 90-day plan",Lead generation,Document ad,"1,946",21,"$174.03","1,800",5,11,0,0,0,140,4,0,0,1,12,1,"$89.43"',
  '9/2/2026,"LinkedIn Ads-GSI & SI|Playbook Lead Gen","Native Targeting(Heatmap)|GSI|Playbooks-2 Sept\'26",200000,1013,"Agentic AI Roadmap, the 90-day plan",Lead generation,Document ad,"17,576",150,"$353.10","16,400",6,14,,,,"1,100",20,1,0,3,180,2,"$20.09"',
  '9/3/2026,"GSI & SI Lead Gen|Conversion","GSI&SI|ANI|Conversation Ads|Lead Gen- 4 Sept\'26",200481,1130,"Ani: quick question",Lead generation,Conversation ad,0,2,"$40.00",0,1,2,0,60,31,40,0,0,0,0,0,0,-',
  'Total,,,,,,,,"19,522",173,"$567.13",,12,27,0,60,31,,,,,,,,',
].join('\r\n');

test('performance export: preamble, quoted commas, money and blanks', () => {
  const r = parseLinkedInCsv(PERF, 'ads.csv');
  assert.equal(r.kind, 'performance');
  assert.equal(r.rows.length, 3, 'total row is dropped');
  assert.equal(r.period_start, '2026-09-01');
  assert.equal(r.period_end, '2026-09-03');
  assert.equal(r.columns['Start Date (in UTC)'], 'day');
  assert.equal(r.columns['Total Spent'], 'spend');
  assert.equal(r.columns['Lead Form Opens'], 'lead_forms_opened');
  assert.equal(r.columns['Average CPM'], 'extra:Average CPM');
  const a = r.rows[0];
  assert.equal(a.day, '2026-09-01');
  assert.equal(a.ad_name, 'Agentic AI Roadmap, the 90-day plan');
  assert.equal(a.campaign, "Native Targeting(Heatmap)|GSI|Playbooks-2 Sept'26");
  assert.equal(a.impressions, 1946);
  assert.equal(a.spend, 174.03);
  assert.equal(a.reach, 1800);
  assert.equal(a.extra['Average CPM'], 89.43);
  const b = r.rows[1];
  assert.equal(b.video_views, 0, 'blank = 0');
  assert.equal(b.sends, 0);
  assert.equal(b.engagements, 1100);
  const c = r.rows[2];
  assert.equal(c.sends, 60); assert.equal(c.opens, 31); assert.equal(c.impressions, 0);
  assert.equal(c.extra['Average CPM'], 0, 'dash = 0');
  assert.deepEqual(r.preamble.slice(0, 2), ['Ad Performance Report', 'Report period: 9/1/2026 - 9/24/2026']);
  assert.equal(r.delimiter, ',');
});

test('performance export without preamble and with ISO dates', () => {
  const txt = 'Date,Campaign Name,Creative Name,Impressions,Clicks,Spend,Leads\n2026-08-14,Playbooks|Seniorities,Enterprise AI Playbook,100,3,12.5,1\n2026-08-15,Playbooks|Seniorities,Enterprise AI Playbook,200,5,20,0\n';
  const r = parseLinkedInCsv(txt);
  assert.equal(r.kind, 'performance');
  assert.equal(r.rows.length, 2);
  assert.equal(r.columns['Creative Name'], 'ad_name');
  assert.equal(r.period_start, '2026-08-14'); assert.equal(r.period_end, '2026-08-15');
  assert.equal(r.rows[1].spend, 20);
  assert.equal(r.warnings.length, 0);
});

const DEMO = [
  '"Demographics Report"',
  '"Report period: Sep 1, 2026 - Sep 14, 2026"',
  '"Time zone: UTC"',
  '',
  'Segment,Segment Value,Campaign Name,Impressions,Clicks,Total Spent,Leads,Sends,Opens',
  'Company,"Boston Consulting Group (BCG)","Playbooks|GSI&SI|Seniorities|Lead Gen- 14 Aug\'26","2,120",21,$0.00,0,0,0',
  'Company,Accenture in India,"Playbooks|GSI&SI|Seniorities|Lead Gen- 14 Aug\'26","9,561",101,$0.00,2,59,33',
  'Job Seniority,Director,"Playbooks|GSI&SI|Seniorities|Lead Gen- 14 Aug\'26","23,866",190,$0.00,0,0,0',
  'Country,India,"Playbooks|GSI&SI|Seniorities|Lead Gen- 14 Aug\'26","56,621",500,$0.00,0,0,0',
].join('\n');

test('demographics export with Segment, Segment Value and Campaign Name columns', () => {
  const r = parseLinkedInCsv(DEMO, 'demo.csv');
  assert.equal(r.kind, 'demographics');
  assert.equal(r.period_start, '2026-09-01');
  assert.equal(r.period_end, '2026-09-14');
  assert.equal(r.rows.length, 4);
  assert.equal(r.columns['Segment'], 'segment');
  assert.equal(r.columns['Segment Value'], 'value');
  assert.equal(r.columns['Campaign Name'], 'campaign');
  assert.equal(r.rows[0].value, 'Boston Consulting Group (BCG)');
  assert.equal(r.rows[0].impressions, 2120);
  assert.equal(r.rows[1].campaign, "Playbooks|GSI&SI|Seniorities|Lead Gen- 14 Aug'26");
  assert.equal(r.rows[1].sends, 59);
  assert.equal(r.rows[2].segment, 'Job Seniority');
  assert.equal(r.rows[3].value, 'India');
  assert.ok(!r.rows[0].day, 'no day on demographics rows');
});

test('demographics export whose first column is the dimension itself, tab delimited, UTF-16', () => {
  const txt = 'Demographics report\nDate range: 2026-07-01 - 2026-07-14\n\nCompany\tImpressions\tClicks\tAverage CTR\nEY\t11,172\t28\t0.25%\nKPMG US\t3,206\t4\t0.12%\n';
  const buf = new Uint8Array(2 + txt.length * 2); buf[0] = 0xFF; buf[1] = 0xFE;
  for (let i = 0; i < txt.length; i++) { const c = txt.charCodeAt(i); buf[2 + i * 2] = c & 0xff; buf[3 + i * 2] = c >> 8; }
  const decoded = decodeCsvBuffer(buf.buffer);
  assert.equal(decoded, txt);
  const r = parseLinkedInCsv(decoded, 'company.csv');
  assert.equal(r.kind, 'demographics');
  assert.equal(r.delimiter, '\t');
  assert.equal(r.period_start, '2026-07-01'); assert.equal(r.period_end, '2026-07-14');
  assert.equal(r.rows.length, 2);
  assert.equal(r.rows[0].segment, 'Company'); assert.equal(r.rows[0].value, 'EY'); assert.equal(r.rows[0].impressions, 11172);
  assert.equal(r.rows[1].value, 'KPMG US');
  assert.equal(r.columns['Average CTR'], 'extra:Average CTR');
  assert.equal(r.rows[0].extra['Average CTR'], 0.25);
});

test('demographics without a readable period warns and leaves the window empty', () => {
  const r = parseLinkedInCsv('Segment,Segment Value,Impressions\nJob Function,Consulting,10\n');
  assert.equal(r.kind, 'demographics');
  assert.equal(r.period_start, null);
  assert.ok(r.warnings.some(w => /window/i.test(w)));
});

test('rejects a file with no Impressions or Sends column', () => {
  assert.throws(() => parseLinkedInCsv('a,b\n1,2\n', 'x.csv'), /does not look like a LinkedIn/);
});

test('dates: M/D/YYYY, YYYY-MM-DD, Mon D, YYYY and Mon D YYYY', () => {
  assert.equal(parseDate('7/3/2026'), '2026-07-03');
  assert.equal(parseDate('07/03/2026'), '2026-07-03');
  assert.equal(parseDate('2026-07-03'), '2026-07-03');
  assert.equal(parseDate('2026-07-03T00:00:00Z'), '2026-07-03');
  assert.equal(parseDate('Jul 3, 2026'), '2026-07-03');
  assert.equal(parseDate('Jul 3 2026'), '2026-07-03');
  assert.equal(parseDate('Sept 14, 2026'), '2026-09-14');
  assert.equal(parseDate('3 Jul 2026'), '2026-07-03');
  assert.equal(parseDate('not a date'), null);
  assert.equal(parseDate(''), null);
});

test('numbers: strips $ , % and quotes, blanks are 0', () => {
  assert.equal(num('"1,234"'), 1234);
  assert.equal(num('$12.50'), 12.5);
  assert.equal(num('43.5%'), 43.5);
  assert.equal(num(''), 0);
  assert.equal(num(undefined), 0);
  assert.equal(num(' - '), 0);
  assert.equal(num('-3'), -3);
});

test('period from preamble handles several phrasings', () => {
  assert.deepEqual(periodFromPreamble(['Report period: Jul 1, 2026 - Jul 14, 2026']), { start: '2026-07-01', end: '2026-07-14' });
  assert.deepEqual(periodFromPreamble(['Date range: 7/15/2026 to 7/31/2026']), { start: '2026-07-15', end: '2026-07-31' });
  assert.deepEqual(periodFromPreamble(['Reporting period', '2026-08-01 – 2026-08-14']), null, 'dates must be on the same line as the label');
  assert.deepEqual(periodFromPreamble(['Time range: 2026-08-14 – 2026-08-01']), { start: '2026-08-01', end: '2026-08-14' }, 'dates are ordered');
  assert.equal(periodFromPreamble(['Account: Lyzr']), null);
});

test('delimiter detection ignores commas inside quotes', () => {
  assert.equal(detectDelimiter('"a, b"\tImpressions\tClicks'), '\t');
  assert.equal(detectDelimiter('a;b;Impressions'), ';');
  assert.equal(detectDelimiter('a,b,Impressions'), ',');
});
