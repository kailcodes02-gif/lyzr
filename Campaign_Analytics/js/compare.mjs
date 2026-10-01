// Comparison ranges. The top bar's "Compare with" sets ctx.state.prev for every page (js/app.mjs
// setRange). A section can override it with its own small selector (sectionCompare): the page
// still loads from the top-bar dates and comparison, then that one section re-draws against the
// range chosen here. Overrides live for the session, per section id, and reset whenever the
// top-bar dates or comparison change, so the first draw always follows the top of the page.
import * as fmt from './fmt.mjs';

export const COMPARE = [
  ['prev', 'the period before'], ['week', 'same dates last week'], ['month', 'same dates last month'],
  ['weeks', 'same dates N weeks ago'], ['months', 'same dates N months ago'], ['none', 'nothing'],
];
export function compareRange(from, to, mode, n = 1) {
  const days = fmt.daysBetween(from, to);
  const shiftMonths = (iso, k) => { const d = new Date(iso + 'T00:00:00'); const day = d.getDate(); d.setDate(1); d.setMonth(d.getMonth() - k); const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); d.setDate(Math.min(day, last)); return fmt.isoDay(d); };
  if (mode === 'none') return null;
  if (mode === 'week') return { from: fmt.addDays(from, -7), to: fmt.addDays(to, -7), label: 'same dates last week' };
  if (mode === 'weeks') return { from: fmt.addDays(from, -7 * n), to: fmt.addDays(to, -7 * n), label: `same dates ${n} weeks ago` };
  if (mode === 'month') return { from: shiftMonths(from, 1), to: shiftMonths(to, 1), label: 'same dates last month' };
  if (mode === 'months') return { from: shiftMonths(from, n), to: shiftMonths(to, n), label: `same dates ${n} months ago` };
  return { from: fmt.addDays(from, -days), to: fmt.addDays(from, -1), label: `the ${days} days before` };
}

const OVERRIDES = new Map();   // section id -> { mode, n }
const CACHE = new Map();       // `${path}|${params}` -> Promise
let SIG = '';
const sig = st => `${st.from}|${st.to}|${st.cmp}|${st.cmpN}`;
function sync(ctx) { const s = sig(ctx.state); if (s !== SIG) { SIG = s; OVERRIDES.clear(); CACHE.clear(); } }

/** Forget every memoised GET (after an upload, delete or pull changed the store). */
export function clearMemo() { CACHE.clear(); }

/** GET with a per-range memo, so switching a section's comparison back and forth does not refetch. Cleared when the top bar changes. */
export function memoGet(ctx, path, params) {
  sync(ctx);
  const k = path + '|' + JSON.stringify(params || {});
  if (!CACHE.has(k)) CACHE.set(k, ctx.api.get(path, params).catch(e => { CACHE.delete(k); throw e; }));
  return CACHE.get(k);
}

/**
 * sectionCompare(ctx, id, onChange) -> { prev, html(), wire(root) }
 *   prev      the comparison range for this section right now ({from,to,label} or null)
 *   html()    the selector markup to put in the section head (a <span>, inline)
 *   wire(root) attaches the change handler inside root; onChange(prev) is called after every change
 * Call it again on re-render to get the current prev.
 */
export function sectionCompare(ctx, id, onChange) {
  sync(ctx);
  const st = OVERRIDES.get(id) || { mode: 'inherit', n: ctx.state.cmpN || 4 };
  const { from, to } = ctx.state;
  const prev = st.mode === 'inherit' ? (ctx.state.prev || null) : compareRange(from, to, st.mode, st.n);
  const topLabel = (COMPARE.find(([m]) => m === ctx.state.cmp) || ['', 'nothing'])[1].replace('N', String(ctx.state.cmpN || 4));
  const html = () => `<span class="cmpbox" data-cmp="${fmt.esc(id)}"><span class="ui-label">Compare</span><select aria-label="Compare this section with">` +
    `<option value="inherit" ${st.mode === 'inherit' ? 'selected' : ''}>as set at the top (${fmt.esc(topLabel)})</option>` +
    COMPARE.map(([v, l]) => `<option value="${v}" ${st.mode === v ? 'selected' : ''}>${fmt.esc(l)}</option>`).join('') +
    `</select><input type="number" min="1" max="52" value="${st.n}" aria-label="How many" class="${/^(weeks|months)$/.test(st.mode) ? '' : 'hidden'}"></span>`;
  const wire = root => {
    const box = root && root.querySelector(`[data-cmp="${CSS.escape(id)}"]`); if (!box) return;
    const sel = box.querySelector('select'), num = box.querySelector('input');
    const apply = () => {
      const mode = sel.value, n = Math.min(52, Math.max(1, parseInt(num.value, 10) || 1));
      if (mode === 'inherit') OVERRIDES.delete(id); else OVERRIDES.set(id, { mode, n });
      num.classList.toggle('hidden', !/^(weeks|months)$/.test(mode));
      if (onChange) onChange(sectionCompare(ctx, id, onChange).prev);
    };
    sel.onchange = apply; num.onchange = apply;
  };
  return { prev, html, wire, mode: st.mode };
}

/** "+12% vs the 30 days before" for a section; null prev -> "no comparison". invert = lower is better. */
export function deltaText(prev, cur, prevV, invert = false) {
  if (!prev) return '<span class="muted">no comparison</span>';
  if (prevV == null || !prevV || cur == null) return '<span class="muted">nothing to compare</span>';
  const g = (cur - prevV) / prevV * 100; const good = invert ? g <= 0 : g >= 0;
  return `<span class="${good ? 'up' : 'down'}">${g > 0 ? '+' : ''}${fmt.fmt(g, 0)}%</span> vs ${fmt.esc(prev.label)}`;
}
