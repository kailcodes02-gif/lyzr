// Trend explorer shared by every channel: week-on-week and month-on-month over the whole
// history, metric toggles, a comparison line (previous period or the average of all earlier
// periods), a straight-line projection for the period in progress, and "this period so far"
// against the same days of earlier periods.
//
// mountTrend(el, ctx, {
//   id,                         // state key, survives re-renders
//   items,                      // any rows; dayOf(item) gives 'YYYY-MM-DD'
//   dayOf = i => i.day,
//   metrics: [{ key, label, fn(itemsInBucket) -> number|null, fmt:'n'|'pct'|'usd', axis:'left'|'right', additive }],
//   defaults: { gran:'week'|'month', metrics:[keys], compare:'avg'|'prev'|'none' },
//   range: { from, to },        // highlighted on the chart; "Selected range only" limits to it
//   note,                       // text under the chart
// }) -> { destroy }
import { esc, fmt, usd, pct, addDays, today, monthLabel, dayLabel } from './fmt.mjs';

const COLORS = ['#FE4B1E', '#4F86C6', '#2FA36B', '#D9A23A', '#9B7BC8', '#A8A298', '#E07A5F', '#3FB6B2'];
const STATE = new Map();
const f = (m, v) => v == null || !isFinite(v) ? '–' : m.fmt === 'pct' ? pct(v, 1) : m.fmt === 'usd' ? usd(v) : fmt(v, v % 1 && Math.abs(v) < 100 ? 1 : 0);
const g = (cur, base) => (base == null || !base || cur == null) ? null : (cur - base) / base * 100;
const gTxt = v => v == null ? '<span class="muted">–</span>' : `<span class="${v >= 0 ? 'up' : 'down'}">${v > 0 ? '+' : ''}${fmt(v, 0)}%</span>`;

export const weekStart = iso => { const d = new Date(iso + 'T00:00:00Z'); const k = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - k); return d.toISOString().slice(0, 10); };
export const bucketStart = (iso, gran) => gran === 'month' ? iso.slice(0, 7) + '-01' : weekStart(iso);
export function bucketEnd(start, gran) {
  if (gran === 'week') return addDays(start, 6);
  const d = new Date(start + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + 1); d.setUTCDate(0); return d.toISOString().slice(0, 10);
}
const nextBucket = (start, gran) => addDays(bucketEnd(start, gran), 1);
const span = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5) + 1;
export const bucketName = (start, gran) => gran === 'month' ? monthLabel(start.slice(0, 7)) : 'Wk of ' + dayLabel(start);

/** Contiguous buckets from the first to the last day in the data (and up to today). */
export function buildBuckets(items, dayOf, gran, now = today()) {
  const days = items.map(dayOf).filter(Boolean).sort();
  if (!days.length) return [];
  const groups = new Map();
  for (const it of items) { const d = dayOf(it); if (!d) continue; const k = bucketStart(d, gran); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(it); }
  const out = [];
  const last = days[days.length - 1] > now ? days[days.length - 1] : now;
  for (let s = bucketStart(days[0], gran), guard = 0; s <= last && guard < 800; s = nextBucket(s, gran), guard++) {
    const end = bucketEnd(s, gran);
    const partial = s <= now && now < end;
    out.push({ start: s, end, items: groups.get(s) || [], partial, elapsed: partial ? span(s, now) : span(s, end), length: span(s, end) });
  }
  return out;
}

/** Values, comparison and projection for one metric over the buckets. */
export function series(buckets, m) {
  const vals = buckets.map(b => m.fn(b.items));
  return buckets.map((b, i) => {
    const earlier = vals.slice(0, i).filter(v => v != null);
    const avg = earlier.length ? earlier.reduce((a, v) => a + v, 0) / earlier.length : null;
    const prev = i ? vals[i - 1] : null;
    const projected = m.additive && b.partial && b.elapsed ? vals[i] * b.length / b.elapsed : null;
    return { value: vals[i], prev, avg, projected, vsPrev: g(b.partial && projected != null ? projected : vals[i], prev), vsAvg: g(b.partial && projected != null ? projected : vals[i], avg) };
  });
}

/** This period so far vs the same number of days at the start of each earlier period. */
export function sameDays(buckets, m, dayOf) {
  const cur = buckets[buckets.length - 1];
  if (!cur || !cur.partial || !cur.items.length) return null;
  const n = cur.elapsed;
  const upto = b => { const cut = addDays(b.start, n - 1); return b.items.filter(it => dayOf(it) <= cut); };
  const now = m.fn(cur.items);
  const earlier = buckets.slice(0, -1).map(b => m.fn(upto(b))).filter(v => v != null);
  const last = buckets.length > 1 ? m.fn(upto(buckets[buckets.length - 2])) : null;
  const avg = earlier.length ? earlier.reduce((a, v) => a + v, 0) / earlier.length : null;
  const full = buckets.slice(0, -1).map(b => m.fn(b.items)).filter(v => v != null);
  const best = full.length ? Math.max(...full) : null;
  return { days: n, now, last, avg, best, projected: m.additive && n ? now * cur.length / n : null, fullAvg: full.length ? full.reduce((a, v) => a + v, 0) / full.length : null };
}

export function mountTrend(el, ctx, o) {
  const dayOf = o.dayOf || (i => i.day);
  const st = STATE.get(o.id) || { gran: (o.defaults && o.defaults.gran) || 'week', metrics: ((o.defaults && o.defaults.metrics) || [o.metrics[0].key]).filter(k => o.metrics.some(m => m.key === k)), compare: (o.defaults && o.defaults.compare) || 'avg', scope: 'all', projection: true };
  STATE.set(o.id, st);
  let chart = null;
  const destroy = () => { if (chart) { try { chart.destroy(); } catch { /* ignore */ } chart = null; } };

  function draw() {
    destroy();
    const R = o.range || {};
    let items = o.items || [];
    if (st.scope === 'range' && R.from && R.to) items = items.filter(it => { const d = dayOf(it); return d >= R.from && d <= R.to; });
    const buckets = buildBuckets(items, dayOf, st.gran);
    const sel = o.metrics.filter(m => st.metrics.includes(m.key));
    if (!sel.length) sel.push(o.metrics[0]);
    const S = sel.map(m => series(buckets, m));
    const word = st.gran === 'month' ? 'month' : 'week';
    const inRange = b => R.from && R.to ? b.start <= R.to && b.end >= R.from : true;

    const chips = o.metrics.map((m, i) => `<button type="button" class="chip${st.metrics.includes(m.key) ? ' on' : ''}" data-m="${esc(m.key)}" style="--c:${COLORS[i % COLORS.length]}">${esc(m.label)}</button>`).join('');
    const cards = sel.slice(0, 3).map(m => {
      const s = sameDays(buckets, m, dayOf);
      const i = o.metrics.indexOf(m);
      if (!s) {
        const k = S[sel.indexOf(m)];
        let li = buckets.length - 1; while (li > 0 && !buckets[li].items.length) li--;
        const last = k[li];
        const lastDay = buckets[li].items.map(dayOf).sort().pop();
        const gap = li < buckets.length - 1 && lastDay ? ` <span class="muted">(no data after ${esc(dayLabel(lastDay))} yet; upload newer exports)</span>` : '';
        return `<div class="tcard" style="--c:${COLORS[i % COLORS.length]}"><div class="k">${esc(m.label)} · ${li < buckets.length - 1 ? esc(bucketName(buckets[li].start, st.gran)) : 'last ' + word}${gap}</div><div class="v">${f(m, last && last.value)}</div><div class="d">${last ? `${gTxt(last.vsPrev)} vs the ${word} before · ${gTxt(last.vsAvg)} vs the average ${word}` : 'no data'}</div></div>`;
      }
      return `<div class="tcard" style="--c:${COLORS[i % COLORS.length]}"><div class="k">${esc(m.label)} · this ${word}, first ${s.days} day${s.days === 1 ? '' : 's'}</div><div class="v">${f(m, s.now)}</div>
        <div class="d">${gTxt(g(s.now, s.last))} vs the same days last ${word} (${f(m, s.last)}) · ${gTxt(g(s.now, s.avg))} vs the average of the same days in earlier ${word}s (${f(m, s.avg)})</div>
        ${s.projected != null ? `<div class="d">Projected ${word} end <b>${f(m, s.projected)}</b> (straight line) · average full ${word} ${f(m, s.fullAvg)} · best ${f(m, s.best)}</div>` : ''}</div>`;
    }).join('');

    el.innerHTML = `<div class="trend">
      <div class="tctl"><div data-seg="gran"></div><div data-seg="compare"></div><div data-seg="scope"></div>
        <label class="muted" style="font-size:12.5px;display:flex;gap:6px;align-items:center"><input type="checkbox" data-proj ${st.projection ? 'checked' : ''}> Projection for the ${word} in progress</label></div>
      <div class="chips">${chips}</div>
      <div class="tcards">${cards}</div>
      ${buckets.length ? `<div class="card" style="margin-top:12px"><div class="chartbox"><canvas></canvas></div></div>` : '<div class="empty">No data yet.</div>'}
      ${o.note ? `<p class="muted" style="font-size:12.5px;margin-top:8px">${o.note}</p>` : ''}
      <details style="margin-top:10px"><summary class="muted" style="cursor:pointer;font-size:13px">Table: every ${word}, with change vs the ${word} before and vs the average of all earlier ${word}s</summary>
      <div class="tblwrap" style="margin-top:8px"><table><thead><tr><th class="l">${st.gran === 'month' ? 'Month' : 'Week'}</th>${sel.map(m => `<th>${esc(m.label)}</th><th>vs prior</th><th>vs avg</th>`).join('')}</tr></thead><tbody>
      ${buckets.map((b, bi) => ({ b, bi })).reverse().map(({ b, bi }) => `<tr${inRange(b) && R.from ? ' style="background:color-mix(in srgb,var(--orange) 6%,transparent)"' : ''}><td class="l">${esc(bucketName(b.start, st.gran))}${b.partial ? ` <span class="muted" style="font-size:11.5px">(${b.elapsed} of ${b.length} days)</span>` : ''}</td>${sel.map((m, mi) => { const x = S[mi][bi]; return `<td>${f(m, x.value)}${x.projected != null ? `<br><span class="muted" style="font-size:11px">→ ${f(m, x.projected)}</span>` : ''}</td><td>${gTxt(x.vsPrev)}</td><td>${gTxt(x.vsAvg)}</td>`; }).join('')}</tr>`).join('')}
      </tbody></table></div></details></div>`;

    ctx.ui.seg(el.querySelector('[data-seg=gran]'), [{ value: 'week', label: 'Week on week' }, { value: 'month', label: 'Month on month' }], v => { st.gran = v; draw(); }, st.gran);
    ctx.ui.seg(el.querySelector('[data-seg=compare]'), [{ value: 'avg', label: 'vs average of earlier' }, { value: 'prev', label: 'vs previous' }, { value: 'none', label: 'No comparison' }], v => { st.compare = v; draw(); }, st.compare);
    ctx.ui.seg(el.querySelector('[data-seg=scope]'), [{ value: 'all', label: 'All history' }, { value: 'range', label: 'Selected range' }], v => { st.scope = v; draw(); }, st.scope);
    el.querySelector('[data-proj]').onchange = e => { st.projection = e.target.checked; draw(); };
    el.querySelectorAll('.chip').forEach(b => b.onclick = () => {
      const k = b.dataset.m;
      st.metrics = st.metrics.includes(k) ? st.metrics.filter(x => x !== k) : [...st.metrics, k].slice(-4);
      if (!st.metrics.length) st.metrics = [k];
      draw();
    });
    const canvas = el.querySelector('canvas');
    if (!canvas || typeof Chart === 'undefined') return;
    const labels = buckets.map(b => bucketName(b.start, st.gran) + (b.partial ? ' (so far)' : ''));
    const datasets = [];
    // Each metric gets its own scale so leads (tens) are visible next to spend (thousands).
    // Only the first left and first right axis are drawn; tooltips always show real values.
    const axisOf = m => m.axis === 'right' ? 'r_' + (m.fmt || 'n') : 'y_' + m.key;
    const axisIds = [...new Set(sel.map(axisOf))];
    const firstLeft = sel.find(m => m.axis !== 'right'), firstRight = sel.find(m => m.axis === 'right');
    const tick = fm => v => fm === 'pct' ? v + '%' : fm === 'usd' ? '$' + fmt(v) : fmt(v);
    const scales = { x: { grid: { display: false } } };
    for (const id of axisIds) {
      const m = sel.find(x => axisOf(x) === id);
      const right = id.startsWith('r_');
      const shown = right ? m === firstRight : m === firstLeft;
      scales[id] = { position: right ? 'right' : 'left', stacked: !right, beginAtZero: true, display: shown, grid: { display: shown && !right }, ticks: { callback: tick(m.fmt) } };
    }
    sel.forEach((m, mi) => {
      const col = COLORS[o.metrics.indexOf(m) % COLORS.length];
      const s = S[mi];
      const faded = col + '55';
      if (m.axis === 'right') {
        datasets.push({ type: 'line', label: m.label, data: s.map(x => x.value), borderColor: col, backgroundColor: col, borderWidth: 2.5, pointRadius: 3, tension: .3, yAxisID: axisOf(m), stack: 'l:' + m.key, order: 0 });
      } else {
        datasets.push({ type: 'bar', label: m.label, data: s.map(x => x.value), backgroundColor: buckets.map(b => inRange(b) ? col : faded), borderRadius: 3, stack: m.key, yAxisID: axisOf(m), order: 2 });
        if (st.projection && m.additive && s.some(x => x.projected != null)) datasets.push({ type: 'bar', label: m.label + ' · projected rest', data: s.map(x => x.projected != null ? Math.max(0, x.projected - x.value) : null), backgroundColor: col + '22', borderColor: col, borderWidth: 1, borderDash: [4, 3], borderRadius: 3, stack: m.key, yAxisID: axisOf(m), order: 2 });
      }
      if (st.compare !== 'none') datasets.push({ type: 'line', label: m.label + (st.compare === 'avg' ? ' · average of earlier' : ' · previous'), data: s.map(x => st.compare === 'avg' ? x.avg : x.prev), borderColor: col, borderDash: [5, 4], borderWidth: 1.5, pointRadius: 0, tension: .2, yAxisID: axisOf(m), stack: 'c:' + m.key, order: 1 });
    });
    chart = new Chart(canvas, { data: { labels, datasets }, options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 12 } }, tooltip: { callbacks: { label: c => { const m = sel.find(x => c.dataset.label.startsWith(x.label)); return `${c.dataset.label}: ${m ? f(m, c.raw) : c.raw}`; } } } },
      scales } });
  }
  draw();
  return { destroy, redraw: draw };
}
