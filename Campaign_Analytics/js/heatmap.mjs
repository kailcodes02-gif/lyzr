// Table heat map. Cells shaded on an orange (default) or navy ramp, sqrt or linear scale.
import { fmt, esc } from './fmt.mjs';
const RAMP = { orange: '254,75,30', navy: '4,62,119', red: '179,38,30', green: '31,122,77' };
export function cellColor(v, max, { scale = 'sqrt', color = 'orange' } = {}) {
  if (!v || !max) return 'transparent';
  const t = scale === 'sqrt' ? Math.sqrt(v / max) : v / max;
  return `rgba(${RAMP[color] || RAMP.orange},${(0.05 + 0.92 * Math.min(1, t)).toFixed(3)})`;
}
export function cellInk(v, max, { scale = 'sqrt' } = {}) {
  if (!v || !max) return '';
  const t = scale === 'sqrt' ? Math.sqrt(v / max) : v / max;
  return t > 0.62 ? '#fff' : '';
}
/**
 * renderHeat(el, opts)
 * opts.rows: [{key,label,sub?}]   opts.cols: [{key,label}]
 * opts.cell(rowKey,colKey) -> { v:number|null, text?:string, sub?:string, title?:string } (v null = no data)
 * opts.rowTotal(rowKey)? -> string   opts.colTotal(colKey)? -> string
 * opts.scale 'sqrt'|'linear', opts.color, opts.max (default max cell), opts.onClick(rowKey,colKey)
 * opts.corner (top-left header text), opts.sortRows (default: by row total desc when opts.rowValue given)
 */
export function renderHeat(el, o) {
  const cells = {}; let max = o.max || 0;
  for (const r of o.rows) for (const c of o.cols) { const x = o.cell(r.key, c.key) || { v: null }; cells[r.key + '\u0000' + c.key] = x; if (!o.max && x.v > max) max = x.v; }
  let rows = o.rows;
  if (o.sortRows !== false) rows = [...rows].sort((a, b) => rowSum(b) - rowSum(a));
  function rowSum(r) { return o.cols.reduce((s, c) => s + (Number(cells[r.key + '\u0000' + c.key]?.v) || 0), 0); }
  let h = `<table class="heat"><thead><tr><th class="l">${esc(o.corner || '')}</th>${o.cols.map(c => `<th style="text-align:center">${esc(c.label)}</th>`).join('')}${o.rowTotal ? '<th>Total</th>' : ''}</tr></thead><tbody>`;
  for (const r of rows) {
    h += `<tr><td class="l"><b>${esc(r.label)}</b>${r.sub ? `<br><span class="muted" style="font-size:11.5px">${esc(r.sub)}</span>` : ''}</td>`;
    for (const c of o.cols) {
      const x = cells[r.key + '\u0000' + c.key];
      const v = x.v;
      const bg = cellColor(v, max, o), ink = cellInk(v, max, o);
      const text = x.text != null ? x.text : (v == null ? '·' : v ? fmt(v) : '–');
      h += `<td class="c${v ? '' : ' z'}${o.onClick ? ' click' : ''}" data-r="${esc(r.key)}" data-c="${esc(c.key)}" style="background:${bg};color:${ink}" title="${esc(x.title || `${r.label} · ${c.label}: ${text}`)}">${esc(text)}${x.sub ? `<small>${esc(x.sub)}</small>` : ''}</td>`;
    }
    if (o.rowTotal) h += `<td><b>${o.rowTotal(r.key)}</b></td>`;
    h += '</tr>';
  }
  if (o.colTotal) h += `<tr class="total"><td class="l">Total</td>${o.cols.map(c => `<td style="text-align:center">${o.colTotal(c.key)}</td>`).join('')}${o.rowTotal ? '<td></td>' : ''}</tr>`;
  h += '</tbody></table>';
  el.innerHTML = h;
  if (o.onClick) el.querySelectorAll('td.c').forEach(td => td.addEventListener('click', () => o.onClick(td.dataset.r, td.dataset.c)));
  return max;
}
export const legend = (color = 'orange', note = 'square-root scale') => `<div class="legend"><span>Low</span><span class="ramp ${color === 'navy' ? 'navy' : ''}"></span><span>High (${note})</span></div>`;
