// Formatting, seeded randomness and small helpers shared by every screen.

// The demo's clock: the captured estate is as of 30 Oct 2026, 11:30 PM, and time moves on from
// there while the page is open, so "5 minutes ago" keeps meaning something.
export const ANCHOR = Date.UTC(2026, 9, 30, 18, 0, 0); // 30 Oct 2026, 11:30 PM IST
const opened = Date.now();
export const now = () => ANCHOR + (Date.now() - opened);
export const MIN = 60e3, HOUR = 3600e3, DAY = 86400e3;

export function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
// Attribute-safe JSON for data-* attributes.
export const attr = (v) => esc(typeof v === 'string' ? v : JSON.stringify(v));

export function rng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.int = (lo, hi) => lo + Math.floor(next() * (hi - lo + 1));
  next.pick = (list) => list[Math.floor(next() * list.length)];
  next.chance = (p) => next() < p;
  next.hex = (n) => Array.from({ length: n }, () => '0123456789abcdef'[Math.floor(next() * 16)]).join('');
  next.shuffle = (list) => { const l = list.slice(); for (let i = l.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [l[i], l[j]] = [l[j], l[i]]; } return l; };
  return next;
}

export function money(v, { dp = 2, dash = true } = {}) {
  if (v == null || Number.isNaN(v)) return dash ? '—' : '$0.00';
  const s = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
  return (v < 0 ? '-$' : '$') + s;
}
export const money4 = (v) => (v == null ? '—' : v < 0.01 && v > 0 ? '$' + v.toFixed(4) : money(v));
export const int = (v) => (v == null ? '—' : Math.round(v).toLocaleString('en-US'));
export const pct = (v, dp = 0) => (v == null || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(dp)}%`);

// Token counts in Indian units, as the product shows them: 1.5K, 66L, 14.4Cr.
export function tokens(n) {
  if (n == null) return '—';
  const a = Math.abs(n);
  const f = (x) => (x >= 100 ? x.toFixed(0) : x >= 10 ? x.toFixed(1).replace(/\.0$/, '') : x.toFixed(1).replace(/\.0$/, ''));
  if (a >= 1e7) return f(n / 1e7) + 'Cr';
  if (a >= 1e5) return f(n / 1e5) + 'L';
  if (a >= 1e3) return f(n / 1e3) + 'K';
  return String(Math.round(n));
}
export const compact = (n) => (n >= 1e3 ? (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K' : String(Math.round(n)));

export function ago(t) {
  const d = now() - t;
  if (d < 45e3) return 'just now';
  if (d < 90e3) return 'a minute ago';
  if (d < HOUR) return `${Math.round(d / MIN)} minutes ago`;
  if (d < 1.5 * HOUR) return 'an hour ago';
  if (d < DAY) return `${Math.round(d / HOUR)} hours ago`;
  if (d < 2 * DAY) return 'yesterday';
  if (d < 30 * DAY) return `${Math.round(d / DAY)} days ago`;
  if (d < 60 * DAY) return 'a month ago';
  return `${Math.round(d / (30 * DAY))} months ago`;
}
export function until(t) {
  const d = t - now();
  if (d < MIN) return 'in under a minute';
  if (d < HOUR) return `in ${Math.round(d / MIN)} minute${Math.round(d / MIN) === 1 ? '' : 's'}`;
  return `in ${Math.round(d / HOUR)} hours`;
}

const IST = 5.5 * HOUR;
const ist = (t) => new Date(t + IST);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function dayLabel(t) { const d = ist(t); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; }
export function timeLabel(t) {
  const d = ist(t); let h = d.getUTCHours(); const m = String(d.getUTCMinutes()).padStart(2, '0');
  const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;
  return `${String(h).padStart(2, '0')}:${m} ${ap}`;
}
export function stamp(t) {
  const d = ist(t); let h = d.getUTCHours(); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;
  const p = (x) => String(x).padStart(2, '0');
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}, ${h}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} ${ap}`;
}
export const dayKey = (t) => { const d = ist(t); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`; };
// Midnight IST of a yyyy-mm-dd key, as epoch ms.
export const dayStart = (key) => Date.parse(key + 'T00:00:00Z') - IST;

export function duration(ms) {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60e3) return `${(ms / 1000).toFixed(1)} s`;
  if (ms < HOUR) { const m = Math.floor(ms / 60e3); const s = Math.round((ms % 60e3) / 1000); return s ? `${m} m ${s} s` : `${m} min`; }
  return `${(ms / HOUR).toFixed(1)} h`;
}
export const latency = (ms) => (ms >= 60e3 ? `${(ms / 60e3).toFixed(1)} min` : ms >= 1000 ? `${(ms / 1000).toFixed(ms >= 10e3 ? 0 : 1)} s` : `${Math.round(ms).toLocaleString('en-US')} ms`);

export const sum = (list, f = (x) => x) => list.reduce((a, x) => a + (Number(f(x)) || 0), 0);
export function groupBy(list, f) { const m = new Map(); for (const x of list) { const k = f(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); } return m; }
export const plural = (n, one, many = one + 's') => `${int(n)} ${n === 1 ? one : many}`;
export const cap = (s) => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);
export const initials = (email) => String(email || '?').split('@')[0].split(/[._-]/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('') || '?';
export const debounce = (fn, ms = 150) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
