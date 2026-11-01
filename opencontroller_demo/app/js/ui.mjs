// Building blocks every screen is made of. Screens return HTML strings; interaction goes through
// data-act (clicks, handled by the screen's actions or the shell) and data-bind (inputs that
// write into the screen's view state and re-render).
import { esc, attr, int, initials } from './util.mjs';
import { icon, cloudIcon, CLOUD_NAME, KIND_ICON } from './icons.mjs';
import { can, why, kindOne } from './store.mjs';

export { esc, icon };

export function btn(label, o = {}) {
  const allowed = !o.perm || can(o.perm);
  const dis = o.disabled || !allowed;
  const title = !allowed ? why(o.perm) : o.title || '';
  const cls = `btn ${o.kind ? 'btn-' + o.kind : ''} ${o.sm ? 'btn-sm' : ''} ${o.cls || ''}`;
  const data = Object.entries(o.data || {}).map(([k, v]) => ` data-${k}="${attr(v)}"`).join('');
  const inner = `${o.icon ? icon(o.icon, 15) : ''}${label ? `<span>${esc(label)}</span>` : ''}${o.caret ? icon('down', 14) : ''}`;
  if (o.href && !dis) return `<a class="${cls}" href="${esc(o.href)}"${o.ext ? ' target="_blank" rel="noopener"' : ''}${title ? ` title="${esc(title)}"` : ''}${data}>${inner}</a>`;
  return `<button type="${o.submit ? 'submit' : 'button'}" class="${cls}"${o.act ? ` data-act="${esc(o.act)}"` : ''}${data}${dis ? ' disabled aria-disabled="true"' : ''}${title ? ` title="${esc(title)}" data-tip="${esc(title)}"` : ''}${o.aria ? ` aria-label="${esc(o.aria)}"` : ''}>${inner}</button>`;
}

export const pill = (text, tone = 'grey', o = {}) => `<span class="pill pill-${tone}${o.dot ? ' pill-dot' : ''}">${esc(text)}</span>`;
export const REG = { registered: ['Registered', 'green'], awaiting_approval: ['Awaiting approval', 'amber'], shadow: ['Shadow', 'red'], not_governed: ['Not governed', 'grey'] };
export const regPill = (r) => pill(...(REG[r] || [r, 'grey']));
export const SEV_TONE = { Critical: 'red', High: 'orange', Medium: 'amber', Low: 'blue' };
export const sevPill = (s) => pill(s, SEV_TONE[s] || 'grey');
export const sevDot = (s) => `<span class="sev-dot sev-${String(s).toLowerCase()}" aria-hidden="true"></span>`;

export function pageHead({ title, desc, actions = '', crumb = '', right = '' }) {
  return `<header class="page-head">${crumb ? `<div class="crumb">${crumb}</div>` : ''}
    <div class="page-head-row"><div><h1>${esc(title)}</h1>${desc ? `<p class="desc">${esc(desc)}</p>` : ''}</div>${right ? `<div class="page-head-right">${right}</div>` : ''}</div>
    ${actions ? `<div class="page-actions">${actions}</div>` : ''}</header>`;
}

export function statCards(cards, cols = cards.length) {
  return `<div class="stats cols-${cols}">${cards.map((c) => {
    const inner = `<span class="stat-label">${esc(c.label)}</span><span class="stat-value${c.tone ? ' tone-' + c.tone : ''}">${c.value}${c.delta ? ` <small class="delta ${c.deltaTone || ''}">${esc(c.delta)}</small>` : ''}</span>${c.sub ? `<span class="stat-sub">${c.sub}</span>` : ''}${c.extra || ''}`;
    return c.href ? `<a class="stat" href="${esc(c.href)}">${inner}</a>` : `<div class="stat">${inner}</div>`;
  }).join('')}</div>`;
}

export function panel({ title, desc, right = '', body = '', cls = '', id = '', h = 'h2' }) {
  return `<section class="panel ${cls}"${id ? ` id="${id}"` : ''}>${title || right ? `<div class="panel-head"><div>${title ? `<${h}>${esc(title)}</${h}>` : ''}${desc ? `<p class="desc">${desc}</p>` : ''}</div>${right ? `<div class="panel-right">${right}</div>` : ''}</div>` : ''}${body}</section>`;
}
export const section = (title, desc, body, right = '') => `<section class="sect"><div class="sect-head"><div><h2>${esc(title)}</h2>${desc ? `<p class="desc">${desc}</p>` : ''}</div>${right}</div>${body}</section>`;

// cols: [{ label, cls, w }]; rows: [{ cells: [...], attrs?, cls? }] or arrays
export function table({ cols, rows, empty = 'Nothing here.', cls = '', foot = '' }) {
  const head = `<thead><tr>${cols.map((c) => `<th class="${c.cls || ''}"${c.w ? ` style="width:${c.w}"` : ''}>${c.label}</th>`).join('')}</tr></thead>`;
  const body = rows.length ? rows.map((r) => {
    const cells = Array.isArray(r) ? r : r.cells;
    return `<tr${r.attrs ? ' ' + r.attrs : ''}${r.cls ? ` class="${r.cls}"` : ''}>${cells.map((c, i) => `<td class="${cols[i] && cols[i].cls ? cols[i].cls : ''}">${c}</td>`).join('')}</tr>`;
  }).join('') : `<tr class="empty-row"><td colspan="${cols.length}">${esc(empty)}</td></tr>`;
  return `<div class="tbl-wrap ${cls}"><table class="tbl">${head}<tbody>${body}</tbody></table></div>${foot}`;
}

export function seg(key, options, value, o = {}) {
  return `<div class="seg${o.sm ? ' seg-sm' : ''}" role="radiogroup"${o.label ? ` aria-label="${esc(o.label)}"` : ''}>${options.map((opt) => {
    const [v, l, ic] = Array.isArray(opt) ? opt : [opt, opt];
    return `<button type="button" role="radio" aria-checked="${v === value}" class="${v === value ? 'on' : ''}" data-act="set" data-key="${esc(key)}" data-val="${attr(v)}">${ic ? icon(ic, 14) : ''}${esc(l)}</button>`;
  }).join('')}</div>`;
}

export function select(key, options, value, o = {}) {
  return `<label class="sel${o.cls ? ' ' + o.cls : ''}">${o.label ? `<span class="sel-label">${esc(o.label)}</span>` : ''}<select data-bind="${esc(key)}"${o.aria ? ` aria-label="${esc(o.aria)}"` : ''}${o.disabled ? ' disabled' : ''}>${options.map((opt) => {
    const [v, l] = Array.isArray(opt) ? opt : [opt, opt];
    return `<option value="${esc(v)}"${String(v) === String(value) ? ' selected' : ''}>${esc(l)}</option>`;
  }).join('')}</select>${icon('down', 14)}</label>`;
}

export function toggle(key, checked, o = {}) {
  const allowed = !o.perm || can(o.perm);
  const t = !allowed ? why(o.perm) : o.title || '';
  return `<label class="switch${o.disabled || !allowed ? ' is-disabled' : ''}"${t ? ` title="${esc(t)}"` : ''}><input type="checkbox" ${o.act ? `data-act="${esc(o.act)}"` : `data-bind="${esc(key)}"`}${o.data ? Object.entries(o.data).map(([k, v]) => ` data-${k}="${attr(v)}"`).join('') : ''}${checked ? ' checked' : ''}${o.disabled || !allowed ? ' disabled' : ''} role="switch" aria-label="${esc(o.aria || o.label || key)}"><span class="track"><span class="thumb"></span></span>${o.label ? `<span class="switch-label">${esc(o.label)}</span>` : ''}${o.count != null ? `<span class="count">${int(o.count)}</span>` : ''}</label>`;
}

export const search = (key, value, placeholder, o = {}) => `<label class="search${o.cls ? ' ' + o.cls : ''}">${icon('search', 15)}<input id="q-${esc(key)}" type="search" data-bind="${esc(key)}" value="${esc(value || '')}" placeholder="${esc(placeholder)}" aria-label="${esc(placeholder)}"></label>`;

export function pager(page, total, per, key = 'page') {
  if (total <= per) return total ? `<div class="pager"><span>1–${total} of ${int(total)}</span></div>` : '';
  const from = page * per + 1, to = Math.min(total, (page + 1) * per);
  return `<div class="pager"><span>${int(from)}–${int(to)} of ${int(total)}</span>${btn('Previous', { sm: true, act: 'set', data: { key, val: page - 1 }, disabled: page === 0 })}${btn('Next', { sm: true, act: 'set', data: { key, val: page + 1 }, disabled: to >= total })}</div>`;
}

// Stacked mini bar. segs: [{ v, cls, title, act, data }]; total defaults to the sum.
export function miniBar(segs, total, o = {}) {
  const t = total || segs.reduce((a, s) => a + s.v, 0) || 1;
  return `<div class="minibar${o.cls ? ' ' + o.cls : ''}"${o.w ? ` style="width:${o.w}"` : ''}>${segs.filter((s) => s.v > 0).map((s) => {
    const style = `width:${(s.v / t) * 100}%`;
    return s.act ? `<button type="button" class="seg-${s.cls}" style="${style}" title="${esc(s.title || '')}" aria-label="${esc(s.title || '')}" data-act="${esc(s.act)}"${Object.entries(s.data || {}).map(([k, v]) => ` data-${k}="${attr(v)}"`).join('')}></button>` : `<span class="seg-${s.cls}" style="${style}" title="${esc(s.title || '')}"></span>`;
  }).join('')}</div>`;
}
export function barList(rows, o = {}) {
  const max = Math.max(...rows.map((r) => r.value), 0) || 1;
  return `<div class="barlist">${rows.map((r) => {
    const inner = `<span class="bl-label">${r.icon || ''}<span class="bl-text">${esc(r.label)}</span>${r.tag || ''}</span><span class="bl-bar"><i style="width:${Math.max(0.5, (r.value / max) * 100)}%${r.color ? ';background:' + r.color : ''}"></i></span><span class="bl-val">${r.fmt}</span>${r.after ? `<span class="bl-after">${r.after}</span>` : ''}`;
    return r.href ? `<a class="bl-row" href="${esc(r.href)}">${inner}</a>` : r.act ? `<button type="button" class="bl-row" data-act="${esc(r.act)}"${Object.entries(r.data || {}).map(([k, v]) => ` data-${k}="${attr(v)}"`).join('')}>${inner}</button>` : `<div class="bl-row">${inner}</div>`;
  }).join('')}${o.foot || ''}</div>`;
}

export const avatar = (email) => `<span class="avatar" aria-hidden="true">${esc(initials(email))}</span>`;
export const person = (email) => (email ? `<span class="person">${avatar(email)}<span>${esc(email)}</span></span>` : '<span class="muted">—</span>');
export const cloud = (c, label = true) => `<span class="cloud">${cloudIcon(c, 15)}${label ? `<span>${esc(CLOUD_NAME[c] || c)}</span>` : ''}</span>`;
export const sourceLabel = (a) => `<span class="cloud">${cloudIcon(a.cloud, 15)}<span>${esc(a.source)}</span>${a.cloud === 'external' ? ' <span class="tag-mini">registry</span>' : ''}</span>`;
export const kindLabel = (k) => `<span class="kind">${icon(KIND_ICON[k] || 'info', 14)}<span>${esc(kindOne(k))}</span></span>`;
export const assetLink = (a, o = {}) => (a ? `<a class="lnk" href="#/inventory/${a.id}">${o.icon ? icon(KIND_ICON[a.kind], 14) : ''}${esc(a.name)}</a>${a.newThisScan ? ' ' + pill('New', 'blue') : ''}` : '<span class="muted">removed</span>');
export const copyBtn = (text, label = 'Copy') => `<button type="button" class="icon-btn" data-act="copy" data-text="${attr(text)}" title="${esc(label)}" aria-label="${esc(label)}">${icon('copy', 14)}</button>`;
export const empty = (title, text, action = '') => `<div class="empty"><div class="empty-ic">${icon('sparkles', 20)}</div><h3>${esc(title)}</h3><p>${esc(text)}</p>${action}</div>`;
export const kv = (rows) => `<dl class="kv">${rows.filter(Boolean).map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${v == null || v === '' ? '<span class="muted">—</span>' : v}</dd></div>`).join('')}</dl>`;
export const legend = (items) => `<div class="legend">${items.map(([l, cls]) => `<span><i class="lg-${cls}"></i>${esc(l)}</span>`).join('')}</div>`;
export const tabs = (key, list, value) => `<div class="tabs" role="tablist">${list.map(([v, l, n]) => `<button type="button" role="tab" aria-selected="${v === value}" class="${v === value ? 'on' : ''}" data-act="set" data-key="${esc(key)}" data-val="${attr(v)}">${esc(l)}${n != null ? ` <span class="tab-n">${n}</span>` : ''}</button>`).join('')}</div>`;
export const chips = (key, list, value) => `<div class="chips">${list.map(([v, l, n]) => `<button type="button" class="chip${v === value ? ' on' : ''}" data-act="set" data-key="${esc(key)}" data-val="${attr(v)}">${esc(l)}${n != null ? ` <b>${n}</b>` : ''}</button>`).join('')}</div>`;

// ---- overlays: toast, modal, sheet, menu ----
let toastTimer = null;
export function toast(msg, o = {}) {
  let t = document.getElementById('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
  t.className = `toast ${o.tone || ''}`;
  t.innerHTML = `${icon(o.tone === 'err' ? 'alert' : 'check', 16)}<span>${esc(msg)}</span>${o.link ? `<a href="${esc(o.link[1])}">${esc(o.link[0])}</a>` : ''}`;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), o.ms || 4200);
}

let overlayOnSubmit = null;
export function modal({ title, body, submit = 'Save', cancel = 'Cancel', onSubmit, wide = false, danger = false, hideSubmit = false }) {
  closeOverlay();
  const el = document.createElement('div');
  el.className = 'overlay';
  el.innerHTML = `<div class="ov-back" data-close></div><form class="modal${wide ? ' wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="m-title" novalidate>
    <div class="modal-head"><h2 id="m-title">${esc(title)}</h2><button type="button" class="icon-btn" data-close aria-label="Close">${icon('x', 16)}</button></div>
    <div class="modal-body">${body}</div><p class="form-err" role="alert"></p>
    <div class="modal-foot"><button type="button" class="btn" data-close>${esc(cancel)}</button>${hideSubmit ? '' : `<button type="submit" class="btn ${danger ? 'btn-danger' : 'btn-primary'}">${esc(submit)}</button>`}</div></form>`;
  document.body.appendChild(el);
  overlayOnSubmit = onSubmit;
  wireOverlay(el);
  const f = el.querySelector('input:not([type=checkbox]):not([type=radio]), textarea, select');
  setTimeout(() => (f || el.querySelector('.btn')).focus(), 20);
  return el;
}
export function sheet({ title, sub = '', body, foot = '', wide = false }) {
  closeOverlay();
  const el = document.createElement('div');
  el.className = 'overlay overlay-sheet';
  el.innerHTML = `<div class="ov-back" data-close></div><aside class="sheet${wide ? ' wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="s-title">
    <div class="sheet-head"><div>${sub ? `<p class="sheet-sub">${sub}</p>` : ''}<h2 id="s-title">${esc(title)}</h2></div><button type="button" class="icon-btn" data-close aria-label="Close">${icon('x', 16)}</button></div>
    <div class="sheet-body">${body}</div>${foot ? `<div class="sheet-foot">${foot}</div>` : ''}</aside>`;
  document.body.appendChild(el);
  wireOverlay(el);
  setTimeout(() => el.querySelector('[data-close].icon-btn').focus(), 20);
  return el;
}
function wireOverlay(el) {
  el.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closeOverlay));
  const form = el.querySelector('form');
  if (form) form.addEventListener('submit', (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    form.querySelectorAll('input[type=checkbox][name]').forEach((c) => { data[c.name] = c.checked; });
    const err = overlayOnSubmit ? overlayOnSubmit(data, form) : null;
    if (typeof err === 'string' && err) { form.querySelector('.form-err').textContent = err; return; }
    if (err !== false) closeOverlay();
  });
}
export function closeOverlay() { document.querySelectorAll('.overlay').forEach((o) => o.remove()); overlayOnSubmit = null; }
export const overlayOpen = () => !!document.querySelector('.overlay');

export function field(label, input, hint = '') { return `<label class="field"><span class="field-label">${label}</span>${input}${hint ? `<span class="field-hint">${hint}</span>` : ''}</label>`; }
export const input = (name, o = {}) => `<input name="${esc(name)}" ${o.type ? `type="${o.type}"` : ''} value="${esc(o.value || '')}" placeholder="${esc(o.placeholder || '')}"${o.required ? ' required' : ''}${o.maxlength ? ` maxlength="${o.maxlength}"` : ''}${o.list ? ` list="${o.list}"` : ''}>`;
export const textarea = (name, o = {}) => `<textarea name="${esc(name)}" rows="${o.rows || 3}" placeholder="${esc(o.placeholder || '')}"${o.maxlength ? ` maxlength="${o.maxlength}"` : ''}${o.mono ? ' class="mono"' : ''}>${esc(o.value || '')}</textarea>`;
export const radios = (name, opts, value) => `<div class="radios">${opts.map(([v, l, d]) => `<label class="radio"><input type="radio" name="${esc(name)}" value="${esc(v)}"${v === value ? ' checked' : ''}><span><b>${esc(l)}</b>${d ? `<small>${esc(d)}</small>` : ''}</span></label>`).join('')}</div>`;
export const selectField = (name, opts, value) => `<span class="sel sel-block"><select name="${esc(name)}">${opts.map((o) => { const [v, l] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(v)}"${v === value ? ' selected' : ''}>${esc(l)}</option>`; }).join('')}</select>${icon('down', 14)}</span>`;

// Dropdown menus: a button with data-menu="<id>" opens the sibling .menu.
export function menu(id, label, items, o = {}) {
  return `<div class="menu-wrap"><button type="button" class="btn ${o.sm ? 'btn-sm' : ''} ${o.cls || ''}" data-menu="${esc(id)}" aria-haspopup="true" aria-expanded="false"${o.aria ? ` aria-label="${esc(o.aria)}"` : ''}>${o.icon ? icon(o.icon, 15) : ''}${label ? `<span>${esc(label)}</span>` : ''}${o.noCaret ? '' : icon('down', 14)}</button>
    <div class="menu${o.right ? ' right' : ''}" id="menu-${esc(id)}" role="menu" hidden>${items.map((it) => {
      if (it === '-') return '<hr>';
      if (it.head) return `<p class="menu-head">${esc(it.head)}</p>`;
      if (it.html) return it.html;
      const allowed = !it.perm || can(it.perm);
      return `<button type="button" role="menuitem" ${it.act ? `data-act="${esc(it.act)}"` : ''}${Object.entries(it.data || {}).map(([k, v]) => ` data-${k}="${attr(v)}"`).join('')}${allowed && !it.disabled ? '' : ` disabled title="${esc(it.perm ? why(it.perm) : it.disabledWhy || '')}"`}${it.danger ? ' class="danger"' : ''}>${it.icon ? icon(it.icon, 14) : ''}<span>${esc(it.label)}</span>${it.check != null ? `<span class="menu-check">${it.check ? icon('check', 14) : ''}</span>` : ''}</button>`;
    }).join('')}</div></div>`;
}
