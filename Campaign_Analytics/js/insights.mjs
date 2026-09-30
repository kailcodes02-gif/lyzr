// AI insight panel: shows the cached Claude findings for a scope and lets the
// user regenerate. Views call mountInsights(el, ctx, {scope, kind, input, title}).
// Backend: POST /api/ca/insights -> { content:{ headline, findings:[{title, evidence, so_what, action, owner, severity}], summary, progress:[{action, status, verdict}] }, cached, created_at }
// Every finding can be tracked as an action (js/actions.mjs). The tracked list for the channel
// is sent with the input as `action_log`, so the read-out says what was done and whether it worked.
import { esc, timeAgo } from './fmt.mjs';
import { CHANNEL_OF_KIND, actionLog, trackAction, mountActions } from './actions.mjs';

export async function mountInsights(el, ctx, { scope, kind, input, title = 'What this means', inputProvider, channel }) {
  const ch = channel || CHANNEL_OF_KIND[kind] || 'overview';
  const sev = s => s === 'risk' ? 'bad' : s === 'watch' ? 'warn' : s === 'win' ? 'good' : '';
  let state = { loading: false, data: null, error: null };
  let tracker = null;
  el.innerHTML = '<div data-ins></div><div data-act style="margin-top:14px"></div>';
  const box = el.querySelector('[data-ins]');
  const draw = () => {
    const d = state.data;
    box.innerHTML = `<div class="insights"><div class="head"><span class="tag orange">AI</span><h3>${esc(title)}</h3><span class="spacer"></span>` +
      (d ? `<span class="muted" style="font-size:12px">${d.cached ? 'cached ' : 'generated '}${timeAgo(d.created_at)}${d.model ? ' · ' + esc(d.model) : ''}</span>` : '') +
      `<button class="btn tiny" id="gen" ${state.loading ? 'disabled' : ''}>${state.loading ? '<span class="spin"></span> Thinking' : (d ? 'Regenerate' : 'Generate insights')}</button></div>` +
      (state.error ? `<p class="err">${esc(state.error)}</p>` : '') +
      (d && d.content ? renderContent(d.content) : (!state.loading ? `<p class="muted" style="margin-top:8px">No analysis yet for this view. Generate to get findings, the evidence behind them, suggested actions and a check on the actions already tracked.</p>` : '')) + '</div>';
    box.querySelector('#gen').onclick = () => run(true);
    box.querySelectorAll('[data-track]').forEach(b => b.onclick = async () => {
      const f = state.data.content.findings[+b.dataset.track];
      b.disabled = true;
      try { await trackAction(ctx, ch, f, scope); b.textContent = 'Tracked'; ctx.toast('Added to the action tracker.'); if (tracker) tracker.reload(); }
      catch (e) { b.disabled = false; ctx.toast('Could not track: ' + e.message, 'err'); }
    });
  };
  const renderContent = c => {
    let h = c.headline ? `<p style="margin-top:10px;font-weight:600">${esc(c.headline)}</p>` : '';
    if ((c.progress || []).length) h += `<div class="progress"><b>Actions already tracked</b><ul style="margin:4px 0 0;padding-left:18px">${c.progress.map(p => `<li><span class="pill ${p.status === 'done' ? 'p-high' : p.status === 'dropped' ? 'p-na' : 'p-med'}">${esc(p.status)}</span> <b>${esc(p.action)}</b>: ${esc(p.verdict)}</li>`).join('')}</ul></div>`;
    h += (c.findings || []).map((f, i) => `<div class="finding"><div class="badge ${sev(f.severity)}">${i + 1}</div><div><b>${esc(f.title)}</b>${f.evidence ? `<div class="ev">${esc(f.evidence)}</div>` : ''}${f.so_what ? `<div style="margin-top:4px">${esc(f.so_what)}</div>` : ''}${f.action ? `<div class="act">Action: ${esc(f.action)}${f.owner ? ` <span class="muted">(${esc(f.owner)})</span>` : ''}</div> <button class="btn tiny ghost" data-track="${i}" style="margin-left:6px">Track</button>` : ''}</div></div>`).join('');
    if (c.summary) h += `<p class="muted" style="margin-top:10px;font-size:13px">${esc(c.summary)}</p>`;
    return h;
  };
  const run = async (force) => {
    state.loading = true; state.error = null; draw();
    try {
      const base = inputProvider ? await inputProvider() : input;
      const log = await actionLog(ctx, ch);
      const payload = { scope, kind, input: log.length ? { ...base, action_log: log } : base, force };
      state.data = await ctx.api.post('insights', payload);
    } catch (e) { state.error = e.message || String(e); }
    state.loading = false; draw();
  };
  draw();
  mountActions(el.querySelector('[data-act]'), ctx, { channel: ch, title: ch === 'overview' ? 'Action tracker (all channels)' : 'Action tracker' }).then(t => { tracker = t; });
  try { const cached = await ctx.api.get('insights', { scope }); if (cached && cached.content) { state.data = { ...cached, cached: true }; draw(); } } catch { /* 404 = nothing cached */ }
}
