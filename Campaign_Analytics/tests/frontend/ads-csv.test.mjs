// node --test tests/frontend
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAdsCsv, detectPlatform } from '../../js/ads-csv.mjs';
import { detectText } from '../../js/upload-detect.mjs';

const GOOGLE = [
  'Campaign report',
  'September 1, 2026 - September 3, 2026',
  'Day,Campaign,Campaign type,Impr.,Clicks,Cost,Conversions',
  '2026-09-01,Search · agentic AI platform (GSI),Search,"1,204",41,"$172.45",2.00',
  '2026-09-02,Search · agentic AI platform (GSI),Search,"1,180",39,"$165.10",1.00',
  '2026-09-02,Search · Lyzr brand,Search,410,52,"$54.20",3.00',
  'Total: All campaigns,,, "2,794",132,"$391.75",6.00',
].join('\n');

const META = [
  'Reporting starts,Reporting ends,Campaign name,Ad set name,Ad name,Impressions,Reach,Link clicks,Amount spent (USD),Results,Frequency',
  '2026-09-01,2026-09-01,Agentic AI Roadmap playbook,Decision makers,Playbook v1,5400,2600,61,62.10,1,2.08',
  '2026-09-02,2026-09-02,Agentic AI Roadmap playbook,Decision makers,Playbook v1,5100,2500,58,60.00,0,2.04',
].join('\n');

const BING = [
  'Gregorian date,Campaign name,Campaign ID,Impressions,Clicks,Spend,Conversions',
  '9/1/2026,Bing search · GSI,777,900,22,31.5,1',
].join('\n');

test('google ads export: preamble skipped, totals row dropped, platform detected', () => {
  const r = parseAdsCsv(GOOGLE, 'Campaign report.csv');
  assert.equal(r.platform, 'google');
  assert.equal(r.kind, 'performance');
  assert.equal(r.rows.length, 3);
  assert.equal(r.rows[0].day, '2026-09-01');
  assert.equal(r.rows[0].impressions, 1204);
  assert.equal(r.rows[0].spend, 172.45);
  assert.equal(r.rows[0].leads, 2);
  assert.equal(r.rows[2].campaign, 'Search · Lyzr brand');
  assert.equal(r.period_start, '2026-09-01');
  assert.equal(r.period_end, '2026-09-02');
  assert.deepEqual(r.warnings, []);
});

test('meta export: ad level rows keep ad name, reach and frequency', () => {
  const r = parseAdsCsv(META, 'Lyzr-Ads-Sep-2026.csv');
  assert.equal(r.platform, 'meta');
  assert.equal(r.rows.length, 2);
  assert.equal(r.rows[0].ad_name, 'Playbook v1');
  assert.equal(r.rows[0].reach, 2600);
  assert.equal(r.rows[0].clicks, 61);
  assert.equal(r.rows[0].spend, 62.1);
  assert.equal(r.rows[0].frequency, 2.08);
  assert.equal(r.rows[0].leads, 1);
});

test('platform detection from headers and file names', () => {
  assert.equal(detectPlatform(['Gregorian date', 'Campaign name', 'Impressions']), 'bing');
  assert.equal(detectPlatform(['Date', 'Campaign', 'Spent', 'Visible impressions', 'Clicks']), 'taboola');
  assert.equal(detectPlatform(['Time period', 'Campaign name', 'Impressions', 'Spend']), 'x');
  assert.equal(detectPlatform(['Date', 'Campaign', 'Impressions', 'Clicks', 'Spend'], 'chatgpt-ads-sep.csv'), 'chatgpt');
  assert.equal(detectPlatform(['Start Date (in UTC)', 'Campaign Name', 'Impressions', 'Total Spent']), null);
  assert.throws(() => parseAdsCsv('Date,Campaign,Impressions,Clicks,Spend\n2026-09-01,A,1,1,1', 'unknown.csv'), /which ad platform/);
});

test('bulk detection files other-platform exports under Ads with their platform', () => {
  const g = detectText(GOOGLE, 'Campaign report.csv');
  assert.equal(g.channel, 'linkedin'); assert.equal(g.platform, 'google'); assert.equal(g.kind, 'performance'); assert.equal(g.label, 'Ads · Google Ads');
  const b = detectText(BING, 'bing.csv');
  assert.equal(b.platform, 'bing'); assert.equal(b.parsed.rows[0].campaign_id, '777'); assert.equal(b.parsed.rows[0].day, '2026-09-01');
  const li = detectText(['Start Date (in UTC),Campaign Group Name,Campaign Name,Campaign ID,Ad ID,Ad Name,Impressions,Clicks,Total Spent,Leads', '9/1/2026,G,C,1,2,Ad,100,5,$10.00,1'].join('\n'), 'linkedin.csv');
  assert.equal(li.platform, 'linkedin'); assert.equal(li.kind, 'performance');
});
