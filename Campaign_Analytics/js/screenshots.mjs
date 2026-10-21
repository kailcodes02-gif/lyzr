// Screenshot reader: a drop zone, file picker and paste (Ctrl or Cmd + V) for images. Each image is shrunk in a
// canvas to 1600 px on the long edge (JPEG, quality 0.85), sent to POST /api/ca/screenshots, read by Claude
// Sonnet 5 and kept as a `screen:` document. The leads it read join the Lead analytics page with source
// 'screenshot'; the metrics and tables are listed there too.
//   const s = await mountScreenshots(el, ctx, { onDone, isEditor })   s.destroy() removes the paste listener.
//   screenCard(ctx, screen, { canDelete }) renders one reading; wireScreenDeletes(root, ctx, onDone) wires its Delete.
import { clearMemo } from './compare.mjs';

export const MAX_EDGE = 1600;
export const JPEG_QUALITY = 0.85;
export const KIND_LABEL = { leads: 'Lead list', campaign_metrics: 'Campaign numbers', lead_form_metrics: 'Lead form numbers', demographics: 'Audience breakdown', other: 'Other' };
const STATE = { queue: [] };

/** Long edge to MAX_EDGE at most. Pure, tested. */
export function fitSize(w, h, max = MAX_EDGE) { const k = Math.min(1, max / Math.max(w || 1, h || 1)); return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) }; }

/** File or Blob -> { media_type:'image/jpeg', data:<base64>, w, h, bytes }. */
export async function shrinkImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('This file is not an image the browser can open')); i.src = url; });
    const { w, h } = fitSize(img.naturalWidth, img.naturalHeight);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.drawImage(img, 0, 0, w, h);
    const dataUrl = c.toDataURL('image/jpeg', JPEG_QUALITY);
    const data = dataUrl.slice(dataUrl.indexOf(',') + 1);
    return { media_type: 'image/jpeg', data, w, h, bytes: Math.floor(data.length * 3 / 4) };
  } finally { URL.revokeObjectURL(url); }
}

export function screenCard(ctx, s, { canDelete = false, open = false } = {}) {
  const { esc, fmt, istDateTime } = ctx.fmt;
  const leads = s.leads || [];
  const metrics = s.metrics || [];
  const leadsN = s.leads_count != null ? s.leads_count : leads.length;
  const period = s.period && (s.period.from || s.period.to) ? `${esc(s.period.from || '?')} to ${esc(s.period.to || '?')}` : 'no dates shown';
  const tbl = (cols, rows) => `<div class="tblwrap" style="margin-top:8px"><table><thead><tr>${cols.map(c => `<th class="l">${esc(c)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(v => `<td class="l">${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  return `<details class="card" style="margin-top:10px" ${open ? 'open' : ''}><summary style="cursor:pointer;display:flex;gap:8px;align-items:center;flex-wrap:wrap"><b>${esc(s.title || 'Screenshot')}</b>${ctx.ui.pill(KIND_LABEL[s.kind] || 'Other', s.kind === 'leads' ? 'p-high' : 'p-med')}<span class="muted" style="font-size:12.5px">${esc(s.file_name || '')} · ${esc(istDateTime(s.uploaded_at))} · ${fmt(leadsN)} lead${leadsN === 1 ? '' : 's'} · ${fmt(metrics.length)} number${metrics.length === 1 ? '' : 's'} · ${period}</span>${canDelete ? `<span style="margin-left:auto"></span><button class="btn tiny ghost" data-delscreen="${esc(s.id)}" data-name="${esc(s.file_name || s.title || s.id)}">Delete</button>` : ''}</summary>
    ${s.summary ? `<p style="margin:10px 0 0">${esc(s.summary)}</p>` : ''}
    ${leads.length ? tbl(['Name', 'Email', 'Company', 'Title', 'Country', 'Campaign', 'Form', 'Date'], leads.slice(0, 100).map(l => [`${l.first_name || ''} ${l.last_name || ''}`.trim(), l.email, l.company, l.title, l.country, l.campaign, l.form, l.submitted_at])) : ''}
    ${metrics.length ? tbl(['Campaign', 'Metric', 'Value', 'Unit', 'Period'], metrics.slice(0, 200).map(m => [m.campaign || 'account total', m.metric, typeof m.value === 'number' ? fmt(m.value, Number.isInteger(m.value) ? 0 : 2) : m.value, m.unit, m.period])) : ''}
    ${(s.tables || []).map(t => `<div class="ui-label" style="margin-top:12px">${esc(t.title || 'Table')}</div>${tbl(t.columns || [], (t.rows || []).slice(0, 100))}`).join('')}
    ${s.notes ? `<p class="muted" style="font-size:12.5px;margin-top:8px">Notes: ${esc(s.notes)}</p>` : ''}
  </details>`;
}

export function wireScreenDeletes(root, ctx, onDone) {
  root.querySelectorAll('[data-delscreen]').forEach(b => b.onclick = async e => {
    e.preventDefault(); e.stopPropagation();
    if (!confirm(`Delete what was read from "${b.dataset.name}"? Its leads and numbers leave the dashboard.`)) return;
    b.disabled = true;
    try { await ctx.api.del('li-leads', { id: b.dataset.delscreen }); clearMemo(); ctx.toast('Screenshot reading deleted.'); if (onDone) onDone(b.dataset.delscreen); }
    catch (err) { b.disabled = false; ctx.toast('Could not delete: ' + (err.message || err), 'err'); }
  });
}

export async function mountScreenshots(el, ctx, { onDone, isEditor = false, showList = true } = {}) {
  const { esc } = ctx.fmt;
  el.innerHTML = `<div class="drop" data-sdrop tabindex="0">Drop screenshots here, click to choose, or paste one with Ctrl or Cmd + V.<br><span class="muted" style="font-size:12.5px">Lead lists, lead gen form numbers, Campaign Manager tables, HubSpot views, spreadsheets. Claude Sonnet reads each image once: every lead row, every number and every table it can see. Nothing is guessed; what is not visible stays empty.</span><input type="file" data-sfile accept="image/png,image/jpeg,image/webp,image/gif" multiple class="hidden"></div>
    <div class="row" style="margin-top:8px;align-items:center;gap:8px"><span class="ui-label">What is it</span><input type="text" data-shint placeholder="Optional, e.g. Lead gen form leads for the Playbooks ad set, Sept" style="flex:1;min-width:220px"></div>
    <div data-squeue style="margin-top:10px"></div>
    ${showList ? '<details style="margin-top:12px"><summary class="ui-label" style="cursor:pointer">Screenshots read so far</summary><div data-slist style="margin-top:8px"></div></details>' : ''}`;
  const drop = el.querySelector('[data-sdrop]'), input = el.querySelector('[data-sfile]'), hint = el.querySelector('[data-shint]');
  drop.onclick = () => input.click();
  drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); add([...e.dataTransfer.files]); };
  input.onchange = () => { add([...input.files]); input.value = ''; };
  // Paste works anywhere on the page while this box is on screen (not while typing in another field).
  const onPaste = e => {
    if (!el.isConnected || el.offsetParent === null) return;
    const t = e.target; if (t && t !== hint && /^(INPUT|TEXTAREA)$/.test(t.tagName)) return;
    const files = [...((e.clipboardData && e.clipboardData.items) || [])].filter(i => i.kind === 'file' && /^image\//.test(i.type)).map((i, n) => { const f = i.getAsFile(); return f ? new File([f], `pasted-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}${n ? '-' + n : ''}.png`, { type: f.type }) : null; }).filter(Boolean);
    if (files.length) { e.preventDefault(); add(files); }
  };
  document.addEventListener('paste', onPaste);

  function drawQueue() {
    const box = el.querySelector('[data-squeue]'); if (!box) return;
    box.innerHTML = STATE.queue.map(q => q.status === 'done' && q.result
      ? screenCard(ctx, q.result, { canDelete: isEditor, open: true })
      : `<div class="card" style="margin-top:8px;display:flex;gap:10px;align-items:center"><span class="mono" style="font-size:12.5px">${esc(q.name)}</span><span style="font-size:12.5px">${q.status === 'error' ? `<span class="down">${esc(q.msg)}</span>` : `<span class="spin"></span> ${esc(q.msg)}`}</span>${q.status === 'error' ? `<button class="btn tiny ghost" data-sx="${q.qid}" style="margin-left:auto">Dismiss</button>` : ''}</div>`).join('');
    box.querySelectorAll('[data-sx]').forEach(b => b.onclick = () => { STATE.queue = STATE.queue.filter(q => q.qid !== b.dataset.sx); drawQueue(); });
    wireScreenDeletes(box, ctx, id => { STATE.queue = STATE.queue.filter(q => !(q.result && q.result.id === id)); refresh(); });
  }
  let busy = false;
  async function add(files) {
    const imgs = files.filter(f => /^image\//.test(f.type) || /\.(png|jpe?g|webp|gif)$/i.test(f.name));
    if (imgs.length < files.length) ctx.toast(`${files.length - imgs.length} file${files.length - imgs.length === 1 ? ' is' : 's are'} not an image. Lead CSV or Excel files go in the file upload box.`, 'err');
    for (const f of imgs) STATE.queue.unshift({ qid: Math.random().toString(36).slice(2), file: f, name: f.name, status: 'waiting', msg: 'waiting', hint: hint.value.trim() });
    drawQueue();
    if (busy) return; busy = true;
    let ok = 0;
    for (let q; (q = STATE.queue.find(x => x.status === 'waiting'));) {
      try {
        q.status = 'working'; q.msg = 'shrinking the image'; drawQueue();
        const img = await shrinkImage(q.file);
        if (img.bytes > 5 * 1024 * 1024) throw new Error('Still over 5 MB after shrinking. Crop it and try again.');
        q.msg = 'Claude is reading it (about 20 to 60 seconds)'; drawQueue();
        const res = await ctx.api.post('screenshots', { file_name: q.name, media_type: img.media_type, data: img.data, hint: q.hint || undefined });
        q.status = 'done'; q.result = res; q.file = null; ok++;
      } catch (e) { q.status = 'error'; q.msg = 'Failed: ' + (e.message || e); q.file = null; }
      drawQueue();
    }
    busy = false;
    if (ok) { clearMemo(); ctx.toast(`${ok} screenshot${ok === 1 ? '' : 's'} read.`); refresh(); }
  }
  async function drawList() {
    const box = el.querySelector('[data-slist]'); if (!box) return;
    try {
      const { screens } = await ctx.api.get('li-leads');
      box.innerHTML = (screens || []).length ? screens.map(s => screenCard(ctx, s, { canDelete: isEditor })).join('') : '<p class="muted" style="font-size:13px">Nothing read yet.</p>';
      wireScreenDeletes(box, ctx, id => { STATE.queue = STATE.queue.filter(q => !(q.result && q.result.id === id)); refresh(); });
    } catch (e) { box.innerHTML = ctx.ui.empty('Screenshots could not be loaded: ' + (e.message || e)); }
  }
  function refresh() { drawQueue(); drawList(); if (onDone) onDone(); }
  drawQueue();
  if (showList) await drawList();
  return { destroy: () => document.removeEventListener('paste', onPaste) };
}
