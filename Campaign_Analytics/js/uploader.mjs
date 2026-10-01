// Upload box for a channel page (LinkedIn, Instantly). Any file can be dropped: each one is
// read and recognised in the browser (js/upload-detect.mjs) and filed under the right
// channel and campaign, even if it was dropped on another channel's page. "Upload all"
// sends the queue two files at a time.
import { detectFile } from './upload-detect.mjs';
import { campaignLabel } from './email-csv.mjs';
import { PLATFORM_LABEL } from './ads-csv.mjs';
import { clearMemo } from './compare.mjs';

const CHUNK = 1500;
const STATE = {};

// One drop zone for every channel. Each file is read and recognised in the browser
// (js/upload-detect.mjs): LinkedIn performance, LinkedIn demographics or an Instantly campaign
// export. "Upload all" sends the queue two files at a time. Uploads can happen at any cadence;
// overlapping LinkedIn days overwrite, repeated Instantly exports only add new events.
export async function mountUploader(body, ctx, { channel, platform, isEditor, onDone } = {}) {
  const stateKey = platform ? `${channel}:${platform}` : channel;
  const state = STATE[stateKey] || (STATE[stateKey] = { pending: [], failed: [], busy: false });
  const pname = PLATFORM_LABEL[platform] || 'LinkedIn';
  const { esc, fmt } = ctx.fmt;
  const what = channel === 'email'
    ? 'Instantly campaign exports (Campaign › Analytics › Export CSV). The campaign comes from the file name. Exports are cumulative, so upload the newest export whenever you like: nothing is double counted.'
    : platform && platform !== 'linkedin' ? `${pname} campaign or ad reports exported by day (one row per campaign or ad per day). Upload whenever you have them; overlapping days are overwritten, not added twice.`
    : 'LinkedIn Campaign Manager exports: Ads › Export (ad level, daily) and Demographics › Export. Upload whenever you have them; overlapping days are overwritten, not added twice.';
  body.innerHTML = `${isEditor ? `<div class="drop" id="drop">Drop CSV or Excel files here, or click to choose. Many at once is fine.<br><span class="muted" style="font-size:12.5px">${what} A file from another channel is recognised and filed where it belongs.</span><input type="file" id="file" accept=".csv,.tsv,.txt,.xlsx,.xls,text/csv,text/plain" multiple class="hidden"></div>` : ctx.ui.empty('Only editors can upload files.')}
     <div id="pending" style="margin-top:14px"></div>
     <details style="margin-top:14px"><summary class="ui-label" style="cursor:pointer">Files uploaded so far</summary><div id="list" style="margin-top:10px">${ctx.ui.spinner('Loading uploads')}</div></details>`;
  const drop = body.querySelector('#drop'), input = body.querySelector('#file');
  if (drop) {
    drop.onclick = () => input.click();
    drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
    drop.ondragleave = () => drop.classList.remove('over');
    drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); addFiles([...e.dataTransfer.files]); };
    input.onchange = () => { addFiles([...input.files]); input.value = ''; };
  }
  drawPending();
  await drawList();

  async function addFiles(files) {
    const box = body.querySelector('#pending');
    if (box && files.length > 3) box.insertAdjacentHTML('afterbegin', `<p class="muted" data-reading>${ctx.ui.spinner(`Reading ${files.length} files`)}</p>`);
    const failed = [];
    for (const f of files) {
      try { state.pending.push(await detectFile(f)); }
      catch (e) { failed.push(`${f.name}: ${e.message}`); }
    }
    if (failed.length) ctx.toast(`${failed.length} file${failed.length === 1 ? '' : 's'} not recognised. ${failed.slice(0, 2).join(' · ')}`, 'err');
    state.failed = failed;
    drawPending();
  }
  const ready = p => !p.needs.length || (p.needs.includes('window') ? p.parsed.period_start && p.parsed.period_end && p.parsed.period_start <= p.parsed.period_end : true);
  function drawPending() {
    const box = body.querySelector('#pending'); if (!box) return;
    const q = state.pending;
    if (!q.length && !(state.failed || []).length) { box.innerHTML = ''; return; }
    const by = {}; for (const p of q) by[p.label.startsWith('Email') ? 'Email' : p.label] = (by[p.label.startsWith('Email') ? 'Email' : p.label] || 0) + 1;
    const kindPill = p => ctx.ui.pill(p.channel === 'email' ? 'Email' : p.kind === 'performance' ? `Ads · ${PLATFORM_LABEL[p.platform || 'linkedin'] || p.platform}` : 'Ads · LinkedIn demographics', p.channel === 'email' ? 'p-med' : p.kind === 'performance' ? 'p-high' : 'p-low');
    const waiting = q.filter(p => p.status !== 'done' && p.status !== 'uploading');
    box.innerHTML = `<div class="card">
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><b>${fmt(q.length)} file${q.length === 1 ? '' : 's'} ready</b>${Object.entries(by).map(([k, n]) => `<span class="tag">${esc(k)}: ${n}</span>`).join('')}
        <span style="margin-left:auto"></span><button class="btn primary" data-all ${waiting.filter(ready).length && !state.busy ? '' : 'disabled'}>${state.busy ? '<span class="spin"></span> Uploading' : `Upload all (${waiting.filter(ready).length})`}</button><button class="btn ghost tiny" data-clear>Clear list</button></div>
      ${(state.failed || []).length ? `<ul style="margin:8px 0 0;padding-left:18px;color:var(--bad);font-size:13px">${state.failed.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      <div class="tblwrap" style="margin-top:10px"><table><thead><tr><th class="l">File</th><th class="l">Goes to</th><th class="l">Campaign / window</th><th>Rows</th><th class="l">Checks</th><th class="l">Status</th><th></th></tr></thead><tbody>
      ${q.map(p => { const r = p.parsed; const email = p.channel === 'email';
        return `<tr data-id="${p.id}"><td class="l mono" style="max-width:260px;word-break:break-all">${esc(p.file)}</td>
          <td class="l">${kindPill(p)}</td>
          <td class="l">${email ? `<input type="text" data-k="campaign" value="${esc(r.campaign)}" style="width:100%;min-width:200px"><div class="muted" style="font-size:11.5px">${esc(r.stats.from || '')} to ${esc(r.stats.to || '')} · ${fmt(r.stats.contacts)} contacts</div>`
            : p.kind === 'demographics' ? `<input type="date" data-k="start" value="${esc(r.period_start || '')}"> <input type="date" data-k="end" value="${esc(r.period_end || '')}"><div class="muted" style="font-size:11.5px">${esc([...new Set(r.rows.map(x => x.segment))].filter(Boolean).join(', ') || 'no segment found')}</div>`
            : `<span class="muted">per day in file${r.period_start ? `: ${esc(r.period_start)} to ${esc(r.period_end || '')}` : ''}</span>`}</td>
          <td>${fmt(r.rows.length)}${email ? `<div class="muted" style="font-size:11.5px">${fmt(r.stats.sent)} sent · ${fmt(r.stats.opened)} opens · ${fmt(r.stats.clicked)} clicks</div>` : ''}</td>
          <td class="l" style="font-size:12.5px;color:var(--warn)">${(r.warnings || []).map(esc).join('<br>')}${p.needs.includes('window') && !ready(p) ? '<span class="down">Enter the export window</span>' : ''}</td>
          <td class="l" style="font-size:12.5px">${p.status === 'done' ? '<span class="up">Uploaded</span>' : p.status === 'uploading' ? `<span class="spin"></span> ${esc(p.progress)}` : p.status === 'error' ? `<span class="down">${esc(p.progress)}</span>` : '<span class="muted">waiting</span>'}</td>
          <td><button class="btn tiny ghost" data-rm ${p.status === 'uploading' ? 'disabled' : ''}>Remove</button></td></tr>`; }).join('')}
      </tbody></table></div></div>`;
    box.querySelectorAll('tr[data-id]').forEach(tr => {
      const p = q.find(x => x.id === tr.dataset.id); if (!p) return;
      const c = tr.querySelector('[data-k=campaign]'); if (c) c.onchange = () => { const v = c.value.trim(); p.parsed.campaign = v; p.parsed.rows.forEach(r => { r.campaign = v; }); };
      const s = tr.querySelector('[data-k=start]'); if (s) s.onchange = () => { p.parsed.period_start = s.value; drawPending(); };
      const e = tr.querySelector('[data-k=end]'); if (e) e.onchange = () => { p.parsed.period_end = e.value; drawPending(); };
      tr.querySelector('[data-rm]').onclick = () => { state.pending = state.pending.filter(x => x !== p); drawPending(); };
    });
    box.querySelector('[data-clear]').onclick = () => { if (state.busy) return; state.pending = []; state.failed = []; drawPending(); };
    const all = box.querySelector('[data-all]'); if (all) all.onclick = uploadAll;
  }
  async function uploadOne(p) {
    const r = p.parsed;
    p.status = 'uploading'; p.progress = 'starting'; drawPending();
    try {
      let upload_id = null, sent = 0;
      const period_start = p.channel === 'email' ? r.stats.from : r.period_start || null;
      const period_end = p.channel === 'email' ? r.stats.to : r.period_end || null;
      for (let i = 0; i < r.rows.length; i += CHUNK) {
        const chunk = r.rows.slice(i, i + CHUNK);
        const res = await ctx.api.post('uploads', { channel: p.channel, platform: p.channel === 'email' ? undefined : (p.platform || 'linkedin'), kind: p.kind, file_name: p.file, period_start, period_end, columns: r.columns, rows: chunk, notes: p.channel === 'email' ? r.campaign : p.kind === 'demographics' ? [...new Set(r.rows.map(x => x.segment))].filter(Boolean).join(', ') || undefined : undefined, upload_id: upload_id || undefined, final: i + CHUNK >= r.rows.length });
        upload_id = upload_id || res.upload_id; sent += chunk.length;
        p.progress = `${fmt(sent)} of ${fmt(r.rows.length)} rows`; drawPending();
      }
      p.status = 'done'; p.progress = `${fmt(sent)} rows`;
    } catch (e) { p.status = 'error'; p.progress = 'Failed: ' + (e.message || e); }
  }
  async function uploadAll() {
    if (state.busy) return;
    const todo = state.pending.filter(p => p.status !== 'done' && p.status !== 'uploading' && ready(p));
    if (!todo.length) return;
    state.busy = true; drawPending();
    let next = 0;
    const worker = async () => { while (next < todo.length) { const p = todo[next++]; await uploadOne(p); } };
    await Promise.all([worker(), worker()]);
    state.busy = false;
    const ok = todo.filter(p => p.status === 'done').length, bad = todo.length - ok;
    ctx.toast(`${ok} file${ok === 1 ? '' : 's'} uploaded${bad ? `, ${bad} failed` : ''}.`, bad ? 'err' : '');
    state.pending = state.pending.filter(p => p.status !== 'done');
    if (!state.pending.length) state.failed = [];
    clearMemo();
    drawPending(); await drawList();
    if (ok && onDone) onDone();
  }
  async function drawList() {
    const list = body.querySelector('#list'); if (!list) return;
    try {
      const { uploads } = await ctx.api.get('uploads', { channel, platform: platform || undefined });
      if (!uploads || !uploads.length) { list.innerHTML = '<p class="muted" style="font-size:13px">Nothing uploaded yet.</p>'; return; }
      list.innerHTML = ctx.ui.table({ cols: [
        { h: 'Tab', k: 'channel', left: true, f: u => ctx.ui.pill(u.channel === 'email' ? 'Email' : u.kind === 'performance' ? `Ads · ${PLATFORM_LABEL[u.platform || 'linkedin'] || u.platform}` : 'Ads · LinkedIn demographics', u.channel === 'email' ? 'p-med' : u.kind === 'performance' ? 'p-high' : 'p-low') },
        { h: 'Campaign / window', k: 'w', left: true, f: u => u.channel === 'email' ? `${esc(campaignLabel(u.notes || ''))}<br><span class="muted" style="font-size:11.5px">${u.period_start ? esc(ctx.fmt.rangeLabel(u.period_start, u.period_end)) : ''}</span>` : u.period_start ? `${esc(ctx.fmt.rangeLabel(u.period_start, u.period_end))}${u.kind === 'demographics' ? `<br><span class="muted" style="font-size:11.5px">${esc(u.notes || 'segments not recorded')}</span>` : ''}` : '<span class="muted">per day</span>' },
        { h: 'Rows', k: 'row_count', f: u => u.row_count ? fmt(u.row_count) : '<span class="down" title="Nothing was read from this file: delete it and upload again">0</span>' },
        { h: 'File', k: 'file_name', left: true, f: u => `<span class="mono">${esc(u.file_name || '')}</span>` },
        { h: 'Uploaded by', k: 'uploaded_by', left: true, f: u => esc(u.uploaded_by || '') },
        { h: 'At', k: 'uploaded_at', left: true, f: u => esc(ctx.fmt.istDateTime(u.uploaded_at)) },
        { h: '', k: 'x', f: u => isEditor ? `<button class="btn tiny ghost" data-del="${esc(u.id)}" data-name="${esc(u.file_name || u.id)}">Delete</button>` : '' },
      ], rows: uploads.sort((a, b) => (a.uploaded_at < b.uploaded_at ? 1 : -1)) });
      list.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
        if (!confirm(`Delete "${b.dataset.name}" and its rows? This cannot be undone.`)) return;
        try { await ctx.api.del('uploads', { id: b.dataset.del }); clearMemo(); ctx.toast('Upload deleted.'); await drawList(); if (onDone) onDone(); } catch (e) { ctx.toast('Delete failed: ' + e.message, 'err'); }
      });
    } catch (e) { list.innerHTML = ctx.ui.empty('Uploads could not be loaded: ' + (e.message || e)); }
  }
}

