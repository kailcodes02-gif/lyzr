// Settings and uploads: bulk uploads for every channel, email rules, GSI companies, accounts and bands, regions, ICP pools, targets, editors, connection.
import { detectFile } from '../upload-detect.mjs';
import { campaignLabel } from '../email-csv.mjs';
export const route = 'settings';
export const title = 'Settings & uploads';
export const noRange = true;

const TABS = [['uploads', 'Uploads'], ['email', 'Email rules'], ['gsi', 'GSI companies'], ['accounts', 'Accounts & bands'], ['regions', 'Regions'], ['icp', 'ICP pools'], ['targets', 'Targets'], ['editors', 'Editors'], ['connection', 'Connection']];
const SEED_FILE = { accounts: 'accounts.json', bands: 'band_titles.json', regions: 'regions.json', icp_pool: 'icp_pool.json' };
const DEFAULTS = { targets: { leads_per_month: 200, demo_mqls_per_month: 30, frequency: 3.5 }, editors: [] };
const CHUNK = 1500;
const REDIRECT_URI = 'https://lyzr.kailash-gm.com/Campaign_Analytics/';
const state = { tab: 'uploads', health: null, pending: [], failed: [], busy: false };

export async function render(el, ctx) {
  const { esc } = ctx.fmt;
  if (!state.health) { try { state.health = await ctx.api.get('health'); } catch (e) { state.health = { ok: false, error: e.message }; } }
  if (!ctx.settings) { try { ctx.settings = await ctx.api.get('settings'); } catch { ctx.settings = {}; } }
  const isEditor = !!ctx.demo || !!(state.health && state.health.user && state.health.user.isEditor);
  el.innerHTML = `<div class="seghead">Settings</div><h1>Settings and uploads</h1>
  <p class="sub">Upload exports whenever you have them (any number of files, any channel) and keep the reference lists (accounts, designation bands, regions, ICP headcounts, targets) that every view reads. ${isEditor ? 'You can edit.' : 'You are viewing read-only; ask an editor to change anything.'}</p>
  <div id="tabs"></div><div id="tabBody"></div>`;
  const body = el.querySelector('#tabBody');
  const draw = () => { body.innerHTML = ''; TAB_RENDER[state.tab](body, ctx, isEditor); };
  ctx.ui.seg(el.querySelector('#tabs'), TABS.map(([value, label]) => ({ value, label })), v => { state.tab = v; draw(); }, state.tab);
  draw();
}

const TAB_RENDER = { uploads: uploadsTab, email: emailRulesTab, gsi: gsiTab, accounts: (b, c, e) => settingTab(b, c, e, 'accounts'), regions: (b, c, e) => settingTab(b, c, e, 'regions'), icp: (b, c, e) => settingTab(b, c, e, 'icp_pool'), targets: (b, c, e) => settingTab(b, c, e, 'targets'), editors: (b, c, e) => settingTab(b, c, e, 'editors'), connection: connectionTab };

// ---------------- Uploads ----------------
// One drop zone for every channel. Each file is read and recognised in the browser
// (js/upload-detect.mjs): LinkedIn performance, LinkedIn demographics or an Instantly campaign
// export. "Upload all" sends the queue two files at a time. Uploads can happen at any cadence;
// overlapping LinkedIn days overwrite, repeated Instantly exports only add new events.
async function uploadsTab(body, ctx, isEditor) {
  const { esc, fmt } = ctx.fmt;
  body.innerHTML = ctx.ui.section('Uploads', 'Drop any number of files at once, from any channel. Each one is recognised and sent to the right tab: LinkedIn Campaign Manager exports (ad performance per day, or demographics for a window) go to Ads · LinkedIn; Instantly campaign exports go to Email, filed under the campaign in the file name. CSV and Excel both work. Upload whenever you like: re-uploading a period or a newer export of the same campaign updates it without double counting.',
    `${isEditor ? `<div class="drop" id="drop">Drop CSV or Excel files here (20 or more at a time is fine), or click to choose<br><span class="muted" style="font-size:12.5px">LinkedIn: Ads › Export (ad level, daily) and Demographics › Export. Instantly: Campaign › Analytics › Export CSV. See samples/README.md.</span><input type="file" id="file" accept=".csv,.tsv,.txt,.xlsx,.xls,text/csv,text/plain" multiple class="hidden"></div>` : ctx.ui.empty('Only editors can upload files.')}
     <div id="pending" style="margin-top:14px"></div>
     <h3 style="margin-top:22px">Existing uploads</h3><p class="muted" style="margin-bottom:8px;font-size:13px">What the views are built from. Deleting a LinkedIn upload removes its rows; deleting an email upload removes the events it was the latest source for.</p><div id="list">${ctx.ui.spinner('Loading uploads')}</div>`);
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
    const waiting = q.filter(p => p.status !== 'done' && p.status !== 'uploading');
    box.innerHTML = `<div class="card">
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><b>${fmt(q.length)} file${q.length === 1 ? '' : 's'} ready</b>${Object.entries(by).map(([k, n]) => `<span class="tag">${esc(k)}: ${n}</span>`).join('')}
        <span style="margin-left:auto"></span><button class="btn primary" data-all ${waiting.filter(ready).length && !state.busy ? '' : 'disabled'}>${state.busy ? '<span class="spin"></span> Uploading' : `Upload all (${waiting.filter(ready).length})`}</button><button class="btn ghost tiny" data-clear>Clear list</button></div>
      ${(state.failed || []).length ? `<ul style="margin:8px 0 0;padding-left:18px;color:var(--bad);font-size:13px">${state.failed.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      <div class="tblwrap" style="margin-top:10px"><table><thead><tr><th class="l">File</th><th class="l">Goes to</th><th class="l">Campaign / window</th><th>Rows</th><th class="l">Checks</th><th class="l">Status</th><th></th></tr></thead><tbody>
      ${q.map(p => { const r = p.parsed; const email = p.channel === 'email';
        return `<tr data-id="${p.id}"><td class="l mono" style="max-width:260px;word-break:break-all">${esc(p.file)}</td>
          <td class="l">${ctx.ui.pill(email ? 'Email' : p.kind === 'performance' ? 'Ads · performance' : 'Ads · demographics', email ? 'p-med' : p.kind === 'performance' ? 'p-high' : 'p-low')}</td>
          <td class="l">${email ? `<input type="text" data-k="campaign" value="${esc(r.campaign)}" style="width:100%;min-width:200px"><div class="muted" style="font-size:11.5px">${esc(r.stats.from || '')} to ${esc(r.stats.to || '')} · ${fmt(r.stats.contacts)} contacts</div>`
            : p.kind === 'demographics' ? `<input type="date" data-k="start" value="${esc(r.period_start || '')}"> <input type="date" data-k="end" value="${esc(r.period_end || '')}">`
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
        const res = await ctx.api.post('uploads', { channel: p.channel, kind: p.kind, file_name: p.file, period_start, period_end, columns: r.columns, rows: chunk, notes: p.channel === 'email' ? r.campaign : undefined, upload_id: upload_id || undefined, final: i + CHUNK >= r.rows.length });
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
    drawPending(); await drawList();
  }
  async function drawList() {
    const list = body.querySelector('#list'); if (!list) return;
    try {
      const { uploads } = await ctx.api.get('uploads');
      if (!uploads || !uploads.length) { list.innerHTML = ctx.ui.empty('No uploads yet. Drop files above to light up the Ads and Email views.'); return; }
      list.innerHTML = ctx.ui.table({ cols: [
        { h: 'Tab', k: 'channel', left: true, f: u => ctx.ui.pill(u.channel === 'email' ? 'Email' : u.kind === 'performance' ? 'Ads · performance' : 'Ads · demographics', u.channel === 'email' ? 'p-med' : u.kind === 'performance' ? 'p-high' : 'p-low') },
        { h: 'Campaign / window', k: 'w', left: true, f: u => u.channel === 'email' ? `${esc(campaignLabel(u.notes || ''))}<br><span class="muted" style="font-size:11.5px">${u.period_start ? esc(ctx.fmt.rangeLabel(u.period_start, u.period_end)) : ''}</span>` : u.period_start ? esc(ctx.fmt.rangeLabel(u.period_start, u.period_end)) : '<span class="muted">per day</span>' },
        { h: 'Rows', k: 'row_count', f: u => fmt(u.row_count) },
        { h: 'File', k: 'file_name', left: true, f: u => `<span class="mono">${esc(u.file_name || '')}</span>` },
        { h: 'Uploaded by', k: 'uploaded_by', left: true, f: u => esc(u.uploaded_by || '') },
        { h: 'At', k: 'uploaded_at', left: true, f: u => esc(ctx.fmt.istDateTime(u.uploaded_at)) },
        { h: '', k: 'x', f: u => isEditor ? `<button class="btn tiny ghost" data-del="${esc(u.id)}" data-name="${esc(u.file_name || u.id)}">Delete</button>` : '' },
      ], rows: uploads.sort((a, b) => (a.uploaded_at < b.uploaded_at ? 1 : -1)) });
      list.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
        if (!confirm(`Delete "${b.dataset.name}" and its rows? This cannot be undone.`)) return;
        try { await ctx.api.del('uploads', { id: b.dataset.del }); ctx.toast('Upload deleted.'); await drawList(); } catch (e) { ctx.toast('Delete failed: ' + e.message, 'err'); }
      });
    } catch (e) { list.innerHTML = ctx.ui.empty('Uploads could not be loaded: ' + (e.message || e)); }
  }
}

// ---------------- generic setting tabs ----------------
const META = {
  accounts: { title: 'Accounts and designation bands', sub: 'The canonical target accounts, the LinkedIn company page names that map to them (aliases), and each account\'s own title convention for the MD, MD-1 and MD-2 bands. The generic LinkedIn title buckets used for the Job Title heat map are in the second table.' },
  regions: { title: 'Regions', sub: 'Country to region grouping for the geography heat map and Leads analytics. A country that is in no list shows as Other.' },
  icp_pool: { title: 'ICP pools', sub: 'Headcount per account, country and band (Apollo, August 2026). Penetration divides estimated people reached by these numbers.' },
  targets: { title: 'Targets', sub: 'Monthly targets and the frequency used to turn impressions into people. People reached = impressions divided by frequency (default 3.5).' },
  editors: { title: 'Editors', sub: 'Email addresses allowed to upload files and change settings. Everyone else at Lyzr can view.' },
};
function readable(key, value, ctx) {
  const { esc, fmt } = ctx.fmt;
  const T = ctx.ui.table;
  if (key === 'accounts') {
    const rows = Array.isArray(value) ? value : [];
    return T({ cols: [{ h: 'Account', k: 'name', left: true, f: a => `<b>${esc(a.name)}</b>` }, { h: 'Category', k: 'category', left: true, f: a => esc(a.category || '') }, { h: 'Owner', k: 'owner', left: true, f: a => esc(a.owner || '') }, { h: 'LinkedIn page aliases', k: 'aliases', left: true, f: a => esc((a.aliases || []).join(', ')) }, { h: 'MD', k: 'md', left: true, f: a => esc((a.bands || {}).md || '') }, { h: 'MD-1', k: 'md1', left: true, f: a => esc((a.bands || {}).md1 || '') }, { h: 'MD-2', k: 'md2', left: true, f: a => esc((a.bands || {}).md2 || '') }], rows });
  }
  if (key === 'bands') {
    const g = value && value.global ? value.global : value || {};
    return T({ cols: [{ h: 'Band', k: 'b', left: true, f: r => `<b>${esc(r.b)}</b>` }, { h: 'LinkedIn job titles', k: 't', left: true, f: r => esc(r.t) }], rows: [['MD', (g.MD || []).join(', ')], ['MD-1', (g.MD1 || []).join(', ')], ['MD-2', (g.MD2 || []).join(', ')], ['Director', g.split || 'Director split 50/50 MD-1 and MD-2']].map(([b, t]) => ({ b, t })) });
  }
  if (key === 'regions') {
    const map = value && value.regions ? value.regions : value || {};
    return T({ cols: [{ h: 'Region', k: 'r', left: true, f: r => `<b>${esc(r.r)}</b>` }, { h: 'Countries', k: 'c', left: true, f: r => esc(r.c) }], rows: Object.entries(map).map(([r, c]) => ({ r, c: (c || []).join(', ') })) });
  }
  if (key === 'icp_pool') {
    const rows = Array.isArray(value) ? value : [];
    return T({ cols: [{ h: 'Account', k: 'company', left: true }, { h: 'Country', k: 'country', left: true }, { h: 'MD', k: 'md', f: r => fmt(r.md) }, { h: 'MD-1', k: 'md1', f: r => fmt(r.md1) }, { h: 'MD-2', k: 'md2', f: r => fmt(r.md2) }, { h: 'All', k: 'all', f: r => fmt((+r.md || 0) + (+r.md1 || 0) + (+r.md2 || 0)) }, { h: 'Source', k: 'source', left: true, f: r => `<span class="muted">${esc(r.source || '')}</span>` }], rows });
  }
  if (key === 'targets') {
    const t = value || {};
    const labels = { leads_per_month: 'Leads a month', demo_mqls_per_month: 'Book a demo MQLs a month', frequency: 'Frequency (impressions per person)', monthly_budget: 'Monthly budget (USD)' };
    return T({ cols: [{ h: 'Target', k: 'k', left: true, f: r => esc(labels[r.k] || r.k) }, { h: 'Value', k: 'v', f: r => esc(String(r.v)) }], rows: Object.entries(t).map(([k, v]) => ({ k, v })) });
  }
  if (key === 'editors') { const list = Array.isArray(value) ? value : []; return list.length ? `<ul>${list.map(e => `<li>${esc(e)}</li>`).join('')}</ul>` : ctx.ui.empty('No editors set. On the server, the ADMIN list in the Pages Function applies.'); }
  return `<pre class="mono">${esc(JSON.stringify(value, null, 1))}</pre>`;
}
async function settingTab(body, ctx, isEditor, key) {
  const m = META[key];
  body.innerHTML = ctx.ui.section(m.title, m.sub, `<div id="view"></div>${key === 'accounts' ? '<h3 style="margin-top:22px">Generic LinkedIn title buckets (bands)</h3><div id="viewBands"></div>' : ''}<div id="edit" style="margin-top:18px"></div>`);
  body.querySelector('#view').innerHTML = readable(key, ctx.settings && ctx.settings[key], ctx);
  if (key === 'accounts') body.querySelector('#viewBands').innerHTML = readable('bands', ctx.settings && ctx.settings.bands, ctx);
  const editBox = body.querySelector('#edit');
  if (!isEditor) { editBox.innerHTML = '<p class="muted" style="font-size:13px">Read-only. Ask an editor to change these lists.</p>'; return; }
  const keys = key === 'accounts' ? ['accounts', 'bands'] : [key];
  editBox.innerHTML = keys.map(k => `<details style="margin-top:10px"><summary style="cursor:pointer;font-weight:600">Edit ${k.replace('_', ' ')} as JSON</summary>
    <textarea data-k="${k}" style="width:100%;min-height:220px;font-family:var(--mono);font-size:12.5px;margin-top:8px">${ctx.fmt.esc(JSON.stringify(ctx.settings && ctx.settings[k] != null ? ctx.settings[k] : (DEFAULTS[k] ?? null), null, 1))}</textarea>
    <div class="row" style="margin-top:8px"><button class="btn primary" data-save="${k}">Save</button><button class="btn ghost" data-reset="${k}">Reset to defaults</button><span class="muted" data-msg="${k}" style="font-size:13px"></span></div></details>`).join('');
  editBox.querySelectorAll('[data-save]').forEach(b => b.onclick = async () => {
    const k = b.dataset.save, ta = editBox.querySelector(`textarea[data-k="${k}"]`), msg = editBox.querySelector(`[data-msg="${k}"]`);
    let value; try { value = JSON.parse(ta.value); } catch (e) { msg.textContent = 'Not valid JSON: ' + e.message; return; }
    b.disabled = true; msg.textContent = 'Saving';
    try { await ctx.api.put('settings', { key: k, value }); ctx.settings = { ...(ctx.settings || {}), [k]: value }; msg.textContent = 'Saved.'; ctx.toast(`${k} saved.`); settingTab(body, ctx, isEditor, key); }
    catch (e) { msg.textContent = 'Save failed: ' + (e.message || e); b.disabled = false; }
  });
  editBox.querySelectorAll('[data-reset]').forEach(b => b.onclick = async () => {
    const k = b.dataset.reset, ta = editBox.querySelector(`textarea[data-k="${k}"]`), msg = editBox.querySelector(`[data-msg="${k}"]`);
    try {
      let value = DEFAULTS[k];
      if (SEED_FILE[k]) { const r = await fetch(new URL('../../seed/' + SEED_FILE[k], import.meta.url), { cache: 'no-store' }); if (!r.ok) throw new Error('seed file missing'); value = await r.json(); }
      ta.value = JSON.stringify(value, null, 1); msg.textContent = 'Defaults loaded into the editor. Press Save to apply them.';
    } catch (e) { msg.textContent = 'Could not load defaults: ' + e.message; }
  });
}

// ---------------- Connection ----------------
async function connectionTab(body, ctx) {
  const { esc } = ctx.fmt;
  body.innerHTML = ctx.ui.section('Connection', 'Whether the server can reach its database, HubSpot and Claude, and what to set when it cannot.', ctx.ui.spinner('Checking'));
  try { state.health = await ctx.api.get('health'); } catch (e) { state.health = { ok: false, error: e.message }; }
  const h = state.health || {};
  const row = (name, ok, hint) => `<tr><td class="l"><b>${esc(name)}</b></td><td class="l">${ctx.ui.pill(ok ? 'Connected' : 'Not connected', ok ? 'p-high' : 'p-low')}</td><td class="l">${ok ? '<span class="muted">OK</span>' : esc(hint)}</td></tr>`;
  body.innerHTML = ctx.ui.section('Connection', 'Whether the server can reach its database, HubSpot and Claude, and what to set when it cannot. Secrets are set on the Cloudflare Pages site <span class="mono">lyzr-work-os</span>.',
    `<div class="tblwrap"><table><thead><tr><th class="l">Service</th><th class="l">Status</th><th class="l">Fix</th></tr></thead><tbody>
    ${row('Database (Supabase, ca_* tables)', h.db, 'Set CA_SUPABASE_URL and CA_SUPABASE_KEY (service role key) on the Pages site, then run supabase/001_campaign_analytics.sql.')}
    ${row('HubSpot (read-only)', h.hubspot, 'Set HUBSPOT_ACCESS_TOKEN (private app token) on the Pages site.')}
    ${row('Claude (AI panels)', h.claude, 'Set ANTHROPIC_API_KEY on the Pages site. Until then the AI panels show "Generate" but return an error.')}
    ${row('Instantly API (daily campaign pull)', h.instantly, 'Set INSTANTLY_API_KEY on the Pages site (already used by the GSI Tracker weekly report).')}
    ${row('Daily schedule', h.cron, 'Set CA_CRON_SECRET on the Pages site and the same value as a GitHub Actions secret; .github/workflows/ca-instantly-sync.yml runs the pull every morning.')}
    </tbody></table></div>
    ${h.error ? `<p class="err" style="margin-top:10px">Health check failed: ${esc(h.error)}</p>` : ''}
    <div class="grid g2" style="margin-top:16px">
      <div class="card"><h3>Signed in as</h3><p>${esc((h.user && (h.user.name || h.user.email)) || (ctx.user && (ctx.user.name || ctx.user.email)) || 'unknown')}${h.user && h.user.email ? ` <span class="muted">(${esc(h.user.email)})</span>` : ''}</p><p class="muted" style="font-size:13px;margin-top:6px">Role: ${ctx.demo ? 'editor (demo mode)' : (h.user && h.user.isEditor ? 'editor' : 'viewer')}</p></div>
      <div class="card"><h3>Microsoft sign-in</h3><p style="font-size:13.5px">The Entra app "Lyzr MS UI" must list this page as a redirect URI (single-page application):</p><p class="mono" style="margin-top:6px;word-break:break-all">${REDIRECT_URI}</p><p class="muted" style="font-size:13px;margin-top:6px">Without it, sign-in fails with a redirect URI mismatch. Demo mode does not need it.</p></div>
    </div>
    <p class="muted" style="font-size:12.5px;margin-top:14px">API base: <span class="mono">/api/ca/</span> · ${ctx.demo ? 'Demo mode: the mock API answers every call and nothing is saved.' : 'Live mode.'}</p>`);
}

// ---------------- Email rules ----------------
async function emailRulesTab(body, ctx, isEditor) {
  const { esc } = ctx.fmt;
  const R = { fast_click_seconds: 180, gsi_page_counts_as_demo: true, link_rules: [], domains: {}, ...((ctx.settings && ctx.settings.email_rules) || {}) };
  const rulesText = (R.link_rules || []).map(r => `${r.match} => ${r.category}${r.label ? ' | ' + r.label : ''}`).join('\n');
  const domText = Object.entries(R.domains || {}).map(([d, c]) => `${d} = ${c}`).join('\n');
  body.innerHTML = ctx.ui.section('Email rules', 'How the Email view reads Instantly events. Changes apply to every campaign, week and account at once, including data already uploaded.', `
    <div class="grid g2">
      <div class="card"><h3>Fast clicks</h3><p class="muted" style="font-size:13px">A click this many seconds after the email was sent (same person, same step) is flagged as a likely security scanner. Flagged clicks stay visible but are left out of human clicks, Book a Demo and every rate.</p>
        <label class="field" style="margin-top:8px">Seconds <input type="number" min="0" max="86400" data-k="fast" value="${esc(R.fast_click_seconds)}" ${isEditor ? '' : 'disabled'} style="width:120px"></label></div>
      <div class="card"><h3>Book a Demo</h3><p class="muted" style="font-size:13px">The direct calendar link always counts. In the GSI sequences every "Book a demo" button points at the GSI/SI page, so a click there can count too (shown as "via GSI/SI page", always split out from direct).</p>
        <label style="display:flex;gap:8px;align-items:center;margin-top:8px"><input type="checkbox" data-k="gsi" ${R.gsi_page_counts_as_demo ? 'checked' : ''} ${isEditor ? '' : 'disabled'}> A GSI/SI page click counts as Book a Demo</label></div>
      <div class="card"><h3>Link types</h3><p class="muted" style="font-size:13px">Extra rules, checked before the built-in ones. One per line: <span class="mono">text or /regex/ =&gt; Category | Label</span>. Categories: Book a Demo, Webinar &amp; Events, Case Studies, Playbooks, Blogs, Product Pages, Assessments &amp; Tools, Analyst &amp; Recognition, Press &amp; News, GSI/SI Partner Page, Website, Other.</p>
        <textarea data-k="rules" style="width:100%;min-height:120px;font-family:var(--mono);font-size:12.5px;margin-top:8px" placeholder="/agentic-roadmap/ => Assessments & Tools | Assessment: Agentic Roadmap" ${isEditor ? '' : 'disabled'}>${esc(rulesText)}</textarea></div>
      <div class="card"><h3>Email domains</h3><p class="muted" style="font-size:13px">Which company an email domain belongs to, when the built-in list or the accounts list gets it wrong. One per line: <span class="mono">domain = Company</span>.</p>
        <textarea data-k="domains" style="width:100%;min-height:120px;font-family:var(--mono);font-size:12.5px;margin-top:8px" placeholder="atkearney.com = Kearney" ${isEditor ? '' : 'disabled'}>${esc(domText)}</textarea></div>
    </div>
    ${isEditor ? '<div class="row" style="margin-top:12px"><button class="btn primary" data-save>Save email rules</button><span class="muted" data-msg style="font-size:13px"></span></div>' : '<p class="muted" style="font-size:13px;margin-top:10px">Read-only. Ask an editor to change these.</p>'}`);
  const save = body.querySelector('[data-save]'); if (!save) return;
  save.onclick = async () => {
    const msg = body.querySelector('[data-msg]');
    const link_rules = body.querySelector('[data-k=rules]').value.split('\n').map(l => l.trim()).filter(Boolean).map(l => { const [m, rest = ''] = l.split('=>'); const [category, label] = rest.split('|').map(x => (x || '').trim()); return { match: (m || '').trim(), category, ...(label ? { label } : {}) }; }).filter(r => r.match && r.category);
    const domains = Object.fromEntries(body.querySelector('[data-k=domains]').value.split('\n').map(l => l.split('=').map(x => x.trim())).filter(([d, c]) => d && c));
    const value = { fast_click_seconds: Number(body.querySelector('[data-k=fast]').value) || 0, gsi_page_counts_as_demo: body.querySelector('[data-k=gsi]').checked, link_rules, domains };
    save.disabled = true; msg.textContent = 'Saving';
    try { await ctx.api.put('settings', { key: 'email_rules', value }); ctx.settings = { ...(ctx.settings || {}), email_rules: value }; msg.textContent = 'Saved. The Email view uses the new rules.'; ctx.toast('Email rules saved.'); }
    catch (e) { msg.textContent = 'Save failed: ' + (e.message || e); }
    save.disabled = false;
  };
}

// ---------------- GSI companies ----------------
async function gsiTab(body, ctx, isEditor) {
  const { esc, fmt } = ctx.fmt;
  const list = Array.isArray(ctx.settings && ctx.settings.gsi_companies) ? ctx.settings.gsi_companies : [];
  body.innerHTML = ctx.ui.section('GSI companies', `A HubSpot lead whose company matches any name here is a GSI lead: it is pulled on HubSpot refresh and tagged GSI in Leads analytics and HubSpot messaging. Matching is by whole words, so "EY" matches "EY GDS" but not "Keystone". ${fmt(list.length)} companies now.`, `
    <textarea data-k="list" style="width:100%;min-height:360px;font-family:var(--mono);font-size:12.5px" ${isEditor ? '' : 'disabled'}>${esc(list.join('\n'))}</textarea>
    <p class="muted" style="font-size:12.5px;margin-top:6px">One company per line. Paste your list over this one to replace it. After saving, press Refresh on HubSpot messaging so the pull uses the new list.</p>
    ${isEditor ? '<div class="row" style="margin-top:10px"><button class="btn primary" data-save>Save list</button><span class="muted" data-msg style="font-size:13px"></span></div>' : ''}`);
  const save = body.querySelector('[data-save]'); if (!save) return;
  save.onclick = async () => {
    const msg = body.querySelector('[data-msg]');
    const value = [...new Set(body.querySelector('[data-k=list]').value.split('\n').map(s => s.trim()).filter(Boolean))];
    if (!value.length) { msg.textContent = 'The list is empty.'; return; }
    save.disabled = true; msg.textContent = 'Saving';
    try { await ctx.api.put('settings', { key: 'gsi_companies', value }); ctx.settings = { ...(ctx.settings || {}), gsi_companies: value }; msg.textContent = `Saved ${value.length} companies.`; ctx.toast('GSI company list saved.'); }
    catch (e) { msg.textContent = 'Save failed: ' + (e.message || e); }
    save.disabled = false;
  };
}
