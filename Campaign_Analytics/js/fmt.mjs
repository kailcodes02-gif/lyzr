// Number, money and date helpers. IST display, calendar days in storage.
export const fmt = (v, d = 0) => (v == null || isNaN(v)) ? '–' : Number(v).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
export const usd = (v, d = 0) => (v == null || isNaN(v) || !isFinite(v)) ? '–' : '$' + fmt(v, d);
export const pct = (v, d = 1) => (v == null || !isFinite(v)) ? '–' : fmt(v, d) + '%';
export const delta = (a, b) => (!b) ? '<span class="muted">new</span>' : (() => { const g = (a - b) / b * 100; return `<span class="${g >= 0 ? 'up' : 'down'}">${g > 0 ? '+' : ''}${fmt(g, 0)}%</span>`; })();
export const compact = v => v == null ? '–' : Math.abs(v) >= 1e6 ? fmt(v / 1e6, 1) + 'M' : Math.abs(v) >= 1e3 ? fmt(v / 1e3, v >= 1e4 ? 0 : 1) + 'K' : fmt(v);
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const sum = (arr, k) => arr.reduce((a, r) => a + (Number(typeof k === 'function' ? k(r) : r[k]) || 0), 0);
export const div = (a, b) => b ? a / b : null;

export const isoDay = d => { const x = d instanceof Date ? d : new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
export const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return isoDay(d); };
export const today = () => isoDay(new Date());
export const monthKey = iso => iso.slice(0, 7);
export const weekKey = iso => { const d = new Date(iso + 'T00:00:00'); const day = (d.getDay() + 6) % 7; d.setDate(d.getDate() - day); return isoDay(d); }; // Monday
export const monthLabel = k => { const [y, m] = k.split('-'); return new Date(y, m - 1, 1).toLocaleString('en', { month: 'short' }) + " '" + y.slice(2); };
export const dayLabel = iso => new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
export const rangeLabel = (from, to) => `${dayLabel(from)} to ${dayLabel(to)}${from.slice(0, 4) !== to.slice(0, 4) ? ' ' + to.slice(0, 4) : ''}`;
export const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 864e5) + 1;
export const overlaps = (aFrom, aTo, bFrom, bTo) => aFrom <= bTo && bFrom <= aTo;
export const bucketKey = (iso, gran) => gran === 'month' ? monthKey(iso) : gran === 'week' ? weekKey(iso) : iso;
export const bucketLabel = (k, gran) => gran === 'month' ? monthLabel(k) : gran === 'week' ? 'Wk of ' + dayLabel(k) : dayLabel(k);
export const timeAgo = ts => { if (!ts) return '–'; const s = (Date.now() - new Date(ts)) / 1000; if (s < 90) return 'just now'; if (s < 3600) return Math.round(s / 60) + ' min ago'; if (s < 86400) return Math.round(s / 3600) + ' h ago'; return Math.round(s / 86400) + ' d ago'; };
export const istDateTime = ts => ts ? new Date(ts).toLocaleString('en-GB', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) + ' IST' : '–';
