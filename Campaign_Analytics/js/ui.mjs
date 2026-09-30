// Small rendering helpers shared by all views.
import { esc } from './fmt.mjs';
export const tiles = list => `<div class="tiles">${list.map(t => `<div class="tile"><div class="k">${esc(t.k)}</div><div class="v">${t.v}</div>${t.d ? `<div class="d">${t.d}</div>` : ''}</div>`).join('')}</div>`;
export const pill = (label, cls = 'p-na') => `<span class="pill ${cls}">${esc(label)}</span>`;
export function table({ cols, rows, total, cls = '' }) {
  return `<div class="tblwrap ${cls}"><table><thead><tr>${cols.map(c => `<th class="${c.left ? 'l' : ''}">${esc(c.h)}</th>`).join('')}</tr></thead><tbody>` +
    rows.map(r => `<tr>${cols.map(c => `<td class="${c.left ? 'l' : ''}">${c.f ? c.f(r) : esc(r[c.k])}</td>`).join('')}</tr>`).join('') +
    (total ? `<tr class="total">${cols.map(c => `<td class="${c.left ? 'l' : ''}">${total[c.k] ?? ''}</td>`).join('')}</tr>` : '') + '</tbody></table></div>';
}
// Segmented control: seg(el, ['A','B'], (value)=>{}, initial)
export function seg(el, options, onChange, initial) {
  const opts = options.map(o => typeof o === 'string' ? { value: o, label: o } : o);
  let cur = initial ?? opts[0].value;
  el.classList.add('seg');
  el.innerHTML = opts.map(o => `<button type="button" data-v="${esc(o.value)}" aria-pressed="${o.value === cur}">${esc(o.label)}</button>`).join('');
  el.querySelectorAll('button').forEach(b => b.addEventListener('click', () => { cur = b.dataset.v; el.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b)); onChange(cur); }));
  return () => cur;
}
export const empty = (msg, cta = '') => `<div class="empty">${esc(msg)} ${cta}</div>`;
export const spinner = (msg = 'Loading') => `<p class="muted"><span class="spin"></span> ${esc(msg)}…</p>`;
export const section = (title, sub, body, id = '') => `<section class="section" ${id ? `id="${id}"` : ''}><h2>${esc(title)}</h2>${sub ? `<p class="sub">${sub}</p>` : ''}${body}</section>`;
export const callouts = list => `<div class="callouts">${list.map(c => `<div class="callout"><b>${c.b}</b><span>${c.s}</span></div>`).join('')}</div>`;
