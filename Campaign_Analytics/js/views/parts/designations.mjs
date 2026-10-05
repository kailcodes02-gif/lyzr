// LinkedIn page part: exact designations. Mounted by views/linkedin.mjs into <div id="li-designations">.
// 1. Titles reached: the Job Title rows of the demographics exports (programme-wide; LinkedIn exports no title x company cross-tab).
// 2. Designation cohorts by company: the job titles of HubSpot form leads matched to target accounts.
// Every section is a plain HTML string appended to the slot; nothing here may throw into the page.
import { titlesReached, titleCohorts, companyCohorts, titlesText } from '../../lib/designations-agg.mjs';
import { enrich, isFormLead } from '../../lib/leads-agg.mjs';

const TOP_TITLES = 40, TOP_ACCOUNTS = 20;
const BAND_CLS = { MD: 'p-high', 'MD-1': 'p-med', 'MD-2': 'p-low', Other: 'p-na', Unknown: 'p-na' }; // same colours as the Leads page

export async function mount(slot, ctx, data = {}) {
  if (!slot) return;
  const F = ctx.fmt, { esc, fmt, pct } = F;
  const ui = ctx.ui;
  const bandPill = b => ui.pill ? ui.pill(b, BAND_CLS[b] || 'p-na') : esc(b);

  // ---- 1. titles reached (exports) ----
  try {
    const windows = Array.isArray(data.windows) ? data.windows : [];
    const R = titlesReached(windows, { bands: data.bands, rf: data.rf });
    const nWin = windows.filter(w => (w.rows || []).some(r => String(r.segment || '').toLowerCase().replace(/[^a-z]/g, '') === 'jobtitle')).length;
    const sub = `The exact job titles LinkedIn put in the Professional Demographics exports for these dates, as written there, summed across the ${nWin || windows.length} export window${(nWin || windows.length) === 1 ? '' : 's'} in range. LinkedIn lists only the top 25 titles per export and hides tiny ones, so the long tail is missing and the shares below are of the titles listed, not of all impressions. Band from Admin › Designations (Director counts as MD-1 here). People = impressions ÷ ${fmt(data.rf || 3, 1)}. LinkedIn exports no title × company cross-tab; the per-company view below comes from HubSpot leads instead.`;
    if (!R.titles.length) {
      slot.insertAdjacentHTML('beforeend', ui.section('Designations reached (exact titles from the exports)', sub, ui.empty('No Job Title breakdown in these dates. Upload the Professional Demographics export for these dates again (it carries every breakdown).'), 'li-designations-titles'));
    } else {
      slot.insertAdjacentHTML('beforeend', ui.section('Designations reached (exact titles from the exports)', sub, `<div class="row" style="gap:16px;flex-wrap:wrap;align-items:center;margin-bottom:8px"><div id="desigMode"></div><span class="muted" id="desigCount" style="font-size:12.5px"></span></div><div id="desigBody"></div>`, 'li-designations-titles'));
      const body = slot.querySelector('#desigBody'), count = slot.querySelector('#desigCount');
      const cohorts = titleCohorts(R.titles);
      const shareOf = v => R.total ? pct(v / R.total * 100, 1) : '–';
      const draw = mode => {
        try {
          if (mode === 'cohort') {
            const rows = cohorts.slice(0, TOP_TITLES);
            body.innerHTML = ui.table({ cols: [
              { k: 'cohort', h: 'Cohort', left: true, f: r => `<b>${esc(r.cohort)}</b>${r.n > 1 || r.titles[0] !== r.cohort ? `<div class="muted" style="font-size:12px;margin-top:2px;max-width:520px;white-space:normal">${r.titles.map(esc).join(' · ')}</div>` : ''}` },
              { k: 'n', h: 'Titles', f: r => fmt(r.n) },
              { k: 'band', h: 'Band', f: r => bandPill(r.band) },
              { k: 'impressions', h: 'Impressions', f: r => fmt(r.impressions) },
              { k: 'clicks', h: 'Clicks', f: r => fmt(r.clicks) },
              { k: 'ctr', h: 'CTR', f: r => pct(r.ctr, 2) },
              { k: 'people', h: 'People (est.)', f: r => fmt(r.people) },
              { k: 'share', h: 'Share of title impressions', f: r => shareOf(r.impressions) },
            ], rows });
            count.textContent = `${fmt(rows.length)} of ${fmt(cohorts.length)} cohorts from ${fmt(R.titles.length)} exact titles`;
          } else {
            const rows = R.titles.slice(0, TOP_TITLES);
            body.innerHTML = ui.table({ cols: [
              { k: 'title', h: 'Title', left: true, f: r => `${esc(r.title)}${r.windows > 1 ? ` <span class="muted" style="font-size:11.5px">· ${r.windows} windows</span>` : ''}` },
              { k: 'band', h: 'Band', f: r => bandPill(r.band) },
              { k: 'impressions', h: 'Impressions', f: r => fmt(r.impressions) },
              { k: 'clicks', h: 'Clicks', f: r => fmt(r.clicks) },
              { k: 'ctr', h: 'CTR', f: r => pct(r.ctr, 2) },
              { k: 'people', h: 'People (est.)', f: r => fmt(r.people) },
              { k: 'share', h: 'Share of title impressions', f: r => shareOf(r.impressions) },
            ], rows });
            count.textContent = `${fmt(rows.length)} of ${fmt(R.titles.length)} exact titles`;
          }
        } catch (e) { body.innerHTML = ui.empty('Designations could not be drawn: ' + (e && e.message || e)); }
      };
      ui.seg(slot.querySelector('#desigMode'), [{ value: 'all', label: 'All titles' }, { value: 'cohort', label: 'By cohort' }], draw, 'all');
      draw('all');
    }
  } catch (e) {
    slot.insertAdjacentHTML('beforeend', ui.section('Designations reached (exact titles from the exports)', '', ui.empty('Designations could not be drawn: ' + (e && e.message || e)), 'li-designations-titles'));
  }

  // ---- 2. designation cohorts by company (HubSpot leads) ----
  const sub2 = `HubSpot form leads created ${esc(F.rangeLabel(data.from, data.to))} whose company matches a target account (Admin › GSI accounts), with the job title each lead typed or HubSpot holds, exactly as stored. Band uses that firm's own titles (MD, MD-1, MD-2; everyone else Other, no title Unknown). This is the only title × company read available: LinkedIn demographics do not cross titles with companies.`;
  slot.insertAdjacentHTML('beforeend', ui.section('Designation cohorts by company (from HubSpot leads)', sub2, `<div id="desigCoBody">${ui.spinner('Loading HubSpot leads')}</div>`, 'li-designations-companies'));
  const coBody = slot.querySelector('#desigCoBody');
  try {
    const d = await ctx.api.get('hubspot', { from: data.from, to: data.to });
    const accounts = Array.isArray(data.accounts) ? data.accounts : [];
    const leads = enrich((d && d.contacts || []).filter(isFormLead), d && d.notes_by_contact || {}, accounts).filter(r => r.account);
    const all = companyCohorts(leads, { limit: Infinity });
    if (!all.length) { coBody.innerHTML = ui.empty(`No HubSpot form leads at target accounts ${F.rangeLabel(data.from, data.to)}.`); return; }
    // optional tier chips (Admin › account tiers), only when the setting exists
    let tierOf = null, tiers = [];
    const accountTiers = ctx.settings && ctx.settings.account_tiers;
    if (accountTiers && typeof accountTiers === 'object') {
      try { const T = await import('../../lib/tiers.mjs'); tierOf = name => T.tierOf(name, accountTiers, accounts); tiers = T.TIERS.filter(t => all.some(a => tierOf(a.account) === t)).map(t => ({ value: t, label: T.TIER_LABEL[t] || t })); } catch { tierOf = null; }
    }
    let tier = 'all', showAll = false;
    const draw = () => {
      try {
        const list = tier === 'all' || !tierOf ? all : all.filter(a => tierOf(a.account) === tier);
        const rows = showAll ? list : list.slice(0, TOP_ACCOUNTS);
        const tot = { leads: 0, MD: 0, 'MD-1': 0, 'MD-2': 0, Other: 0, Unknown: 0 };
        for (const a of list) { tot.leads += a.leads; for (const b of Object.keys(a.bands)) tot[b] += a.bands[b]; }
        const tbl = ui.table({ cols: [
          { k: 'account', h: 'Account', left: true, f: r => `<b>${esc(r.account)}</b>${tierOf ? ` <span class="muted" style="font-size:11.5px">· ${esc(tierOf(r.account))}</span>` : ''}` },
          { k: 'leads', h: 'Leads', f: r => fmt(r.leads) },
          { k: 'MD', h: 'MD', f: r => r.bands.MD ? fmt(r.bands.MD) : '<span class="muted">–</span>' },
          { k: 'MD-1', h: 'MD-1', f: r => r.bands['MD-1'] ? fmt(r.bands['MD-1']) : '<span class="muted">–</span>' },
          { k: 'MD-2', h: 'MD-2', f: r => r.bands['MD-2'] ? fmt(r.bands['MD-2']) : '<span class="muted">–</span>' },
          { k: 'other', h: 'Other / unknown', f: r => (r.bands.Other + r.bands.Unknown) ? fmt(r.bands.Other + r.bands.Unknown) : '<span class="muted">–</span>' },
          { k: 'titles', h: 'Designations (exact, with counts)', left: true, f: r => `<div style="max-width:560px;white-space:normal;font-size:12.5px" title="${esc(r.titles.map(t => `${t.title} ×${t.n}`).join('\n'))}">${esc(titlesText(r.titles, 8))}</div>` },
        ], rows, total: { account: '<b>Total</b>', leads: `<b>${fmt(tot.leads)}</b>`, MD: fmt(tot.MD), 'MD-1': fmt(tot['MD-1']), 'MD-2': fmt(tot['MD-2']), other: fmt(tot.Other + tot.Unknown), titles: `<span class="muted">${fmt(list.length)} account${list.length === 1 ? '' : 's'}</span>` } });
        coBody.innerHTML = `<div class="row" style="gap:16px;flex-wrap:wrap;align-items:center;margin-bottom:8px">${tiers.length ? '<div id="desigTier"></div>' : ''}<span class="muted" style="font-size:12.5px">${fmt(rows.length)} of ${fmt(list.length)} accounts, ${fmt(tot.leads)} leads${list.length > TOP_ACCOUNTS ? ` · <a href="#" data-toggle>${showAll ? `show top ${TOP_ACCOUNTS}` : 'show all'}</a>` : ''}</span></div>${tbl}`;
        const tg = coBody.querySelector('[data-toggle]'); if (tg) tg.onclick = e => { e.preventDefault(); showAll = !showAll; draw(); };
        const te = coBody.querySelector('#desigTier'); if (te) ui.seg(te, [{ value: 'all', label: 'All tiers' }, ...tiers], v => { tier = v; showAll = false; draw(); }, tier);
      } catch (e) { coBody.innerHTML = ui.empty('Company designations could not be drawn: ' + (e && e.message || e)); }
    };
    draw();
  } catch (e) {
    coBody.innerHTML = ui.empty('HubSpot leads could not be loaded: ' + (e && e.message || e));
  }
}
