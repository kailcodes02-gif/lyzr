// Demo sign-ins viewer. Same sign-in as Campaign Analytics: a Microsoft token (this browser may
// already hold one from /Campaign_Analytics/, same app registration) or a CA email/password
// session; /api/ocdemo/admin lets editors only.
import { signIn, silentToken } from '../shared/msauth.mjs';

const KEY = 'ocdemo.admin';
const $ = (id) => document.getElementById(id);
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ago = (t) => { const d = (Date.now() - Date.parse(t)) / 1000; if (d < 90) return 'just now'; if (d < 3600) return `${Math.round(d / 60)} min ago`; if (d < 86400) return `${Math.round(d / 3600)} h ago`; return `${Math.round(d / 86400)} days ago`; };
const day = (t) => new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
let data = null;

function local() { try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); return s && Date.parse(s.expires_at) > Date.now() ? s : null; } catch { return null; } }
async function token() { const l = local(); if (l) return l.token; return silentToken(); }

async function load() {
  $('err').textContent = '';
  const t = await token();
  if (!t) { show(false); return; }
  const r = await fetch('/api/ocdemo/admin', { headers: { Authorization: 'Bearer ' + t } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { show(false); $('err').textContent = j.error || `Could not load (${r.status}).`; return; }
  data = j; show(true); $('who').textContent = j.me; render();
}
function show(on) { $('gate').hidden = on; $('data').hidden = !on; $('out').hidden = !on; }

function render() {
  const q = $('q').value.toLowerCase(); const aud = $('aud').value;
  const leads = data.leads.filter((l) => (!aud || l.audience === aud) && (!q || `${l.name} ${l.email} ${l.company}`.toLowerCase().includes(q)));
  const week = data.leads.filter((l) => Date.now() - Date.parse(l.last_seen) < 7 * 864e5).length;
  $('kpis').innerHTML = [['People', data.leads.length], ['Outside Lyzr', data.leads.filter((l) => l.audience === 'external').length], ['Lyzr', data.leads.filter((l) => l.audience === 'lyzr').length], ['Active in the last 7 days', week]]
    .map(([l, v]) => `<div class="stat"><span class="stat-label">${l}</span><span class="stat-value">${v}</span></div>`).join('');
  const how = { microsoft: 'Microsoft', email_code: 'Email code', email_domain: 'Work email' };
  $('rows').innerHTML = leads.map((l) => `<tr><td><b>${esc(l.name || '—')}</b><p class="muted small">${esc(l.email)}${l.title ? ' · ' + esc(l.title) : ''}</p></td><td>${esc(l.company || '—')}</td><td><span class="pill ${l.audience === 'lyzr' ? 'pill-blue' : 'pill-green'}">${l.audience === 'lyzr' ? 'Lyzr' : 'Outside'}</span></td><td>${esc(how[l.auth_method] || l.auth_method)}${l.country ? ` <span class="muted small">· ${esc(l.country)}</span>` : ''}</td><td class="r num">${l.visits}</td><td class="r num">${l.screens_viewed}</td><td class="small muted">${(data.recent.filter((e) => e.lead_id === l.id && e.kind === 'view').map((e) => e.screen).filter((s, i, a) => a.indexOf(s) === i).slice(0, 4).map(esc).join(', ')) || '—'}</td><td class="small">${day(l.first_seen)}</td><td class="small muted">${ago(l.last_seen)}</td></tr>`).join('') || '<tr class="empty-row"><td colspan="9">Nobody yet.</td></tr>';
  const max = Math.max(1, ...data.screens.map((s) => s.views));
  $('screens').innerHTML = data.screens.slice(0, 14).map((s) => `<div class="bl-row"><span class="bl-label"><span class="bl-text">${esc(s.screen)}</span></span><span class="bl-bar"><i style="width:${(s.views / max) * 100}%"></i></span><span class="bl-val">${s.views}</span></div>`).join('') || '<p class="muted">No screens opened yet.</p>';
  $('recent').innerHTML = data.recent.slice(0, 30).map((e) => `<div class="row"><span class="pill pill-grey">${esc(e.kind)}</span><span class="trunc">${esc(e.detail || e.screen || '')}</span><span class="grow"></span><span class="muted small">${esc(e.email || '')} · ${ago(e.at)}</span></div>`).join('') || '<p class="muted">Nothing yet.</p>';
}

$('ms').addEventListener('click', async () => {
  $('err').textContent = '';
  try { await signIn(); localStorage.removeItem(KEY); await load(); } catch (e) { $('err').textContent = e.message; }
});
$('pw').addEventListener('submit', async (e) => {
  e.preventDefault(); $('err').textContent = '';
  const f = e.target;
  const r = await fetch('/api/ca/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: f.email.value, password: f.password.value }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { $('err').textContent = j.error || 'Sign-in failed.'; return; }
  localStorage.setItem(KEY, JSON.stringify({ token: j.token, expires_at: j.expires_at }));
  load();
});
$('out').addEventListener('click', () => { localStorage.removeItem(KEY); location.reload(); });
$('q').addEventListener('input', () => data && render());
$('aud').addEventListener('change', () => data && render());
$('reload').addEventListener('click', load);
$('csv').addEventListener('click', async () => {
  const r = await fetch('/api/ocdemo/admin?format=csv', { headers: { Authorization: 'Bearer ' + (await token()) } });
  if (!r.ok) { $('err').textContent = 'Could not download.'; return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(await r.blob()); a.download = 'opencontroller-demo-signins.csv'; a.click();
});
addEventListener('load', load);
