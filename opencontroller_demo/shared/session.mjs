// The visitor's demo session (kept in this browser after the sign-in on the landing page) and the
// small activity log sent to /api/ocdemo/track. Works with storage blocked: the session then lasts
// for this page only.
export const BOOK_DEMO_URL = 'https://www.lyzr.ai/book-demo/';
const KEY = 'ocdemo.session';
const TTL_MS = 30 * 24 * 60 * 60 * 1000;
let memory = null;

export function getSession() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (s && s.email && Date.now() - (s.at || 0) < TTL_MS) return s;
  } catch { /* storage blocked */ }
  return memory;
}

export function setSession(lead) {
  const s = { lead_id: lead.id || null, email: lead.email, name: lead.name || lead.email, audience: lead.audience, at: Date.now() };
  memory = s;
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage blocked */ }
  return s;
}

export function clearSession() {
  memory = null;
  try { localStorage.removeItem(KEY); } catch { /* storage blocked */ }
}

// ---- activity ----
const queue = [];
let timer = null;
export function track(kind, screen, detail) {
  const s = getSession();
  if (!s || !s.lead_id) return;
  queue.push({ kind, screen: screen || null, detail: detail || null });
  if (queue.length >= 20) flush();
  else if (!timer) timer = setTimeout(flush, 4000);
}

export function flush() {
  clearTimeout(timer); timer = null;
  const s = getSession();
  if (!s || !s.lead_id || !queue.length) return;
  const body = JSON.stringify({ lead_id: s.lead_id, events: queue.splice(0, 40) });
  try {
    if (navigator.sendBeacon && navigator.sendBeacon('/api/ocdemo/track', new Blob([body], { type: 'application/json' }))) return;
  } catch { /* fall back to fetch */ }
  fetch('/api/ocdemo/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
}

if (typeof window !== 'undefined') {
  addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
}
