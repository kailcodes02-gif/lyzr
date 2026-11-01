// Router, rendering and event wiring for the demo app. Screens live in ./pages/*.mjs and export
// ROUTES: [{ path: '/x' | /regex/, render(ctx), actions?, init?(route) }].
import { getSession, clearSession, track, flush } from '../../shared/session.mjs';
import * as store from './store.mjs';
import { closeOverlay, overlayOpen, toast, modal, field, input } from './ui.mjs';
import { sidebar, demoBar, explainer, ctrlPanel } from './shell.mjs';
import { explainKey, TOUR } from './explain.mjs';
import { answer } from './ctrl.mjs';
import { debounce } from './util.mjs';
import { ROUTES as overview } from './pages/overview.mjs';
import { ROUTES as spend } from './pages/spend.mjs';
import { ROUTES as inventory } from './pages/inventory.mjs';
import { ROUTES as govern } from './pages/govern.mjs';
import { ROUTES as gateway } from './pages/gateway.mjs';
import { ROUTES as guardrails } from './pages/guardrails.mjs';
import { ROUTES as posture } from './pages/posture.mjs';
import { ROUTES as observe } from './pages/observe.mjs';
import { ROUTES as admin } from './pages/admin.mjs';

const session = getSession();
if (!session) location.replace('../?gate=1');

const NOT_FOUND = { render: () => `<div class="empty"><h3>Nothing at this address</h3><p>The link may be old, or the thing it pointed to was removed or reset.</p><a class="btn" href="#/">Go to the Overview</a></div>` };
const ALL = [...overview, ...spend, ...inventory, ...govern, ...gateway, ...guardrails, ...posture, ...observe, ...admin];
const views = new Map();     // per-path view state (filters, tabs, pages)
let current = null;          // { route, page, view }
let ctrlOpen = false;
const thread = [];

function parseHash() {
  const h = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = h.split('?');
  return { path: path || '/', query: Object.fromEntries(new URLSearchParams(qs || '')) };
}

function match(path) {
  for (const r of ALL) {
    if (typeof r.path === 'string' && r.path === path) return { page: r, params: [] };
    if (r.path instanceof RegExp) { const m = r.path.exec(path); if (m) return { page: r, params: m.slice(1) }; }
  }
  return null;
}

function ctx() {
  return {
    route: current.route, v: current.view, params: current.route.params,
    set: (k, val) => { current.view[k] = val; render(); },
    render, go: (h) => { location.hash = h; }, store, session,
  };
}

function route() {
  const r = parseHash();
  if (r.path === '/audit') { location.replace('#/settings/audit-log'); return; }
  if (r.path === '/settings') { location.replace('#/settings/general'); return; }
  const m = match(r.path) || { page: NOT_FOUND, params: [] };
  r.params = m.params;
  // A screen keeps its tabs and filters while you come back to it the same way (back from an
  // asset to the list you were on); a link with a different query starts it fresh.
  const key = r.path;
  const qs = JSON.stringify(r.query);
  const kept = views.get(key);
  if (!kept || kept.qs !== qs) views.set(key, { qs, view: { ...(m.page.init ? m.page.init(r) : {}), ...coerce(r.query) } });
  current = { route: r, page: m.page, view: views.get(key).view };
  closeOverlay();
  document.body.classList.remove('nav-open');
  render(true);
  window.scrollTo(0, 0);
  track('view', r.path);
}
const coerce = (q) => Object.fromEntries(Object.entries(q).map(([k, v]) => [k, v === 'true' ? true : v === 'false' ? false : /^\d+$/.test(v) && k === 'page' ? Number(v) : v]));

function render(full = false) {
  if (!current) return;
  const act = document.activeElement;
  const focusBind = act && act.dataset && act.dataset.bind;
  const sel = focusBind && act.selectionStart != null ? [act.selectionStart, act.selectionEnd] : null;
  const side = document.getElementById('side');
  side.innerHTML = sidebar(current.route, session);
  document.getElementById('bar').innerHTML = demoBar(session);
  let html;
  try { html = current.page.render(ctx()); }
  catch (e) { console.error(e); html = `<div class="empty"><h3>This screen could not be drawn</h3><p>${String(e.message || e)}</p></div>`; }
  document.getElementById('page').innerHTML = html;
  document.getElementById('explain-slot').innerHTML = explainer(current.route);
  document.getElementById('ctrl-slot').innerHTML = ctrlOpen ? ctrlPanel(current.route, thread) : '';
  document.body.classList.toggle('ctrl-on', ctrlOpen);
  if (current.page.mount) current.page.mount(ctx());
  if (focusBind) {
    const el = document.querySelector(`#page [data-bind="${CSS.escape(focusBind)}"], #ctrl-slot [data-bind="${CSS.escape(focusBind)}"]`);
    if (el) { el.focus(); if (sel && el.setSelectionRange) try { el.setSelectionRange(sel[0], sel[1]); } catch { /* not a text input */ } }
  }
  if (full) document.title = `${(document.querySelector('#page h1') || {}).textContent || 'opencontroller'} · opencontroller demo`;
}

// ---- shell actions ----
const SHELL = {
  'ctrl-open': () => { ctrlOpen = true; render(); setTimeout(() => { const i = document.querySelector('.ctrl-foot input'); if (i) i.focus(); }, 30); },
  'ctrl-close': () => { ctrlOpen = false; render(); },
  'ctrl-ask': (el) => ask(el.dataset.q),
  theme: () => { store.setPref('theme', store.prefs.theme === 'dark' ? 'light' : 'dark'); applyTheme(); },
  password: () => toast('Passwords are managed by your identity provider. Nothing to change in the demo.'),
  signout: () => { flush(); clearSession(); location.href = '../'; },
  collapse: () => { document.body.classList.toggle('side-collapsed'); },
  'mobile-nav': () => document.body.classList.toggle('nav-open'),
  'nav-group': (el) => { const k = el.dataset.key; const c = { ...store.prefs.collapsed }; const isOpen = el.getAttribute('aria-expanded') === 'true'; c[k] = isOpen; store.setPref('collapsed', c); },
  'nav-nest': (el) => { const k = `nest-${el.dataset.key}`; const c = { ...store.prefs.collapsed }; c[k] = el.getAttribute('aria-expanded') === 'true'; store.setPref('collapsed', c); },
  'explain-min': (el) => { store.setPref('seen', { ...store.prefs.seen, [`min-${el.dataset.key}`]: true }); },
  'explain-open': (el) => { const s = { ...store.prefs.seen, [`open-${el.dataset.key}`]: true }; delete s[`min-${el.dataset.key}`]; store.prefs.explain = true; store.setPref('seen', s); },
  'explain-off': () => { store.setPref('explain', false); toast('Explainers are off. The "About this screen" button brings one back.'); },
  'tour-start': () => { store.prefs.seen = {}; store.setPref('explain', true); location.hash = TOUR[0][1]; },
  reset: () => modal({ title: 'Reset the demo data?', body: '<p>Every registration, approval, scan, key and setting you changed goes back to how the demo started.</p>', submit: 'Reset', danger: true, onSubmit: () => { store.reset(); toast('Demo data reset.'); track('action', current.route.path, 'Reset demo data'); } }),
  book: () => track('cta', current.route.path, 'Book a demo'),
  go: (el) => { location.hash = el.dataset.href; },
  copy: (el) => { navigator.clipboard && navigator.clipboard.writeText(el.dataset.text).then(() => toast('Copied.'), () => toast('Copy is blocked in this browser.', { tone: 'err' })); },
  set: (el) => {
    let val = el.dataset.val;
    try { val = JSON.parse(val); } catch { /* plain string */ }
    current.view[el.dataset.key] = val;
    if (el.dataset.key !== 'page') current.view.page = 0;
    render();
  },
};

function ask(q) {
  if (!q || !q.trim()) return;
  thread.push({ role: 'user', text: q.trim() });
  const a = answer(q);
  const msg = { role: 'bot', html: '', link: null };
  thread.push(msg);
  render();
  track('action', current.route.path, `Ask Ctrl: ${q.trim().slice(0, 120)}`);
  // stream the answer in, a few words at a time
  const words = a.html.split(/(\s+)/);
  let i = 0;
  const step = () => {
    i = Math.min(words.length, i + 6);
    msg.html = closeTags(words.slice(0, i).join(''));
    const body = document.getElementById('ctrl-body');
    const last = body && body.querySelectorAll('.msg.bot');
    if (last && last.length) last[last.length - 1].innerHTML = msg.html;
    if (body) body.scrollTop = body.scrollHeight;
    if (i < words.length) setTimeout(step, 28);
    else { msg.html = a.html; msg.link = a.link || null; render(); const b = document.getElementById('ctrl-body'); if (b) b.scrollTop = b.scrollHeight; }
  };
  setTimeout(step, 250);
}
function closeTags(html) { const d = document.createElement('div'); d.innerHTML = html; return d.innerHTML; }

function applyTheme() { document.documentElement.dataset.theme = store.prefs.theme; }

function wire() {
  document.addEventListener('click', (e) => {
    const menuBtn = e.target.closest('[data-menu]');
    document.querySelectorAll('.menu:not([hidden])').forEach((m) => { if (!menuBtn || m.id !== `menu-${menuBtn.dataset.menu}`) { m.hidden = true; const b = document.querySelector(`[data-menu="${m.id.slice(5)}"]`); if (b) b.setAttribute('aria-expanded', 'false'); } });
    if (menuBtn) { const m = document.getElementById(`menu-${menuBtn.dataset.menu}`); if (m) { m.hidden = !m.hidden; menuBtn.setAttribute('aria-expanded', String(!m.hidden)); } return; }
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    if (el.tagName === 'SELECT' || (el.tagName === 'INPUT' && el.type !== 'button')) return; // handled on change
    const name = el.dataset.act;
    const fn = (current.page.actions && current.page.actions[name]) || SHELL[name];
    if (!fn) return;
    if (el.tagName !== 'A' || name !== 'book') e.preventDefault();
    if (name === 'book') { SHELL.book(); return; }
    fn(el, ctx(), e);
  });
  document.addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset.act === 'role') { store.setPref('role', el.value); toast(`Now viewing as ${el.value}. ${el.value === 'Viewer' ? 'Changes are disabled, as for a read-only user.' : el.value === 'Operator' ? 'You can scan and register, not approve.' : 'You can change everything.'}`); track('action', current.route.path, `Role: ${el.value}`); return; }
    if (el.dataset.act && (el.type === 'checkbox' || el.tagName === 'SELECT')) {
      const fn = (current.page.actions && current.page.actions[el.dataset.act]) || SHELL[el.dataset.act];
      if (fn) fn(el, ctx(), e);
      return;
    }
    if (el.dataset.bind && el.tagName !== 'INPUT' || (el.dataset.bind && (el.type === 'checkbox' || el.type === 'radio'))) {
      current.view[el.dataset.bind] = el.type === 'checkbox' ? el.checked : el.value;
      current.view.page = 0;
      render();
    }
  });
  const onSearch = debounce((el) => { current.view[el.dataset.bind] = el.value; current.view.page = 0; render(); }, 140);
  document.addEventListener('input', (e) => {
    const el = e.target;
    if (el.dataset.bind && el.tagName === 'INPUT' && el.type !== 'checkbox' && el.type !== 'radio') onSearch(el);
    if (el.closest('.ctrl-foot')) el.closest('.ctrl-foot').querySelector('button').disabled = !el.value.trim();
  });
  document.addEventListener('submit', (e) => {
    const f = e.target.closest('[data-form]');
    if (!f) return;
    e.preventDefault();
    if (f.dataset.form === 'ctrl') { const q = f.q.value; f.q.value = ''; ask(q); return; }
    const fn = current.page.actions && current.page.actions[`form:${f.dataset.form}`];
    if (fn) fn(f, ctx(), e);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (overlayOpen()) { closeOverlay(); return; }
      document.querySelectorAll('.menu:not([hidden])').forEach((m) => { m.hidden = true; });
      if (ctrlOpen) { ctrlOpen = false; render(); }
    }
  });
  addEventListener('hashchange', route);
  addEventListener('resize', debounce(() => { if (current && current.page.mount) current.page.mount(ctx()); }, 120));
  store.on((kind) => { if (kind === 'scan') { // light refresh while a scan streams in
    document.getElementById('side').innerHTML = sidebar(current.route, session);
    if (current.page.live) document.getElementById('page').innerHTML = current.page.render(ctx());
    return; }
    if (kind === undefined) render();
  });
  // keep relative times fresh
  setInterval(() => { if (!overlayOpen() && !document.querySelector('.menu:not([hidden])') && !document.activeElement.matches('input,textarea,select')) render(); }, 60000);
}

if (session) {
  store.load();
  store.setMe(session.email);
  applyTheme();
  document.getElementById('app').hidden = false;
  wire();
  route();
}

// Exposed for the browser tests.
window.__oc = { store, go: (h) => { location.hash = h; }, answer, explainKey };
