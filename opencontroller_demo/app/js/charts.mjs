// Small SVG charts drawn by hand: stacked bars, area/line, donut, heat grid, sparkline.
// Colours come from CSS custom properties so both themes work.
import { esc } from './util.mjs';

// series: [{ name, color, values: number[], hatch?: bool }]; labels: string[] per bar
export function stackedBars({ series, labels, height = 180, fmt = (v) => v, ticks = 3, hover = true }) {
  const n = labels.length;
  const totals = labels.map((_, i) => series.reduce((a, s) => a + (s.values[i] || 0), 0));
  const max = Math.max(...totals, 0) || 1;
  const W = 100 / n;
  const bars = labels.map((lab, i) => {
    let y = 0;
    const segs = series.map((s) => {
      const v = s.values[i] || 0; if (!v) return '';
      const h = (v / max) * 100; y += h;
      return `<rect x="${i * W + W * 0.14}" y="${100 - y}" width="${W * 0.72}" height="${h}" fill="${s.hatch ? 'url(#hatch)' : s.color}" rx="0.4"></rect>`;
    }).join('');
    const tip = `${lab}: ${series.filter((s) => s.values[i]).map((s) => `${s.name} ${fmt(s.values[i])}`).join(' · ') || 'nothing'}`;
    return `<g class="bar-g">${hover ? `<rect class="hit" x="${i * W}" y="0" width="${W}" height="100"><title>${esc(tip)}</title></rect>` : ''}${segs}</g>`;
  }).join('');
  const idx = ticks === 3 ? [0, Math.floor((n - 1) / 2), n - 1] : labels.map((_, i) => i).filter((i) => i % Math.ceil(n / ticks) === 0);
  return `<div class="chart-peak">peak ${esc(fmt(max))}</div><div class="chart" style="height:${height}px"><svg viewBox="0 0 100 100" preserveAspectRatio="none" class="chart-svg"><defs><pattern id="hatch" width="2" height="2" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="1" height="2" fill="var(--c-muted)"></rect></pattern></defs>
    <line x1="0" x2="100" y1="100" y2="100" class="axis"/>${bars}</svg></div>
    <div class="chart-x">${idx.map((i) => `<span style="left:${(i + 0.5) * W}%">${esc(labels[i])}</span>`).join('')}</div>`;
}

// lines: [{ name, color, values, fill? }]
export function lineChart({ lines, labels, height = 160, fmt = (v) => v, area = true }) {
  const n = labels.length;
  const max = Math.max(...lines.flatMap((l) => l.values), 0) || 1;
  const x = (i) => (n === 1 ? 50 : (i / (n - 1)) * 100);
  const y = (v) => 100 - (v / max) * 92;
  const paths = lines.map((l) => {
    const d = l.values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(2)},${y(v).toFixed(2)}`).join('');
    return `${area && l.fill !== false ? `<path d="${d}L100,100L0,100Z" fill="${l.color}" opacity=".14"/>` : ''}<path d="${d}" fill="none" stroke="${l.color}" stroke-width="1.4" vector-effect="non-scaling-stroke"/>`;
  }).join('');
  const hits = labels.map((lab, i) => `<rect class="hit" x="${x(i) - 50 / n}" y="0" width="${100 / n}" height="100"><title>${esc(`${lab}: ${lines.map((l) => `${l.name} ${fmt(l.values[i] || 0)}`).join(' · ')}`)}</title></rect>`).join('');
  const idx = [0, Math.floor((n - 1) / 2), n - 1];
  return `<div class="chart" style="height:${height}px"><svg viewBox="0 0 100 100" preserveAspectRatio="none" class="chart-svg"><line x1="0" x2="100" y1="100" y2="100" class="axis"/>${paths}${hits}</svg></div>
    <div class="chart-x">${idx.map((i) => `<span style="left:${x(i)}%">${esc(labels[i])}</span>`).join('')}</div>`;
}

export function sparkline(values, color = 'var(--c-accent)', o = {}) {
  const n = values.length; if (!n) return '';
  const max = Math.max(...values) || 1;
  const pts = values.map((v, i) => `${((i / Math.max(1, n - 1)) * 100).toFixed(1)},${(30 - (v / max) * 27).toFixed(1)}`).join(' ');
  if (o.bars) return `<svg class="spark" viewBox="0 0 100 30" preserveAspectRatio="none">${values.map((v, i) => `<rect x="${(i / n) * 100}" y="${30 - (v / max) * 28}" width="${(100 / n) * 0.7}" height="${(v / max) * 28}" fill="${color}"/>`).join('')}</svg>`;
  return `<svg class="spark" viewBox="0 0 100 30" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.3" vector-effect="non-scaling-stroke"/></svg>`;
}

// segs: [{ v, color, label }]
export function donut(segs, center, sub) {
  const total = segs.reduce((a, s) => a + s.v, 0) || 1;
  const R = 15.915; let off = 25;
  const arcs = segs.filter((s) => s.v > 0).map((s) => {
    const len = (s.v / total) * 100;
    const el = `<circle r="${R}" cx="21" cy="21" fill="none" stroke="${s.color}" stroke-width="5.2" stroke-dasharray="${Math.max(0, len - 0.6)} ${100 - Math.max(0, len - 0.6)}" stroke-dashoffset="${off}"><title>${esc(`${s.label}: ${s.v}`)}</title></circle>`;
    off -= len; return el;
  }).join('');
  return `<div class="donut"><svg viewBox="0 0 42 42"><circle r="${R}" cx="21" cy="21" fill="none" stroke="var(--c-line)" stroke-width="5.2"/>${arcs}</svg><div class="donut-c"><strong>${esc(center)}</strong><span>${esc(sub)}</span></div></div>`;
}

// cells: [{ col, row, ok, fail, tip }] on a cols x rows grid; rows bottom-up.
export function heatGrid({ cells, cols, rows, xLabels = [], yLabels = [], errorsOnly = false }) {
  const map = new Map(cells.map((c) => [`${c.col}:${c.row}`, c]));
  const maxOk = Math.max(1, ...cells.map((c) => c.ok + c.fail));
  let html = '';
  for (let r = rows - 1; r >= 0; r--) {
    html += `<div class="hg-row"><span class="hg-y">${esc(yLabels[r] || '')}</span>`;
    for (let c = 0; c < cols; c++) {
      const cell = map.get(`${c}:${r}`);
      let cls = 'hg-0', style = '';
      if (cell && (cell.ok || cell.fail) && !(errorsOnly && !cell.fail)) {
        cls = cell.fail ? 'hg-fail' : 'hg-ok';
        style = ` style="opacity:${(0.35 + 0.65 * Math.min(1, (cell.ok + cell.fail) / maxOk)).toFixed(2)}"`;
      }
      html += `<i class="${cls}"${style}${cell ? ` title="${esc(cell.tip)}"` : ''}></i>`;
    }
    html += '</div>';
  }
  return `<div class="heatgrid" style="--cols:${cols}">${html}<div class="hg-x"><span></span>${xLabels.map((l) => `<span>${esc(l)}</span>`).join('')}</div></div>`;
}

export const PALETTE = ['var(--c-accent)', 'var(--c-amber)', 'var(--c-green)', 'var(--c-violet)', 'var(--c-red)', 'var(--c-teal)', 'var(--c-muted)'];
