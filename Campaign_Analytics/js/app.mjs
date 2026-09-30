// Shell: sign-in gate, navigation, global date range, view loader, toasts.
import { isBridging, signIn, restore, signOut, getToken } from './auth.mjs';
import { createApi } from './api.mjs';
import * as fmt from './fmt.mjs';
import * as heat from './heatmap.mjs';
import { COMPARE, compareRange } from './compare.mjs';
import * as ui from './ui.mjs';
import { mountInsights } from './insights.mjs';


// Sidebar: channels grouped by type. `file` is the view module; every ad platform other than
// LinkedIn shares views/ads-platform.mjs and reads its name from ctx.routeDef.
const ROUTES = [
  { route: 'overview', title: 'Overview', file: 'overview' },
  { grp: 'Ads' },
  { route: 'ads/linkedin', title: 'LinkedIn', group: 'Ads', file: 'linkedin' },
  { route: 'ads/google', title: 'Google Ads', group: 'Ads', file: 'ads-platform' },
  { route: 'ads/meta', title: 'Meta', group: 'Ads', file: 'ads-platform' },
  { route: 'ads/taboola', title: 'Taboola', group: 'Ads', file: 'ads-platform' },
  { route: 'ads/chatgpt', title: 'ChatGPT', group: 'Ads', file: 'ads-platform' },
  { route: 'ads/x', title: 'X (Twitter)', group: 'Ads', file: 'ads-platform' },
  { route: 'ads/bing', title: 'Microsoft Bing', group: 'Ads', file: 'ads-platform' },
  { route: 'linkedin/phantom', title: 'PhantomBuster', group: 'Ads', file: 'phantom' },
  { grp: 'Email' },
  { route: 'email/instantly', title: 'Instantly', group: 'Email', file: 'email' },
  { grp: 'HubSpot' },
  { route: 'hubspot/leads', title: 'Leads', group: 'HubSpot', file: 'leads' },
  { route: 'hubspot/messaging', title: 'Messaging', group: 'HubSpot', file: 'messaging' },
  { route: 'hubspot/pipeline', title: 'Pipeline', group: 'HubSpot', file: 'pipeline' },
  { grp: 'Admin' },
  { route: 'admin', title: 'Lists and connections', group: 'Admin', file: 'settings' },
].map(r => r.grp ? r : { ...r, sub: !!r.group });
const PAGES = ROUTES.filter(r => r.route);
// Addresses from the first version keep working.
const LEGACY = { linkedin: 'ads/linkedin', email: 'email/instantly', leads: 'hubspot/leads', messaging: 'hubspot/messaging', settings: 'admin' };
const PRESETS = [
  ['last14', 'Last 14 days'], ['last30', 'Last 30 days'], ['thisMonth', 'This month'], ['lastMonth', 'Last month'],
  ['last90', 'Last 90 days'], ['ytd', 'This year'], ['all', 'All time'], ['custom', 'Custom'],
];
// "Compare with": every page's "vs" numbers use this comparison range.
export { compareRange };
const $ = id => document.getElementById(id);
const ctx = { api: null, state: null, user: null, fmt, heat, ui, toast, mountInsights, nav: go, ROUTES: PAGES };
let current = null, currentMod = null;

function toast(msg, kind = '') {
  const t = document.createElement('div'); t.className = 'toast ' + kind; t.textContent = msg; $('toasts').appendChild(t);
  setTimeout(() => t.remove(), kind === 'err' ? 7000 : 3500);
}

function presetRange(p) {
  const t = fmt.today();
  if (p === 'last14') return [fmt.addDays(t, -13), t];
  if (p === 'last30') return [fmt.addDays(t, -29), t];
  if (p === 'last90') return [fmt.addDays(t, -89), t];
  if (p === 'thisMonth') return [t.slice(0, 8) + '01', t];
  if (p === 'lastMonth') { const d = new Date(t.slice(0, 7) + '-01T00:00:00'); d.setDate(0); const end = fmt.isoDay(d); return [end.slice(0, 8) + '01', end]; }
  if (p === 'ytd') return [t.slice(0, 4) + '-01-01', t];
  if (p === 'all') return ['2026-01-01', t];
  return null;
}
function loadRange() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem('ca.range') || 'null'); } catch {}
  if (!(s && s.from && s.to)) { const [from, to] = presetRange('last30'); s = { preset: 'last30', from, to }; }
  s.cmp = COMPARE.some(([m]) => m === s.cmp) ? s.cmp : 'prev';
  s.cmpN = Math.min(52, Math.max(1, parseInt(s.cmpN, 10) || 4));
  return s;
}
function setRange(next, silent) {
  ctx.state = { ...ctx.state, ...next, tz: 'Asia/Kolkata' };
  ctx.state.prev = compareRange(ctx.state.from, ctx.state.to, ctx.state.cmp, ctx.state.cmpN);
  localStorage.setItem('ca.range', JSON.stringify({ preset: ctx.state.preset, from: ctx.state.from, to: ctx.state.to, cmp: ctx.state.cmp, cmpN: ctx.state.cmpN }));
  $('rangePreset').value = ctx.state.preset; $('rangeFrom').value = ctx.state.from; $('rangeTo').value = ctx.state.to;
  $('cmpMode').value = ctx.state.cmp; $('cmpN').value = ctx.state.cmpN; $('cmpN').classList.toggle('hidden', !/^(weeks|months)$/.test(ctx.state.cmp));
  if (!silent) window.dispatchEvent(new CustomEvent('ca:range', { detail: ctx.state }));
}

async function boot() {
  const demo = new URLSearchParams(location.search).get('demo') === '1' || localStorage.getItem('ca.demo') === '1';
  $('msBtn').onclick = async () => { $('gerr').textContent = ''; try { const u = await signIn(); enter(u, false); } catch (e) { $('gerr').textContent = 'Sign-in failed' + (e && (e.errorCode || e.message) ? ': ' + (e.errorCode || e.message) : '.'); } };
  $('demoBtn').onclick = () => { localStorage.setItem('ca.demo', '1'); enter({ name: 'Demo viewer', email: 'demo@lyzr.com' }, true); };
  if (demo) return enter({ name: 'Demo viewer', email: 'demo@lyzr.com' }, true);
  const u = await restore();
  if (u) enter(u, false);
}

async function enter(user, demo) {
  ctx.user = user; ctx.demo = demo;
  if (demo) { const m = await import('./mock.mjs'); ctx.api = m.createMockApi(); $('demoTag').classList.remove('hidden'); }
  else ctx.api = createApi(getToken);
  $('gate').classList.add('hidden'); $('app').classList.remove('hidden');
  $('uname').textContent = user.name || user.email; $('uav').textContent = (user.name || user.email || '?')[0].toUpperCase();
  $('signout').onclick = () => { localStorage.removeItem('ca.demo'); if (demo) location.reload(); else signOut(); };
  $('nav').innerHTML = ROUTES.map(r => r.grp ? `<div class="grp">${fmt.esc(r.grp)}</div>` : `<a href="#/${r.route}" data-r="${r.route}" class="${r.sub ? 'sub' : ''}">${fmt.esc(r.title)}${r.soon ? '<span class="soon">soon</span>' : ''}</a>`).join('');
  $('rangePreset').innerHTML = PRESETS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
  $('cmpMode').innerHTML = COMPARE.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
  $('cmpMode').onchange = e => setRange({ cmp: e.target.value });
  $('cmpN').onchange = e => setRange({ cmpN: Math.min(52, Math.max(1, parseInt(e.target.value, 10) || 1)) });
  if (window.Chart) { Chart.defaults.font.family = "'General Sans','Inter',system-ui,sans-serif"; Chart.defaults.color = '#4A4744'; Chart.defaults.borderColor = '#EFEFED'; }
  ctx.state = loadRange(); setRange(ctx.state, true);
  $('rangePreset').onchange = e => { const p = e.target.value; const r = presetRange(p); if (r) setRange({ preset: p, from: r[0], to: r[1] }); else setRange({ preset: 'custom' }); };
  const custom = () => { const from = $('rangeFrom').value, to = $('rangeTo').value; if (from && to && from <= to) setRange({ preset: 'custom', from, to }); };
  $('rangeFrom').onchange = custom; $('rangeTo').onchange = custom;
  $('foot').innerHTML = `Lyzr Campaign Analytics · Instantly and HubSpot are pulled automatically every morning at 07:00 IST (read-only) · LinkedIn and Instantly exports can be uploaded on their pages any time · money in USD, times in IST${demo ? ' · <b>sample data</b>: made-up numbers, nothing is saved' : ''}`;
  window.addEventListener('hashchange', route);
  window.addEventListener('ca:range', () => { if (currentMod && currentMod.render) route(true); });
  // Preload settings once so views can read bands, regions, accounts, icp pools.
  try { ctx.settings = await ctx.api.get('settings'); } catch (e) { ctx.settings = null; if (!demo) toast('Settings could not be loaded: ' + e.message, 'err'); }
  route();
}

// Views can hide the range picker (e.g. Settings) by exporting `noRange = true`.
async function route(rerender) {
  let r = location.hash.replace(/^#\/?/, '').split('?')[0].replace(/\/+$/, '') || 'overview';
  if (LEGACY[r]) { location.replace('#/' + LEGACY[r]); return; }
  const def = PAGES.find(x => x.route === r) || PAGES[0];
  ctx.routeDef = def;
  document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('on', a.dataset.r === def.route));
  $('crumb').textContent = def.group ? `${def.group} › ${def.title}` : def.title;
  const main = $('main');
  if (!rerender && currentMod && currentMod.destroy) { try { currentMod.destroy(); } catch {} }
  main.innerHTML = ui.spinner('Loading ' + def.title);
  try {
    const mod = await import(`./views/${def.file}.mjs`);
    currentMod = mod; current = def.route;
    $('rangeBox').classList.toggle('hidden', !!mod.noRange);
    await mod.render(main, ctx);
    if (!rerender) window.scrollTo(0, 0);
  } catch (e) {
    console.error(e);
    main.innerHTML = `<div class="empty">This section failed to load: ${fmt.esc(e.message || e)}</div>`;
  }
}
export function go(route) { location.hash = '#/' + route; }

if (isBridging()) { /* popup relay, stop here */ } else boot();
