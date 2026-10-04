// The LinkedIn export checklist (what to export, how, where) and the month-by-file coverage grid.
// Shared by the Upload CSVs page and the top of the LinkedIn page.
import { esc, fmt, monthLabel, dayLabel } from './fmt.mjs';

// The four files per period. `seg` = the demographics dropdown value, matched against the segments
// recorded on the upload (ca_uploads.notes, e.g. "Company" or "Company, Job Title").
export const LINKEDIN_FILES = [
  { key: 'perf', label: 'Ad Performance', where: 'Reporting › Export › Ad performance', how: 'Time breakdown: Daily · Level: Ads · the whole month', feeds: 'spend, impressions, clicks, leads, engagement, ad sets, creatives, trends', kind: 'performance' },
  { key: 'company', label: 'Demographics · Company', where: 'Reporting › Export › Professional Demographics', how: 'Dropdown above the table: Company Name · same date range', feeds: 'accounts reached, account penetration', kind: 'demographics', seg: 'Company' },
  { key: 'title', label: 'Demographics · Job Title', where: 'same dialog', how: 'Dropdown: Job Title · same date range', feeds: 'MD / MD-1 / MD-2 split and penetration', kind: 'demographics', seg: 'Job Title' },
  { key: 'country', label: 'Demographics · Country/Region', where: 'same dialog', how: 'Dropdown: Contextual Country/Region · same date range', feeds: 'region split and penetration', kind: 'demographics', seg: 'Country' },
];
export const OPTIONAL_FILES = [
  { key: 'seniority', label: 'Demographics · Job Seniority', seg: 'Job Seniority', feeds: '"Where the ads land" seniority tab' },
  { key: 'function', label: 'Demographics · Job Function', seg: 'Job Function', feeds: 'job function heat map' },
];

export function guideHtml({ compact = false } = {}) {
  const rows = LINKEDIN_FILES.map((f, i) => `<tr><td class="l"><b>${i + 1}. ${esc(f.label)}</b></td><td class="l">${esc(f.where)}</td><td class="l">${esc(f.how)}</td><td class="l muted" style="font-size:12.5px">${esc(f.feeds)}</td></tr>`).join('');
  return `<div class="guide">
    <div class="ui-label" style="color:var(--accent)">LinkedIn · what to export every 2 weeks</div>
    <h3 style="margin:6px 0 4px">4 files from Campaign Manager › Analyze › Reporting, account level, same date range on all four</h3>
    <p class="muted" style="font-size:13px;margin:0 0 10px">Set the dates to the fortnight (1st to 14th, then 15th to month end) or the whole month, then export each report below and drop all four in the box${compact ? ' on the Upload CSVs page or below' : ' below'}. Files are recognised by their columns; nothing is counted twice if a file is uploaded again.</p>
    <div class="tblwrap" style="border:none"><table><thead><tr><th class="l">File</th><th class="l">Where</th><th class="l">How</th><th class="l">Feeds</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="muted" style="font-size:12.5px;margin:10px 0 0">Optional: ${OPTIONAL_FILES.map(f => `<b>${esc(f.label)}</b> (${esc(f.feeds)})`).join('; ')}. For a person's boosted posts (Ani, Anju, Siva): select only their campaigns before exporting the three Demographics files and type the name in the "Covers" box when uploading.</p>
    <p class="muted" style="font-size:12.5px;margin:6px 0 0">Instantly: Campaign › Analytics › Export CSV per campaign, any time. Google, Meta, Bing, Taboola, X: a daily campaign report CSV; they file themselves under their platform.</p>
  </div>`;
}

/** Month keys from `from` (YYYY-MM) to `to` inclusive. */
export function monthsBetween(from, to) { const out = []; let [y, m] = from.split('-').map(Number); const [ey, em] = to.split('-').map(Number); while (y < ey || (y === ey && m <= em)) { out.push(`${y}-${String(m).padStart(2, '0')}`); m++; if (m > 12) { m = 1; y++; } } return out; }
const daysInMonth = k => { const [y, m] = k.split('-').map(Number); return new Date(y, m, 0).getDate(); };
const mStart = k => k + '-01', mEnd = k => k + '-' + String(daysInMonth(k)).padStart(2, '0');
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

/**
 * Per month and per LinkedIn file: what the uploads cover. Pure, tested.
 * -> [{ month, perf:{ days, of, ok, gaps:[...] }, company:{ ok, windows }, title:{...}, country:{...} }]
 */
export function monthGrid(uploads, months) {
  const li = (uploads || []).filter(u => u.channel === 'linkedin' && (u.platform || 'linkedin') === 'linkedin' && u.period_start && u.period_end && (u.row_count == null || u.row_count > 0));
  // Uploads made before the breakdown was recorded (notes null) are Company exports: that was the only kind then.
  const segsOf = u => { const t = String(u.notes || '').replace(/\s*\(.*\)$/, '').split(',').map(s => s.trim()).filter(Boolean); return t.length ? t : ['Company']; };
  return months.map(month => {
    const s = mStart(month), e = mEnd(month), n = daysInMonth(month);
    const covered = new Set();
    for (const u of li) if (u.kind === 'performance') for (let d = u.period_start < s ? s : u.period_start; d <= e && d <= u.period_end; d = addDays(d, 1)) covered.add(d);
    const gaps = []; let run = null;
    for (let d = s, i = 0; i < n; d = addDays(d, 1), i++) { if (!covered.has(d)) { if (run) run.to = d; else run = { from: d, to: d }; } else if (run) { gaps.push(run); run = null; } }
    if (run) gaps.push(run);
    const demo = seg => { const wins = li.filter(u => u.kind === 'demographics' && segsOf(u).includes(seg) && !/\(/.test(u.notes || '') && u.period_start <= e && u.period_end >= s); const days = new Set(); for (const u of wins) for (let d = u.period_start < s ? s : u.period_start; d <= e && d <= u.period_end; d = addDays(d, 1)) days.add(d); return { ok: days.size === n, partial: days.size > 0 && days.size < n, days: days.size, of: n, windows: wins.map(u => `${dayLabel(u.period_start)} to ${dayLabel(u.period_end)}`) }; };
    return { month, perf: { days: covered.size, of: n, ok: covered.size === n, gaps }, company: demo('Company'), title: demo('Job Title'), country: demo('Country') };
  });
}

export function gridHtml(grid) {
  const cell = (c, kind) => {
    if (c.ok) return `<td class="ok" title="${esc(kind === 'perf' ? `${c.days} of ${c.of} days` : c.windows.join('; '))}">✓</td>`;
    if (kind === 'perf' && c.days) return `<td class="part" title="Missing: ${esc(c.gaps.map(g => g.from === g.to ? dayLabel(g.from) : dayLabel(g.from) + ' to ' + dayLabel(g.to)).join(', '))}">${fmt(c.days)}/${c.of} days</td>`;
    if (c.partial) return `<td class="part" title="${esc(c.windows.join('; '))}">${fmt(c.days)}/${c.of} days</td>`;
    return `<td class="miss">missing</td>`;
  };
  return `<div class="tblwrap" style="border:none"><table class="mgrid"><thead><tr><th class="l">Month</th><th>1 · Ad Performance (daily)</th><th>2 · Company</th><th>3 · Job Title</th><th>4 · Country/Region</th></tr></thead><tbody>${grid.map(g => `<tr><td class="l"><b>${esc(monthLabel(g.month))}</b></td>${cell(g.perf, 'perf')}${cell(g.company)}${cell(g.title)}${cell(g.country)}</tr>`).join('')}</tbody></table></div>`;
}
