// LinkedIn page part: penetration by account tier, and the actionable items read off the cube.
//   mount(slot, ctx, data)  data = { cube, accounts, regions, frequency, isEditor, rerender, ... } from linkedin.mjs
// Tiers come from js/lib/tiers.mjs: rules first (named firms, category, industry + headcount), then the
// `account_tiers` setting (Claude Sonnet classifications and manual edits in Admin › GSI accounts).
// Two paired views of the same cumulative cube: Tier 1 (GSI + Big Four + MBB) against Tier 2 (SI + Other),
// and the four tiers side by side; each is region × designation band with the same reach model and
// colour breaks as the company cube above, so the numbers agree.
import * as A from '../../lib/linkedin-agg.mjs';
import { TIERS, TIER_LABEL, TIER_GROUP, tierOf, ruleTier } from '../../lib/tiers.mjs';
import { TIER_COLORS } from '../../palette.mjs';
import { fmt, esc } from '../../fmt.mjs';
import { trackAction } from '../../actions.mjs';

const GROUPS = ['Tier 1', 'Tier 2'];
const BANDS = [...A.PEN_BANDS, 'All'];

/** Roll the cube up by a key per account: -> Map(key -> { accounts:n, reachedAccounts:n, total:{band:cell}, regions:{region:{band:cell}} }). Pure. */
export function rollup(cube, keyOf) {
  const blank = () => { const o = {}; for (const b of BANDS) o[b] = { reached: 0, reached_pooled: 0, imp: 0, pool: 0, pct: null, exposure: null, freq: null, has_pool: false, est_pool: false }; return o; };
  const add = (t, c) => { for (const b of BANDS) { const x = c[b]; if (!x) continue; t[b].reached += x.reached || 0; t[b].imp += x.imp || 0; if (x.has_pool) { t[b].reached_pooled += x.reached_pooled != null ? x.reached_pooled : x.reached || 0; t[b].pool += x.pool || 0; t[b].has_pool = true; if (x.est_pool) t[b].est_pool = true; } } };
  const finish = t => { for (const b of BANDS) { const x = t[b]; x.pct = x.has_pool && x.pool ? Math.min(100, x.reached_pooled / x.pool * 100) : null; x.exposure = x.has_pool && x.pool ? x.imp / x.pool : null; x.freq = x.reached ? x.imp / x.reached : null; } return t; };
  const out = new Map();
  for (const a of cube.accounts || []) {
    const k = keyOf(a.account); if (!k) continue;
    if (!out.has(k)) out.set(k, { key: k, accounts: 0, reachedAccounts: 0, total: blank(), regions: {}, names: [] });
    const g = out.get(k); g.accounts++; if (a.total.All.reached > 0) g.reachedAccounts++; g.names.push(a.account);
    add(g.total, a.total);
    for (const [r, cell] of Object.entries(a.regions || {})) { if (!g.regions[r]) g.regions[r] = blank(); add(g.regions[r], cell); }
  }
  for (const g of out.values()) { finish(g.total); for (const r of Object.keys(g.regions)) finish(g.regions[r]); }
  return out;
}

export async function mount(slot, ctx, data) {
  const { cube, accounts, frequency, isEditor, rerender } = data;
  const S = ctx.settings || {};
  const tiersSetting = S.account_tiers && typeof S.account_tiers === 'object' ? S.account_tiers : {};
  const tier = name => tierOf(name, tiersSetting, accounts);
  const group = name => TIER_GROUP[tier(name)] || 'Tier 2';
  const reachedNames = (cube.accounts || []).map(a => a.account);
  const unclassified = reachedNames.filter(n => !tiersSetting[n] && !ruleTier(accounts.find(a => a.name === n) || { name: n }));
  const byTier = rollup(cube, tier), byGroup = rollup(cube, group);
  const regionOrder = cube.regions || [];
  const cell = (t, b, who, metric) => {
    if (!t || !t[b]) return { v: null, text: '·' };
    const x = t[b];
    if (metric === 'pct') { if (x.pct == null) return { v: null, text: x.reached ? '·' : '–', title: `${who} · ${b}: ${x.reached ? fmt(x.reached) + ' reached, no pool' : 'nobody reached'}` }; return { v: A.penLevel(x.pct), text: fmt(x.pct, x.pct < 10 ? 1 : 0) + '%', sub: `${fmt(x.reached_pooled)} / ${fmt(x.pool)}${x.est_pool ? ' est.' : ''}`, title: `${who} · ${b}\nPeople reached: ${fmt(x.reached_pooled)} of ${fmt(x.pool)}${x.reached > x.reached_pooled + 0.5 ? ` (+${fmt(x.reached - x.reached_pooled)} in countries with no pool)` : ''}\nImpressions: ${fmt(x.imp)} = ${fmt(x.exposure, 2)} per person in the pool, ${fmt(x.freq, 1)} per person reached\nPenetration: ${fmt(x.pct, 1)}%` }; }
    if (metric === 'exposure') { if (x.exposure == null) return { v: null, text: x.imp ? '·' : '–' }; return { v: A.exposureLevel(x.exposure), text: fmt(x.exposure, x.exposure < 10 ? 1 : 0), sub: `${fmt(x.imp)} imp`, title: `${who} · ${b}: ${fmt(x.imp)} impressions on ${fmt(x.pool)} people in the pool` }; }
    const v = metric === 'reached' ? x.reached : x.pool; return { v: v || 0, text: v ? fmt(v) : '–', title: `${who} · ${b}: ${fmt(v)} ${metric === 'reached' ? 'people reached' : 'in the pool'}` };
  };
  const legend = metric => metric === 'pct' ? [['under 5%', 1], ['5 to 15%', 2], ['15 to 35%', 3], ['35 to 70%', 4], ['over 70%', 5]].map(([l, k]) => `<span><i style="display:inline-block;width:14px;height:14px;border-radius:3px;vertical-align:-2px;margin-right:4px;background:${ctx.heat.cellColor(k, 5, { scale: 'linear' })}"></i>${l}</span>`).join('') : metric === 'exposure' ? '<span>impressions per person in the pool: under 0.5 light, 10 and over saturated</span>' : ctx.heat.legend('orange');
  const summaryRows = keys => keys.map(k => { const g = byTier.get(k) || byGroup.get(k); const t = g ? g.total.All : null; return `<tr><td class="l"><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${TIER_COLORS[k] || '#A8A298'};margin-right:6px;vertical-align:middle"></span><b>${esc(TIER_LABEL[k] || k)}</b></td><td>${g ? fmt(g.reachedAccounts) : '–'}</td><td>${t && t.has_pool ? fmt(t.pool) : '–'}</td><td>${t ? fmt(t.reached) : '–'}</td><td>${t && t.pct != null ? fmt(t.pct, 1) + '%' : '–'}</td><td>${t && t.exposure != null ? fmt(t.exposure, 2) : '–'}</td><td>${t && t.freq != null ? fmt(t.freq, 1) : '–'}</td></tr>`; }).join('');
  const mapsHtml = (keys, id) => `<div class="grid2 tiermaps" id="${id}">${keys.map(k => `<div class="card"><div class="ui-label" style="color:${TIER_COLORS[k] || 'var(--ink2)'}">${esc(TIER_LABEL[k] || k)} · ${fmt((byTier.get(k) || byGroup.get(k) || { reachedAccounts: 0 }).reachedAccounts)} companies reached</div><div class="tblwrap" style="border:none" data-map="${esc(k)}"></div></div>`).join('')}</div>`;

  slot.innerHTML = ctx.ui.section('Penetration by tier', `The company cube above rolled up by tier. <b>Tier 1</b> = global system integrators, the Big Four and MBB; <b>Tier 2</b> = mid-size SIs and advisory firms (Publicis Sapient, Firstsource, Movate, Oliver Wyman and their peers) and everything else. Tiers come from fixed rules (named firms, the account's category, industry and headcount) with Claude Sonnet deciding the rest once and the answer saved; edit any tier in Admin › GSI accounts › Account tiers. Same reach model as the cube: one window equals impressions ÷ ${fmt(frequency, 1)}, further windows flatten towards the pool.`,
    `<div class="row" style="gap:16px;flex-wrap:wrap;align-items:center"><div id="tierMetric"></div><span class="muted" style="font-size:12.5px" id="tierNote"></span></div>
     <div class="tblwrap" style="margin:10px 0 14px"><table><thead><tr><th class="l">Tier</th><th>Companies reached</th><th>Pool</th><th>People reached</th><th>Penetration</th><th>Exposure</th><th>Frequency</th></tr></thead><tbody>${summaryRows(GROUPS)}${summaryRows(TIERS.filter(t => byTier.has(t)))}</tbody></table></div>
     <h3 style="margin:14px 0 6px">Tier 1 vs Tier 2</h3>${mapsHtml(GROUPS, 'tierGroups')}
     <h3 style="margin:18px 0 6px">GSI vs SI vs Big Four vs MBB</h3>${mapsHtml(TIERS.filter(t => t !== 'Other' || byTier.has('Other')), 'tierFour')}
     <div class="legend" id="tierLegend"></div>`, 'li-tiers-section')
    + ctx.ui.section('What to do next', 'Read off the cube with fixed rules, so the list means the same thing every time: <b>extend</b> = a pool of 50 or more people with under 5% reached; <b>rotate</b> = 8 or more impressions per person in the pool with over a third reached, so the same people keep seeing the ads; <b>open a region</b> = a company reached in one region with an unreached pool of 50 or more elsewhere; <b>reach the MD band</b> = MD penetration under a third of MD-2. Track turns an item into an action in the tracker.',
      `<div id="tierActions"></div>`, 'li-actions');

  let metric = 'pct';
  const drawMaps = () => {
    slot.querySelectorAll('[data-map]').forEach(box => {
      const k = box.dataset.map; const g = byTier.get(k) || byGroup.get(k);
      if (!g) { box.innerHTML = ctx.ui.empty('No company in this tier was reached in these dates.'); return; }
      const rows = regionOrder.filter(r => g.regions[r]).map(r => ({ key: r, label: r }));
      rows.push({ key: '\u0000all', label: 'All regions', cls: 'grp' });
      ctx.heat.renderHeat(box, { corner: 'Region', rows, cols: BANDS.map(b => ({ key: b, label: b === 'All' ? 'All bands' : b })), sortRows: false, scale: metric === 'pct' || metric === 'exposure' ? 'linear' : 'sqrt', max: metric === 'pct' || metric === 'exposure' ? 5 : undefined,
        cell: (r, c) => cell(r === '\u0000all' ? g.total : g.regions[r], c, `${TIER_LABEL[k] || k} · ${r === '\u0000all' ? 'all regions' : r}`, metric) });
      box.querySelectorAll('td.c').forEach(td => { const t = td.dataset.r === '\u0000all' ? g.total : g.regions[td.dataset.r]; if (t && t[td.dataset.c] && t[td.dataset.c].est_pool) td.classList.add('est'); });
    });
    slot.querySelector('#tierLegend').innerHTML = legend(metric) + '<span><i style="display:inline-block;width:14px;height:14px;border-radius:3px;vertical-align:-2px;margin-right:4px;border:1px dashed var(--ink2)"></i>dashed = estimated pool</span>';
  };
  ctx.ui.seg(slot.querySelector('#tierMetric'), [{ value: 'pct', label: 'Penetration %' }, { value: 'reached', label: 'People reached' }, { value: 'pool', label: 'ICP pool' }, { value: 'exposure', label: 'Exposure' }], v => { metric = v; drawMaps(); }, metric);
  drawMaps();

  // Classification state and the one-off Claude pass (editors): loops the endpoint until nothing is left.
  const note = slot.querySelector('#tierNote');
  const saved = Object.keys(tiersSetting).length;
  note.innerHTML = `${fmt(reachedNames.length)} companies reached · ${fmt(saved)} tiers saved${unclassified.length ? ` · <b>${fmt(unclassified.length)} reached compan${unclassified.length === 1 ? 'y' : 'ies'} still unclassified</b> (counted as Tier 2 / Other for now)${isEditor ? ' <button class="btn tiny" data-classify>Classify with Claude</button>' : ''}` : ''}`;
  const btn = note.querySelector('[data-classify]');
  if (btn) btn.onclick = async () => {
    btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Classifying';
    try {
      let done = 0, remaining = unclassified.length, guard = 0;
      while (remaining > 0 && guard++ < 40) {
        const r = await ctx.api.post('account-tiers', { accounts: unclassified, limit: 80 });
        done += (r.tiers || []).length; remaining = r.remaining || 0;
        btn.innerHTML = `<span class="spin"></span> ${fmt(done)} classified, ${fmt(remaining)} to go`;
        if (!(r.tiers || []).length) break;
      }
      try { ctx.settings = await ctx.api.get('settings'); } catch { /* keep */ }
      ctx.toast(`${fmt(done)} companies classified with Claude Sonnet. Redrawing.`);
      if (rerender) rerender();
    } catch (e) { btn.disabled = false; btn.textContent = 'Classify with Claude'; ctx.toast('Classification failed: ' + (e.message || e), 'err'); }
  };

  // Actionable items.
  const acts = A.penetrationActions(cube, { tiers: n => TIER_LABEL[tier(n)] || tier(n) });
  const box = slot.querySelector('#tierActions');
  if (!acts.length) box.innerHTML = ctx.ui.empty(cube.accounts && cube.accounts.length ? 'Nothing stands out: every reached company with a pool is between 5% and saturation, in every region with a pool.' : 'No company with a reach pool was reached in these dates.');
  else {
    const KIND = { extend: 'Extend reach', rotate: 'Rotate creative', region: 'Open a region', md: 'Reach the MD band' };
    box.innerHTML = `<div class="tblwrap"><table><thead><tr><th class="l">Item</th><th class="l">Evidence</th><th class="l">Do</th>${isEditor ? '<th></th>' : ''}</tr></thead><tbody>${acts.map((a, i) => `<tr><td class="l"><span class="pill p-na">${esc(KIND[a.kind] || a.kind)}</span><br><b>${esc(a.title)}</b></td><td class="l" style="font-size:13px">${esc(a.evidence)}</td><td class="l" style="font-size:13px">${esc(a.action)}</td>${isEditor ? `<td><button class="btn tiny" data-track="${i}">Track</button></td>` : ''}</tr>`).join('')}</tbody></table></div>`;
    box.querySelectorAll('[data-track]').forEach(b => b.onclick = async () => {
      const a = acts[+b.dataset.track]; b.disabled = true;
      try { await trackAction(ctx, 'linkedin', { title: a.title, evidence: a.evidence, action: a.action }, 'linkedin:penetration'); b.textContent = 'Tracked'; ctx.toast('Added to the action tracker.'); }
      catch (e) { b.disabled = false; ctx.toast('Could not track: ' + (e.message || e), 'err'); }
    });
  }
}
