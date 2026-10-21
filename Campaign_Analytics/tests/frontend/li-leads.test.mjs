// node --test 'Campaign_Analytics/tests/frontend/*.test.mjs'
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as L from '../../js/lib/li-leads.mjs';
import { detectText } from '../../js/upload-detect.mjs';
import { fitSize } from '../../js/screenshots.mjs';
import { createLeadsMock } from '../../js/mock/leads.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const seed = f => JSON.parse(readFileSync(path.join(here, '..', '..', 'seed', f), 'utf8'));
const accounts = seed('accounts.json');
const bands = seed('band_titles.json');
const regions = seed('regions.json').regions;

// LinkedIn Lead gen forms › Download leads (older layout: Campaign Name = ad set, plus a custom question).
const LINKEDIN = [
  'First Name,Last Name,Email Address,Company Name,Job Title,Country/Region,Campaign Name,Campaign Group Name,Ad Name,Lead Form Name,Submitted At,Phone Number,LinkedIn Profile URL,What would you use agents for?',
  'Asha,Rao,Asha.Rao@ey.com,EY,Partner,India,"Native Targeting(Heatmap)|GSI|Playbooks-2 Sept\'26",LinkedIn Ads-GSI & SI|Playbook Lead Gen,Roadmap,Agentic AI Roadmap,09/14/2026 10:22,+91 98000,https://linkedin.com/in/asha,Audit',
  'Ben,Cole,ben@deloitte.com,Deloitte,Director,United States,"Native Targeting(Heatmap)|GSI|Playbooks-2 Sept\'26",LinkedIn Ads-GSI & SI|Playbook Lead Gen,Roadmap,Agentic AI Roadmap,09/15/2026 08:00,,,',
  'Chen,Li,chen@gmail.com,Acme Widgets,Software Engineer,United Kingdom,Book a demo|GSI,GSI & SI Lead Gen|Book a Demo,Demo,Book a demo,09/20/2026 11:00,,,',
  ',,,Acme Corp,Analyst,India,,,,,,,,',
].join('\n');
// 2026 layout with semicolons and European day first dates: Ad Set Name is the ad set, Campaign Name the group.
const NEW_LAYOUT = [
  'Lead Form Name;Ad Set Name;Campaign Name;Creative;First Name;Last Name;Email;Company;Title;Country;Date Submitted;Seniority;Industry;Company Size',
  'Enterprise AI Playbook;Playbooks|GSI&SI|Seniorities|Lead Gen- 14 Aug\'26;LinkedIn Ads-GSI & SI|Playbook Lead Gen;Pilots;Dev;Nair;dev@infosys.com;Infosys;Vice President;India;25/08/2026;VP;IT Services;10,001+',
  'Enterprise AI Playbook;Playbooks|GSI&SI|Seniorities|Lead Gen- 14 Aug\'26;LinkedIn Ads-GSI & SI|Playbook Lead Gen;Pilots;Eve;Stone;;Wipro;Senior Manager;Saudi Arabia;26/08/2026;Manager;IT Services;10,001+',
].join('\n');

test('parseLeadCsv: LinkedIn Lead gen forms export (older header names, custom question to extra)', () => {
  const p = L.parseLeadCsv(LINKEDIN, 'leads.csv');
  assert.equal(p.rows.length, 3);
  assert.equal(p.skipped, 1, 'a row with no name or email is skipped');
  const a = p.rows[0];
  assert.equal(a.email, 'asha.rao@ey.com', 'email lower-cased');
  assert.equal(a.submitted_at, '2026-09-14');
  assert.equal(a.campaign, "Native Targeting(Heatmap)|GSI|Playbooks-2 Sept'26");
  assert.equal(a.campaign_group, 'LinkedIn Ads-GSI & SI|Playbook Lead Gen');
  assert.equal(a.form, 'Agentic AI Roadmap');
  assert.equal(a.ad, 'Roadmap');
  assert.equal(a.country, 'India');
  assert.equal(a.linkedin_url, 'https://linkedin.com/in/asha');
  assert.equal(a.source, 'csv');
  assert.deepEqual(a.extra, { 'What would you use agents for?': 'Audit' });
  assert.equal(p.columns['What would you use agents for?'], 'extra');
  assert.deepEqual([p.stats.from, p.stats.to, p.stats.campaigns, p.stats.forms], ['2026-09-14', '2026-09-20', 2, 2]);
});

test('parseLeadCsv: 2026 layout (Ad Set Name + Campaign Name), semicolons, day-first dates, missing email', () => {
  const p = L.parseLeadCsv(NEW_LAYOUT, 'leads.csv');
  assert.equal(p.rows.length, 2);
  const [d, e] = p.rows;
  assert.equal(d.campaign, "Playbooks|GSI&SI|Seniorities|Lead Gen- 14 Aug'26", 'Ad Set Name is the ad set');
  assert.equal(d.campaign_group, 'LinkedIn Ads-GSI & SI|Playbook Lead Gen', 'Campaign Name becomes the group');
  assert.equal(d.ad, 'Pilots');
  assert.equal(d.submitted_at, '2026-08-25');
  assert.equal(d.seniority, 'VP');
  assert.equal(d.company_size, '10,001+');
  assert.equal(e.email, '');
  assert.equal(L.leadKey(e), 'n:evestone|wipro', 'no email: name + company');
});

test('isLeadCsv and detectText: lead files are recognised and ad reports are not', () => {
  assert.equal(L.isLeadCsv(['First Name', 'Last Name', 'Email', 'Company']), true);
  assert.equal(L.isLeadCsv(['Email', 'Job Title']), true);
  assert.equal(L.isLeadCsv(['Campaign Name', 'Impressions', 'Clicks', 'Total Spent']), false);
  assert.equal(L.isLeadCsv(['Company', 'Impressions']), false);
  assert.equal(L.isLeadCsv(['Email']), false, 'an email alone says nothing about the lead');
  const d = detectText(LINKEDIN, 'Leads.csv');
  assert.equal(d.channel, 'leads');
  assert.equal(d.kind, 'leads');
  assert.equal(d.parsed.rows.length, 3);
  assert.throws(() => L.parseLeadCsv('Campaign,Impressions\nA,1', 'x.csv'), /Not a lead file/);
});

test('leadDay and normaliseLead', () => {
  assert.equal(L.leadDay('2026-09-03T22:10:00Z'), '2026-09-03');
  assert.equal(L.leadDay('Sep 3, 2026'), '2026-09-03');
  assert.equal(L.leadDay('31/08/2026'), '2026-08-31');
  assert.equal(L.leadDay('nonsense'), '');
  const n = L.normaliseLead({ name: 'Ann Marie Lee', email: 'MAILTO:Ann@PwC.com', lead_type: 'MQL', weird: 'x', extra: { q: 'a' } }, 'screenshot');
  assert.deepEqual([n.first_name, n.last_name, n.email, n.lead_type, n.source], ['Ann', 'Marie Lee', 'ann@pwc.com', 'mql', 'screenshot']);
  assert.deepEqual(n.extra, { q: 'a', weird: 'x' });
  for (const f of L.LEAD_FIELDS) assert.equal(typeof n[f], 'string');
});

test('dedupe: email + day + form, then name + company; a cumulative re-export never double counts', () => {
  const first = L.parseLeadCsv(LINKEDIN, 'a.csv').rows;
  const again = L.parseLeadCsv(LINKEDIN + '\nDan,Fox,dan@kpmg.com,KPMG,Senior Manager,India,X,G,A,Agentic AI Roadmap,09/21/2026,,,', 'b.csv').rows;
  const { leads, duplicates } = L.dedupeLeads([...first, ...again]);
  assert.equal(leads.length, 4);
  assert.equal(duplicates.length, 3);
  // same person, another form or another day = another lead
  const other = { ...first[0], form: 'Book a demo' };
  assert.equal(L.dedupeLeads([first[0], other]).leads.length, 2);
  assert.equal(L.leadKey({ first_name: 'A' }), null, 'no email and no company: cannot tell, kept');
});

test('leadsByCampaign: joins LinkedIn performance by ad set name for spend, CPL and completion', () => {
  const leads = L.parseLeadCsv(LINKEDIN, 'a.csv').rows;
  const perf = [
    { day: '2026-09-14', campaign: "Native Targeting(Heatmap)|GSI|Playbooks-2 Sept'26", campaign_group: 'LinkedIn Ads-GSI & SI|Playbook Lead Gen', spend: 300, leads: 3, lead_forms_opened: 10 },
    { day: '2026-09-15', campaign: "Native Targeting(Heatmap)|GSI|Playbooks–2 Sept’26", campaign_group: 'LinkedIn Ads-GSI & SI|Playbook Lead Gen', spend: 100, leads: 1, lead_forms_opened: 6 },
    { day: '2026-09-15', campaign: 'Brand Awareness|GSI', spend: 500, leads: 0 },
    { day: '2026-09-16', campaign: 'Conversation|ANI', spend: 50, leads: 2, lead_forms_opened: 0 },
  ];
  const rows = L.leadsByCampaign(leads, perf);
  const top = rows[0];
  assert.equal(top.campaign, "Native Targeting(Heatmap)|GSI|Playbooks-2 Sept'26");
  assert.equal(top.count, 2);
  assert.equal(top.in_perf, true);
  assert.equal(top.spend, 400, 'punctuation and quote styles do not split an ad set (en dash, curly apostrophe)');
  assert.equal(top.li_leads, 4);
  assert.equal(top.cpl, 100);
  assert.equal(top.cpl_files, 200);
  assert.equal(top.completion, 25);
  assert.equal(top.gap, 2, 'LinkedIn reports two more leads than the files hold');
  assert.equal(top.lead_type, 'playbook');
  assert.deepEqual(top.top_companies.map(c => c.company), ['Deloitte', 'EY']);
  const demo = rows.find(r => r.campaign === 'Book a demo|GSI');
  assert.equal(demo.in_perf, false);
  assert.equal(demo.cpl, null);
  assert.equal(demo.lead_type, 'mql');
  assert.ok(rows.some(r => r.campaign === 'Conversation|ANI' && r.count === 0 && r.li_leads === 2), 'ad sets with LinkedIn leads but none in the files are listed');
  assert.ok(!rows.some(r => r.campaign === 'Brand Awareness|GSI'), 'ad sets with no leads anywhere are left out');
  const k = L.leadKpis(leads, perf, { accounts, bands });
  assert.equal(k.spend, 950);
  assert.equal(k.li_leads, 6);
  assert.equal(Math.round(k.cpl * 100) / 100, 158.33);
  assert.equal(k.completion, 6 / 16 * 100);
});

test('companyTable, bands, regions and the campaign × company matrix', () => {
  const leads = [...L.parseLeadCsv(LINKEDIN, 'a.csv').rows, ...L.parseLeadCsv(NEW_LAYOUT, 'b.csv').rows];
  leads.push(L.normaliseLead({ first_name: 'Raj', last_name: 'K', email: 'raj@ey.com', company: 'Ernst & Young', title: 'Managing Director', country: 'India', campaign: 'X', submitted_at: '2026-09-02' }));
  const rows = L.companyTable(leads, accounts, { bands });
  const ey = rows.find(r => r.company === 'EY');
  assert.ok(ey, 'EY found as an account');
  assert.equal(ey.target, true);
  assert.equal(ey.tier, 'Big Four');
  assert.equal(ey.tier_group, 'Tier 1');
  assert.equal(ey.count, 2, 'EY and Ernst & Young fold into one account');
  assert.equal(ey.bands.MD, 2);
  assert.equal(ey.md_share, 100);
  const acme = rows.find(r => r.company === 'Acme Widgets');
  assert.equal(acme.target, false);
  assert.equal(acme.tier, null);
  assert.equal(L.bandOf({ title: 'Director' }, bands), 'MD-1');
  assert.deepEqual(L.bandMix([{ title: 'Director' }, { title: 'Senior Manager' }], bands), { MD: 0, 'MD-1': 0.5, 'MD-2': 1.5, Other: 0 });
  assert.equal(L.leadRegion({ country: 'Saudi Arabia' }, regions), 'Middle East');
  const m = L.campaignCompanyMatrix(leads, accounts);
  const ci = m.campaigns.indexOf("Native Targeting(Heatmap)|GSI|Playbooks-2 Sept'26"), ri = m.companies.indexOf('EY');
  assert.equal(m.counts[ri][ci], 1);
  assert.equal(m.cells.get(ri + '|' + ci)[0].first_name, 'Asha');
  assert.ok(m.max >= 1);
  const by = L.leadsBy(leads, 'country');
  assert.equal(by[0].key, 'India');
  assert.equal(by[0].count, 3);
  const t = L.leadTrend(leads, 'month');
  assert.deepEqual(t.buckets, ['2026-08', '2026-09']);
  assert.deepEqual(t.series.csv, [2, 4]);
});

test('fromHubspot keeps the origin; leadsToCsv quotes; fitSize keeps the long edge at 1600', () => {
  const h = L.fromHubspot({ hs_id: '7', first_name: 'Ann', last_name: 'B', email: 'ann@tcs.com', company_raw: 'TCS', account: 'Tata Consultancy Services', jobtitle: 'Partner', band: 'MD', country: 'India', day: '2026-09-02', props: { first_conversion_event_name: 'Book a demo', lead_source: 'LinkedIn', lead_campaign_name: 'GSI Sept', hs_analytics_source: 'PAID_SOCIAL', first_conversion_date: '2026-09-02' } });
  assert.deepEqual([h.source, h.form, h.campaign, h.lead_source, h.traffic, h.submitted_at], ['hubspot', 'Book a demo', 'GSI Sept', 'LinkedIn', 'Paid social', '2026-09-02']);
  assert.equal(L.accountOf(h, accounts), 'Tata Consultancy Services', "HubSpot's own account match wins");
  assert.equal(L.bandOf(h, bands), 'MD');
  const csv = L.leadsToCsv([L.normaliseLead({ first_name: 'A, B', email: 'a@b.com' })], [{ h: 'band', f: () => 'MD' }]);
  assert.ok(csv.split('\r\n')[0].endsWith(',source,band'));
  assert.ok(csv.includes('"A, B"'));
  assert.deepEqual(fitSize(3200, 1800), { w: 1600, h: 900 });
  assert.deepEqual(fitSize(800, 600), { w: 800, h: 600 });
});

test('demo data: about 150 leads over 8 campaigns, repeats across files counted once, posts dedupe', () => {
  const m = createLeadsMock();
  const g = m.get();
  assert.ok(g.leads.length >= 150 && g.leads.length <= 170, `got ${g.leads.length}`);
  assert.equal(new Set(g.leads.map(l => l.campaign)).size, 8);
  assert.ok(g.duplicates > 0);
  assert.equal(g.screens.length, 2);
  const again = m.post({ file_name: 'x.csv', rows: g.leads.slice(0, 5) });
  assert.equal(again.inserted, 0);
  assert.equal(again.duplicates, 5);
  assert.throws(() => m.del('leads:li-api'), /cannot be deleted/);
});
