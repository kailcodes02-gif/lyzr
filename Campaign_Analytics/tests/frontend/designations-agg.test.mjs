// node --test tests/frontend
import test from 'node:test';
import assert from 'node:assert/strict';
import * as D from '../../js/lib/designations-agg.mjs';

const BANDS = { global: { MD: ['partner', 'managing director', 'founder'], MD1: ['vice president', 'associate director'], MD2: ['senior manager', 'engagement manager'] } };
const win = (start, end, rows) => ({ upload: { period_start: start, period_end: end, notes: '' }, rows });
const jt = (value, impressions, clicks, campaign = '') => ({ segment: 'Job Title', value, impressions, clicks, campaign });

test('titlesReached sums the same exact title across windows, orders by impressions, keeps the exact string', () => {
  const windows = [
    win('2026-08-01', '2026-08-31', [jt('Partner', 300, 3), jt('Senior Manager – Technology Consulting', 900, 18), { segment: 'Company', value: 'Accenture', impressions: 5000, clicks: 50 }]),
    win('2026-09-01', '2026-09-30', [jt('Partner', 600, 6), jt(' Managing Director ', 450, 9)]),
  ];
  const r = D.titlesReached(windows, { bands: BANDS, rf: 3 });
  assert.deepEqual(r.titles.map(t => t.title), ['Partner', 'Senior Manager – Technology Consulting', 'Managing Director']);
  const p = r.titles[0];
  assert.equal(p.impressions, 900); assert.equal(p.clicks, 9); assert.equal(p.ctr, 1); assert.equal(p.people, 300); assert.equal(p.windows, 2); assert.equal(p.band, 'MD');
  assert.equal(r.titles[1].band, 'MD-2'); assert.equal(r.titles[1].windows, 1);
  assert.equal(r.titles[2].band, 'MD'); assert.equal(r.titles[2].people, 150);
  assert.deepEqual(r.byWindow.get('Partner'), [300, 600]);
  assert.deepEqual(r.byWindow.get('Managing Director'), [0, 450]);
  assert.equal(r.total, 900 + 900 + 450, 'Company rows are not counted');
});

test('titlesReached: people uses rf, band falls back to Other, Director reads as MD-1, no windows is empty', () => {
  const r = D.titlesReached([win('2026-09-01', '2026-09-30', [jt('Software Engineer', 100, 1), jt('Director', 50, 1)])], { bands: BANDS, rf: 4 });
  assert.equal(r.titles[0].people, 25); assert.equal(r.titles[0].band, 'Other');
  assert.equal(r.titles[1].band, 'MD-1');
  assert.deepEqual(D.titlesReached([], { bands: BANDS }).titles, []);
  assert.deepEqual(D.titlesReached(null).titles, []);
});

test('titlesReached: a tagged subset is only counted when the window has no all-campaign Job Title rows', () => {
  const both = win('2026-09-01', '2026-09-30', [jt('Partner', 1000, 10), jt('Partner', 400, 4, 'Ani')]);
  assert.equal(D.titlesReached([both], { bands: BANDS }).titles[0].impressions, 1000);
  const onlyTagged = win('2026-09-01', '2026-09-30', [jt('Partner', 400, 4, 'Ani'), jt('Partner', 100, 1, 'Anju')]);
  assert.equal(D.titlesReached([onlyTagged], { bands: BANDS }).titles[0].impressions, 500);
});

test('titleStem strips seniority adjectives, regional suffixes and punctuation', () => {
  assert.equal(D.titleStem('Senior Manager – Technology'), 'senior manager');
  assert.equal(D.titleStem('Senior Manager, Technology Consulting'), 'senior manager');
  assert.equal(D.titleStem('Managing Director – Financial Services'), 'managing director');
  assert.equal(D.titleStem('Equity Partner'), 'partner');
  assert.equal(D.titleStem('Senior Partner'), 'partner');
  assert.equal(D.titleStem('Partner India'), 'partner');
  assert.equal(D.titleStem('Managing Director Asia Pacific'), 'managing director');
  assert.equal(D.titleStem('Partner, Head of AI Practice'), 'partner');
  assert.equal(D.titleStem('Partner & Head of AI'), 'partner');
  assert.equal(D.titleStem('Associate Director'), 'associate director', 'Associate Director is its own cohort, not Director');
  assert.equal(D.titleStem('Senior Vice President'), 'senior vice president', 'SVP is not VP');
  assert.equal(D.titleStem('Head of AI'), 'head of ai');
  assert.equal(D.titleStem(''), ''); assert.equal(D.titleStem(null), '');
});

test('titleCohorts groups exact titles by stem and lists them underneath', () => {
  const titles = D.titlesReached([win('2026-09-01', '2026-09-30', [
    jt('Senior Manager – Technology', 500, 5), jt('Senior Manager, Technology Consulting', 300, 3), jt('Senior Manager', 200, 2),
    jt('Managing Director', 400, 4), jt('Managing Director – Financial Services', 100, 1),
    jt('Partner', 350, 7), jt('Equity Partner', 50, 1), jt('Senior Partner', 60, 1),
    jt('Consultant', 90, 1),
  ])], { bands: BANDS, rf: 3 }).titles;
  const c = D.titleCohorts(titles);
  assert.deepEqual(c.map(x => x.cohort), ['Senior Manager', 'Managing Director', 'Partner', 'Consultant']);
  const sm = c[0];
  assert.equal(sm.impressions, 1000); assert.equal(sm.n, 3); assert.equal(sm.band, 'MD-2'); assert.equal(sm.ctr, 1);
  assert.deepEqual(sm.titles, ['Senior Manager – Technology', 'Senior Manager, Technology Consulting', 'Senior Manager']);
  assert.deepEqual(c[1].titles, ['Managing Director', 'Managing Director – Financial Services']); assert.equal(c[1].band, 'MD');
  assert.deepEqual(c[2].titles, ['Partner', 'Senior Partner', 'Equity Partner']); assert.equal(c[2].impressions, 460); assert.equal(c[2].people, Math.round(350 / 3) + Math.round(50 / 3) + Math.round(60 / 3));
  assert.equal(c[3].band, 'Other');
  assert.deepEqual(D.titleCohorts([]), []);
});

test('titleCohorts labels a cohort with the title-cased stem when no exact title equals it', () => {
  const c = D.titleCohorts([{ title: 'Managing Director – Financial Services', impressions: 10, clicks: 1, people: 3, band: 'MD' }, { title: 'Managing Director, EMEA', impressions: 5, clicks: 0, people: 2, band: 'MD' }]);
  assert.equal(c.length, 1); assert.equal(c[0].cohort, 'Managing Director'); assert.equal(c[0].n, 2);
});

test('companyCohorts counts leads, bands and exact titles per matched account', () => {
  const lead = (account, jobtitle, band) => ({ account, jobtitle, band, name: 'x' });
  const rows = [
    lead('Accenture', 'Partner', 'MD'), lead('Accenture', 'Partner', 'MD'), lead('Accenture', 'Partner', 'MD'),
    lead('Accenture', 'Director', 'MD-1'), lead('Accenture', 'Director', 'MD-1'),
    lead('Accenture', 'Senior Manager', 'MD-2'), lead('Accenture', '  Senior Manager ', 'MD-2'),
    lead('Accenture', 'Senior Manager – Technology', 'MD-2'),
    lead('Accenture', 'Analyst', 'Other'), lead('Accenture', '', 'Unknown'),
    lead('Deloitte', 'Managing Director', 'MD'), lead('Deloitte', 'senior manager', 'MD-2'), lead('Deloitte', 'Senior Manager', 'weird'),
    lead('', 'Partner', 'MD'), lead(null, 'Partner', 'MD'),
  ];
  const out = D.companyCohorts(rows);
  assert.deepEqual(out.map(a => [a.account, a.leads]), [['Accenture', 10], ['Deloitte', 3]], 'unmatched rows are left out');
  const acc = out[0];
  assert.deepEqual(acc.bands, { MD: 3, 'MD-1': 2, 'MD-2': 3, Other: 1, Unknown: 1 });
  assert.deepEqual(acc.titles.slice(0, 3), [{ title: 'Partner', n: 3, band: 'MD' }, { title: 'Director', n: 2, band: 'MD-1' }, { title: 'Senior Manager', n: 2, band: 'MD-2' }]);
  assert.ok(acc.titles.some(t => t.title === 'Senior Manager – Technology' && t.n === 1), 'exact dash title kept as exported');
  assert.ok(acc.titles.some(t => t.title === '(no title)' && t.band === 'Unknown'));
  assert.deepEqual(acc.cohorts.slice(0, 3), [{ cohort: 'Partner', n: 3 }, { cohort: 'Senior Manager', n: 3 }, { cohort: 'Director', n: 2 }]);
  const del = out[1];
  assert.equal(del.titles.length, 3);
  assert.ok(del.titles.some(t => t.title === 'senior manager') && del.titles.some(t => t.title === 'Senior Manager'), 'case is preserved, so differently-cased titles stay separate strings');
  assert.equal(del.bands.Unknown, 1, 'an unknown band value counts as Unknown');
  assert.deepEqual(del.cohorts[0], { cohort: 'Senior Manager', n: 2 }, 'but they share a cohort');
  assert.equal(D.titlesText(acc.titles, 3), 'Partner ×3 · Director ×2 · Senior Manager ×2 · +3 more');
});

test('companyCohorts limit and ordering', () => {
  const rows = []; for (let i = 0; i < 25; i++) for (let k = 0; k <= i % 5; k++) rows.push({ account: 'A' + i, jobtitle: 'Partner', band: 'MD' });
  assert.equal(D.companyCohorts(rows).length, 20);
  assert.equal(D.companyCohorts(rows, { limit: 5 }).length, 5);
  assert.equal(D.companyCohorts(rows, { limit: Infinity }).length, 25);
  assert.equal(D.companyCohorts(rows, { limit: 0 }).length, 25);
  const top = D.companyCohorts(rows, { limit: 5 }); assert.ok(top.every(a => a.leads === 5));
  assert.deepEqual(D.companyCohorts([]), []); assert.deepEqual(D.companyCohorts(null), []);
});
