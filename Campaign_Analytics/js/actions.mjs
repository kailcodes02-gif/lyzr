// Tracked actions: what was suggested (by Claude or by hand), who owns it, and whether it is done.
// Backend: /api/ca/actions (GET ?channel, POST, PUT {id,status,note,...}, DELETE ?id).
// mountActions(el, ctx, { channel }) renders the tracker; actionLog(ctx, channel) is what the
// Claude read-out receives so it can say which actions worked and which are still open.
import { esc, timeAgo } from './fmt.mjs';

export const CHANNEL_OF_KIND = { ads: 'linkedin', leads: 'leads', messaging: 'messaging', overview: 'overview', email: 'email' };
const STATE = new Map(); // channel -> { filter }

export async function loadActions(ctx, channel) {
  const res = await ctx.api.get('actions', channel && channel !== 'overview' ? { channel } : {});
  return (res && res.actions) || [];
}

/** Compact log for the Claude input: most recent 40, open first. */
export async function actionLog(ctx, channel) {
  try {
    const list = await loadActions(ctx, channel);
    return list.slice(0, 40).map(a => ({ action: a.title, channel: a.channel, status: a.status, owner: a.owner || null, created: (a.created_at || '').slice(0, 10), done: a.done_at ? a.done_at.slice(0, 10) : null, note: a.note || null }));
  } catch { return []; }
}

export async function trackAction(ctx, channel, f, scope) {
  return ctx.api.post('actions', { channel, title: f.action || f.title, detail: [f.title, f.evidence].filter(Boolean).join(' · '), owner: f.owner || '', source: 'ai', scope });
}

export async function mountActions(el, ctx, { channel, title = 'Action tracker' }) {
  const st = STATE.get(channel) || { filter: 'open' }; STATE.set(channel, st);
  let list = [], error = null;
  const load = async () => { try { list = await loadActions(ctx, channel); error = null; } catch (e) { error = e.message || String(e); } draw(); };
  const draw = () => {
    const shown = list.filter(a => st.filter === 'all' ? true : st.filter === 'open' ? a.status === 'open' : a.status !== 'open');
    const nOpen = list.filter(a => a.status === 'open').length, nDone = list.filter(a => a.status === 'done').length;
    el.innerHTML = `<div class="actions"><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><h3 style="margin:0">${esc(title)}</h3>
      <span class="tag">${nOpen} open</span><span class="tag">${nDone} done</span><span style="margin-left:auto" data-seg></span></div>
      <p class="muted" style="font-size:12.5px;margin:4px 0 8px">Suggestions from the read-out (press Track on a finding) and your own to-dos. Tick one off when it is done and add what happened; the next read-out is told what is done and what is still open.</p>
      ${error ? `<p class="err">${esc(error)}</p>` : ''}
      ${shown.length ? shown.map(a => `<div class="act-row ${a.status}" data-id="${esc(a.id)}">
        <input type="checkbox" data-done ${a.status === 'done' ? 'checked' : ''} aria-label="Done" style="margin-top:4px">
        <div><div class="at">${esc(a.title)}</div>
          <div class="am">${a.owner ? esc(a.owner) + ' · ' : ''}${a.source === 'ai' ? 'from the AI read-out' : 'added by hand'}${channel === 'overview' ? ' · ' + esc(a.channel) : ''} · ${esc(timeAgo(a.created_at))}${a.status === 'done' && a.done_at ? ' · done ' + esc(timeAgo(a.done_at)) : ''}${a.status === 'dropped' ? ' · dropped' : ''}</div>
          ${a.detail ? `<div class="am" style="margin-top:2px">${esc(a.detail)}</div>` : ''}
          <input type="text" data-note placeholder="What happened (optional)" value="${esc(a.note || '')}" style="margin-top:6px;width:100%;font-size:12.5px"></div>
        <div style="display:flex;flex-direction:column;gap:4px">${a.status === 'dropped' ? '<button class="btn tiny ghost" data-reopen>Reopen</button>' : `<button class="btn tiny ghost" data-drop>${a.status === 'done' ? 'Reopen' : 'Drop'}</button>`}</div></div>`).join('')
        : `<p class="muted" style="font-size:13px">${st.filter === 'open' ? 'Nothing open.' : 'Nothing here yet.'}</p>`}
      <form data-add class="row" style="margin-top:10px;align-items:center"><input type="text" name="t" placeholder="Add an action" style="flex:1;min-width:220px"><input type="text" name="o" placeholder="Owner" style="width:140px"><button class="btn tiny" type="submit">Add</button></form></div>`;
    ctx.ui.seg(el.querySelector('[data-seg]'), [{ value: 'open', label: 'Open' }, { value: 'closed', label: 'Done / dropped' }, { value: 'all', label: 'All' }], v => { st.filter = v; draw(); }, st.filter);
    el.querySelectorAll('.act-row').forEach(row => {
      const id = row.dataset.id, a = list.find(x => x.id === id);
      const put = async patch => { try { const r = await ctx.api.put('actions', { id, ...patch }); Object.assign(a, r.action || patch); draw(); } catch (e) { ctx.toast('Could not update: ' + e.message, 'err'); } };
      row.querySelector('[data-done]').onchange = e => put({ status: e.target.checked ? 'done' : 'open' });
      const drop = row.querySelector('[data-drop]'); if (drop) drop.onclick = () => put({ status: a.status === 'done' ? 'open' : 'dropped' });
      const re = row.querySelector('[data-reopen]'); if (re) re.onclick = () => put({ status: 'open' });
      const note = row.querySelector('[data-note]'); note.onchange = () => put({ note: note.value });
    });
    el.querySelector('[data-add]').onsubmit = async e => {
      e.preventDefault(); const fd = new FormData(e.target); const t = String(fd.get('t') || '').trim(); if (!t) return;
      try { const r = await ctx.api.post('actions', { channel: channel || 'overview', title: t, owner: String(fd.get('o') || ''), source: 'manual' }); list.unshift(r.action); st.filter = 'open'; draw(); } catch (err) { ctx.toast('Could not add: ' + err.message, 'err'); }
    };
  };
  el.innerHTML = '<p class="muted"><span class="spin"></span> Loading actions…</p>';
  await load();
  return { reload: load };
}
