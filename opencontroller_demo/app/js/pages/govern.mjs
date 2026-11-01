import { pageHead, panel, table, btn, seg, select, toggle, search, tabs, regPill, pill, person, sourceLabel, kindLabel, assetLink, copyBtn, modal, sheet, field, input, textarea, radios, selectField, toast, esc, icon, empty, kv, sevPill, menu, closeOverlay } from '../ui.mjs';
import { S, live, asset, decide, registerExternal, findingsFor, skill, createSkill, newSkillVersion, makeLive, setMarketplace, publishSkill, deliverSkill, saveSkillSettings, can, kindOne } from '../store.mjs';
import { KINDS, ALL_SOURCES, PEOPLE } from '../data.mjs';
import { cloudIcon } from '../icons.mjs';
import { ago, int } from '../util.mjs';
import { track } from '../../../shared/session.mjs';
import { filterAssets } from './inventory.mjs';

// ---------------- approvals ----------------
function approvals({ v }) {
  const tab = v.tab || 'pending';
  const q = (v.q || '').toLowerCase();
  const pend = S.approvals.filter((a) => a.status === 'pending');
  const dec = S.approvals.filter((a) => a.status !== 'pending').sort((a, b) => (b.decidedAt || 0) - (a.decidedAt || 0));
  const list = (tab === 'pending' ? pend : dec).filter((ap) => { const a = asset(ap.assetId); const n = ap.assetName || (a && a.name) || ''; return !q || n.toLowerCase().includes(q) || ap.owner.includes(q); });
  const sel = new Set((v.sel || []).filter((id) => pend.some((p) => p.id === id)));
  const name = (ap) => { const a = asset(ap.assetId); return ap.removedAsset || !a ? `<span>${esc(ap.assetName || (a && a.name) || 'removed')}</span>` : assetLink(a); };
  const kind = (ap) => kindOne(ap.kind || (asset(ap.assetId) || {}).kind || '');
  const outcome = { approved: ['Approved', 'green'], rejected: ['Rejected', 'red'], withdrawn: ['Withdrawn', 'grey'] };
  const bulk = tab === 'pending' ? `<div class="toolbar bulk"><span class="muted">${sel.size ? `${sel.size} selected` : 'Tick requests, or open one.'}</span><span class="grow"></span>${btn('Approve selected', { act: 'approve-sel', perm: 'approve', disabled: !sel.size, kind: sel.size ? 'primary' : '' })}${btn('Reject selected', { act: 'reject-sel', perm: 'reject', disabled: !sel.size })}</div>` : '';
  const t = tab === 'pending'
    ? table({ cols: [{ label: `<input type="checkbox" data-act="sel-all" aria-label="Select all"${list.length && list.every((p) => sel.has(p.id)) ? ' checked' : ''}>`, w: '36px' }, { label: 'Asset' }, { label: 'Kind' }, { label: 'Owner' }, { label: 'Checks' }, { label: 'Requested' }, { label: '', cls: 'r' }], empty: 'Nothing is waiting. Register something in Shadow AI and it lands here.',
      rows: list.map((ap) => [`<input type="checkbox" data-act="sel" data-id="${ap.id}" aria-label="Select"${sel.has(ap.id) ? ' checked' : ''}>`, name(ap), esc(kind(ap)), person(ap.owner), /no findings|passed/i.test(ap.checks) ? pill(ap.checks, 'green') : pill(ap.checks, 'amber'), `<span class="muted">${esc(ap.requestedBy)}, ${ago(ap.requestedAt)}</span>`, btn('Review', { sm: true, act: 'review', data: { id: ap.id } })]) })
    : table({ cols: [{ label: 'Asset' }, { label: 'Kind' }, { label: 'Owner' }, { label: 'Requested' }, { label: 'Decided' }, { label: 'Outcome' }], empty: 'Nothing decided yet.',
      rows: list.map((ap) => [name(ap), esc(kind(ap)), person(ap.owner), `<span class="muted">${ago(ap.requestedAt)}</span>`, `<span class="muted">${esc(ap.decidedBy || '')}, ${ago(ap.decidedAt)}</span>`, pill(...outcome[ap.status]) + (ap.reason ? `<p class="muted small">${esc(ap.reason)}</p>` : '')]) });
  return pageHead({ title: 'Approvals', desc: 'Registration requests waiting for an administrator, and what was decided before. Approving one registers the asset; rejecting it leaves it shadow.' })
    + `<div class="toolbar">${tabs('tab', [['pending', 'Pending', pend.length], ['decided', 'Decided']], tab)}<span class="grow"></span>${search('q', v.q, 'Search assets or owners')}</div>` + bulk + t;
}

function review(id, ctx) {
  const ap = S.approvals.find((x) => x.id === id); const a = asset(ap.assetId);
  const fs = findingsFor(a.id);
  sheet({ title: a.name, sub: `Registration request · ${kindOne(a.kind)}`,
    body: kv([['Asset', assetLink(a)], ['Source', sourceLabel(a)], ['Requested by', `${esc(ap.requestedBy)}, ${ago(ap.requestedAt)}`], ['Owner', person(ap.owner)], ['Purpose', esc(ap.purpose)], ['Shared with', ap.shared === 'organization' ? 'Everyone in the organization' : ap.shared === 'people' ? 'People, named after approval' : 'Only its owner'], ['Spend, 30 days', a.spend30d ? `$${a.spend30d.toLocaleString('en-US', { minimumFractionDigits: 2 })}` : 'None']])
      + `<h4 class="sub-h">Checks</h4>` + (fs.length ? `<div class="rows">${fs.map((f) => `<div class="row">${sevPill(f.severity)}<span>${esc(f.policy.title)}</span></div>`).join('')}</div>` : '<p class="muted">No findings.</p>')
      + field('Reason (needed to reject)', textarea('reason', { placeholder: 'Goes to the requester and the audit log' })),
    foot: btn('Reject', { act: 'reject-one', data: { id }, perm: 'reject' }) + btn('Approve', { act: 'approve-one', data: { id }, perm: 'approve', kind: 'primary' }) });
}
function doDecide(ids, outcome, reason, ctx) {
  const n = decide(ids, outcome, reason);
  ctx.v.sel = [];
  toast(outcome === 'approved' ? `${n} approved: ${n === 1 ? 'it is' : 'they are'} in the Registry now.` : `${n} rejected: left shadow.`, { link: outcome === 'approved' ? ['Open Registry', '#/registry'] : ['Decided', '#/approvals?tab=decided'] });
  track('action', '/approvals', `${outcome} ${n}`);
}
function askReason(ids, ctx) {
  modal({ title: ids.length === 1 ? 'Reject this request?' : `Reject ${ids.length} requests?`, body: field('Reason', textarea('reason', { placeholder: 'Goes to the requester and the audit log' })), submit: 'Reject', danger: true,
    onSubmit: (d) => { if (!(d.reason || '').trim()) return 'Say why: the requester sees it.'; doDecide(ids, 'rejected', d.reason.trim(), ctx); } });
}

// ---------------- registry ----------------
function registry({ v }) {
  const all = live().filter((a) => a.registry === 'registered');
  const items = filterAssets({ ...v, registry: '' }, all);
  const view = v.view || 'table';
  const body = view === 'table'
    ? table({ cols: [{ label: 'Asset' }, { label: 'Kind' }, { label: 'Source' }, { label: 'Owner' }, { label: 'Purpose', w: '26%' }, { label: 'Approved' }, { label: 'Status' }], empty: 'Nothing registered matches.',
      rows: items.map((a) => [assetLink(a), esc(kindOne(a.kind)), sourceLabel(a), person(a.registration.owner), `<span class="clamp">${esc(a.blocked ? `Blocked by ${a.registration.approvedBy}: ${a.registration.purpose}` : a.registration.purpose)}</span>`, `<span class="muted">${ago(a.registration.approvedAt)}</span>`, a.blocked ? pill('Blocked', 'red') : a.status ? `<span class="status-txt">${esc(a.status)}</span>` : '<span class="muted">—</span>']) })
    : `<div class="cards-grid">${items.map((a) => `<a class="reg-card" href="#/inventory/${a.id}"><div class="rc-head"><b>${esc(a.name)}</b>${regPill('registered')}</div>
        <p class="rc-src">${cloudIcon(a.cloud, 14)} ${esc(a.source)} · ${esc(kindOne(a.kind))}</p>
        <p class="muted small">${a.blocked ? 'Blocked as of the last scan' : a.status ? `State: ${esc(a.status)}` : 'State not reported'}</p>
        <div class="rc-owner">${person(a.registration.owner)}<small class="muted">Owner · named when registered</small></div>
        <p class="small"><span class="muted">Shared with</span> ${a.registration.shared === 'organization' ? '<span class="t-amber">Everyone in the organization</span>' : 'Only its owner'}</p>
        <p class="small"><span class="muted">Purpose</span> ${esc(a.registration.purpose)}</p>
        <p class="rc-foot muted small">Approved ${ago(a.registration.approvedAt)} by ${esc(a.registration.approvedBy)}</p></a>`).join('') || '<p class="muted">Nothing registered matches.</p>'}</div>`;
  return pageHead({ title: 'Registry', desc: 'Approved AI assets: the agents, MCP servers, tools and models your organization runs on purpose, with an accountable owner each.', actions: btn('Register external agent', { icon: 'plus', act: 'ext', perm: 'registerExternal', kind: 'primary' }) })
    + `<div class="toolbar wrap">${search('q', v.q, 'Search name or ARN')}${select('kind', [['all', 'All'], ...KINDS.map(([k, p]) => [k, p])], v.kind || 'all', { label: 'Kind' })}${select('cloud', [['all', 'All'], ['microsoft', 'Microsoft'], ['gcp', 'Google Cloud'], ['aws', 'AWS'], ['anthropic', 'Anthropic'], ['external', 'External']], v.cloud || 'all', { label: 'Cloud' })}${select('source', [['all', 'All'], ...ALL_SOURCES.map((s) => [s, s])], v.source || 'all', { label: 'Source' })}<span class="grow"></span>${seg('view', [['table', 'Table', 'list'], ['cards', 'Cards', 'grid']], view)}</div>`
    + `<p class="muted small count-line">${int(items.length)} registered</p>` + body;
}

// ---------------- skills ----------------
const scanPill = (s) => (s === 'passed' ? pill('Passed', 'green') : s === 'flagged' ? pill('Flagged', 'amber') : pill('Not scanned', 'grey'));
function skills() {
  return pageHead({ title: 'Skills', desc: "The organization's skills, versioned and scanned with its guardrails before one goes live, then delivered to its agents.", actions: btn('New skill', { icon: 'plus', act: 'new-skill', perm: 'newSkill', kind: 'primary' }) })
    + table({ cols: [{ label: 'Skill', w: '38%' }, { label: 'Live' }, { label: 'Latest' }, { label: 'Latest scan' }, { label: 'Marketplace' }, { label: 'Updated' }],
      rows: S.skills.map((s) => { const last = s.versions[s.versions.length - 1]; return { attrs: `class="row-link" data-act="go" data-href="#/skills/${s.id}"`, cells: [`<a class="lnk" href="#/skills/${s.id}"><b>${esc(s.name)}</b></a><p class="muted small">${esc(s.description)}</p>`, s.live ? `<code>${s.live}</code>` : '<span class="muted">none</span>', `<code>${last.version}</code>${s.versions.length > 1 ? ` <span class="muted small">of ${s.versions.length}</span>` : ''}`, scanPill(last.scan), s.inMarketplace && s.live ? pill('Listed', 'blue') : '<span class="muted">—</span>', `<span class="muted">${ago(last.savedAt)}</span>`] }; }) });
}

function skillPage(ctx) {
  const s = skill(ctx.params[0]);
  if (!s) return empty('No such skill', 'It may have been removed.', btn('Skills', { href: '#/skills' }));
  const v = ctx.v; const t = v.t || 'versions';
  const head = `<a class="crumb-back" href="#/skills">${icon('back', 14)}Skills</a><div class="page-head-row"><div><h1>${esc(s.name)} ${s.live ? pill(`live ${s.live}`, 'green') : pill('not live', 'grey')}</h1><p class="desc">${esc(s.description)}</p></div>
    <div class="page-actions">${toggle('mk', s.inMarketplace, { label: 'In the marketplace', act: 'mk', perm: 'publish', disabled: !s.live, title: !s.live ? 'Make a version live first' : '' })}${btn('New version', { icon: 'plus', act: 'new-version', perm: 'newVersion' })}</div></div>`;
  let body = '';
  const verSel = v.ver || s.live || s.versions[s.versions.length - 1].version;
  const ver = s.versions.find((x) => x.version === verSel) || s.versions[0];
  if (t === 'versions') {
    body = table({ cols: [{ label: 'Version' }, { label: 'Notes' }, { label: 'Saved' }, { label: 'Size' }, { label: 'Scan' }, { label: '', cls: 'r' }],
      rows: s.versions.slice().reverse().map((x) => [`<code>${x.version}</code>${x.version === s.live ? ' ' + pill('Live', 'green') : ''}`, esc(x.notes || ''), `<span class="muted">${esc(x.savedBy)}, ${ago(x.savedAt)}</span>`, `${(x.size / 1024).toFixed(1)} KB`, `<button type="button" class="pill-btn" data-act="set" data-key="t" data-val="&quot;scan&quot;">${scanPill(x.scan)}</button>`,
        menu(`v-${x.version}`, '', [{ label: 'Make live', act: 'make-live', data: { v: x.version }, perm: 'publish', disabled: x.version === s.live }, { label: 'Download', act: 'dl', data: { v: x.version } }, { label: 'See the files', act: 'files', data: { v: x.version } }], { icon: 'more', noCaret: true, sm: true, right: true, aria: `More for ${x.version}` })]) });
  }
  if (t === 'files') {
    const cmp = v.cmp && v.cmp !== 'none' ? s.versions.find((x) => x.version === v.cmp) : null;
    const fname = v.file || ver.files[0][0];
    const file = ver.files.find((f) => f[0] === fname) || ver.files[0];
    const other = cmp && (cmp.files.find((f) => f[0] === file[0]) || ['', '']);
    const lines = file[1].split('\n');
    const otherLines = other ? other[1].split('\n') : null;
    body = `<div class="toolbar">${select('ver', s.versions.map((x) => [x.version, `${x.version}${x.version === s.live ? ' · live' : ''}`]), ver.version, { label: 'Version' })}${select('cmp', [['none', 'Nothing'], ...s.versions.filter((x) => x.version !== ver.version).map((x) => [x.version, x.version])], v.cmp || 'none', { label: 'Compare with' })}</div>
      <div class="files"><div class="file-list">${ver.files.map((f) => `<button type="button" class="${f[0] === file[0] ? 'on' : ''}" data-act="set" data-key="file" data-val="&quot;${esc(f[0])}&quot;">${icon('file', 14)}${esc(f[0])}</button>`).join('')}</div>
      <pre class="code lines">${lines.map((l, i) => { const changed = otherLines && otherLines[i] !== l; return `<span class="${changed ? 'diff-add' : ''}"><i>${i + 1}</i>${esc(l) || ' '}</span>`; }).join('')}</pre></div>`;
  }
  if (t === 'scan') {
    body = `<div class="toolbar">${select('ver', s.versions.map((x) => [x.version, x.version]), ver.version, { label: 'Version' })}</div>` + panel({ body: ver.scan === 'passed'
      ? `<p>${scanPill('passed')} scanned ${ago(ver.savedAt)} · Scanned with ${esc(S.skillSettings.scanWith.join(', ') || 'nothing')}. The guardrails found nothing.</p>`
      : ver.scan === 'flagged' ? `<p>${scanPill('flagged')} scanned ${ago(ver.savedAt)} · Scanned with ${esc(S.skillSettings.scanWith.join(', '))}.</p><ul class="findings-list">${(ver.findings || []).map((f) => `<li>${icon('alert', 14)}${esc(f)}</li>`).join('')}</ul>${ver.override ? `<p class="muted">Overridden by ${esc(ver.override.by)}: “${esc(ver.override.reason)}”</p>` : `<p class="muted">A flagged version goes live only when an administrator overrides its scan, saying why.</p>${btn('Override, saying why', { act: 'override', data: { v: ver.version }, perm: 'override' })}`}`
      : `<p>${scanPill('none')} No guardrails were chosen in Skills settings when this version was saved.</p>` });
  }
  if (t === 'delivery') {
    const where = v.where || 'none';
    const agents = live().filter((a) => a.kind === 'agent' && (v.agWhere === 'anthropic' ? a.cloud === 'anthropic' || a.cloud === 'external' : v.agWhere === 'microsoft' ? a.source === 'Azure AI Foundry' : false)).slice(0, 12);
    body = panel({ title: 'Publications', desc: "The skill put in a provider's own skills, so its agents can find it. Each holds the live version, and is given every version made live after.",
      right: `<div class="btn-row">${select('where', [['none', 'Choose where'], ['Claude (Lyzr Org)', 'Claude (Lyzr Org)'], ['Azure AI Foundry (lyzr-foundry)', 'Azure AI Foundry (lyzr-foundry)'], ['Bedrock AgentCore (studio-experiment)', 'Bedrock AgentCore (studio-experiment)']], where, { aria: 'Where' })}${btn(s.live ? `Publish ${s.live}` : 'Publish', { act: 'publish', perm: 'publish', disabled: !s.live || where === 'none', kind: 'primary' })}</div>`,
      body: s.publications.length ? `<div class="rows">${s.publications.map((p) => `<div class="row"><b>${esc(p.where)}</b><code>${p.version}</code><span class="grow"></span><span class="muted">${ago(p.at)}</span></div>`).join('')}</div>` : '<p class="muted">Not published anywhere.</p>' })
      + panel({ title: 'Agents', desc: "Give the skill to a provider's agents one by one; turn it off to take it away. Agents get the live version.", right: select('agWhere', [['none', 'Choose where'], ['anthropic', 'Claude Platform'], ['microsoft', 'Azure AI Foundry']], v.agWhere || 'none', { label: 'Agents in' }),
        body: agents.length ? `<div class="rows">${agents.map((a) => `<div class="row">${assetLink(a)}<span class="grow"></span>${toggle('ag', !!s.agents[a.id], { act: 'deliver', data: { id: a.id }, perm: 'publish', disabled: !s.live, aria: `Give to ${a.name}` })}</div>`).join('')}</div>` : '<p class="muted">Choose where to list its agents.</p>' });
  }
  if (t === 'activity') {
    body = table({ cols: [{ label: 'When' }, { label: 'What' }, { label: 'Who' }, { label: 'Detail' }], rows: s.activity.slice().sort((a, b) => b.when - a.when).map((x) => [`<span class="muted">${ago(x.when)}</span>`, `<code>${esc(x.what)}</code>`, esc(x.who), esc(x.detail)]) });
  }
  return head + tabs('t', [['versions', 'Versions'], ['files', 'Files'], ['scan', 'Scan'], ['delivery', 'Delivery'], ['activity', 'Activity']], t) + body;
}

function marketplace() {
  const st = S.skillSettings;
  const host = location.host || 'opencontroller.example';
  const listed = S.skills.filter((s) => s.inMarketplace && s.live && s.versions.find((v) => v.version === s.live).scan !== 'flagged');
  const url = `https://${host}/marketplace/claude-code.git`;
  const managed = { enabledPlugins: Object.fromEntries(S.skills.filter((s) => s.live).map((s) => [`${s.name}@${st.name}`, listed.includes(s)])), extraKnownMarketplaces: { [st.name]: { source: { source: 'git', url } } }, ...(st.strict ? { strictKnownMarketplaces: [st.name] } : {}) };
  const cmd = (c) => `<div class="cmd"><code>${esc(c)}</code>${copyBtn(c)}</div>`;
  return pageHead({ title: 'Skills marketplace', desc: "The organization's skills for coding agents: Claude Code adds the marketplace and installs each skill as a plugin, at its live version." })
    + panel({ body: kv([['Status', st.serve ? pill('On', 'green') : pill('Off', 'grey')], ['Name', `<code>${esc(st.name)}</code>`], ['Clone URL', `<code>${esc(url)}</code>${copyBtn(url)}`]]) })
    + panel({ title: 'Add it to Claude Code', body: cmd(`/plugin marketplace add ${url}`) + cmd(`/plugin install ${(listed[0] || { name: 'api-changelog' }).name}@${st.name}`) })
    + panel({ title: 'Managed settings', desc: 'Push this to every developer so the marketplace and its plugins are on by default.', right: btn('Download', { icon: 'download', act: 'dl-managed' }), body: `<pre class="code">${esc(JSON.stringify(managed, null, 2))}</pre>` })
    + panel({ title: 'Plugins', desc: 'Only skills whose live version passed its scan.', body: listed.length ? `<div class="rows">${listed.map((s) => `<a class="row" href="#/skills/${s.id}"><b>${esc(s.name)}</b><code>${s.live}</code><span class="muted grow">${esc(s.description)}</span></a>`).join('')}</div>` : '<p class="muted">No skill is listed yet.</p>' });
}

function skillSettings() {
  const st = S.skillSettings;
  const gs = S.guardrails;
  return pageHead({ title: 'Skills settings', desc: 'What every skill version is scanned with before it can go live, and how the marketplace is served.' })
    + `<form data-form="skills-settings">` + panel({ title: 'Scan with', desc: 'A version a guardrail flags goes live only when an administrator overrides its scan, saying why. With none chosen, versions are not scanned.',
      body: `<div class="checks">${gs.map((g) => `<label class="check"><input type="checkbox" name="g:${esc(g.name)}"${st.scanWith.includes(g.name) ? ' checked' : ''}${can('skillsSettings') ? '' : ' disabled'}><span><b>${esc(g.name)}</b><small>${g.syncedToGateway ? 'For the gateway and the engine' : 'For the engine'}</small></span></label>`).join('')}</div>` })
    + panel({ title: 'Marketplace', body: `<div class="form-grid">${toggleRow('serve', st.serve, 'Serve the marketplace', 'While off, its addresses answer not found.')}
        <label class="field"><span class="field-label">Name</span><input name="name" value="${esc(st.name)}" pattern="[a-z0-9-]+"${can('skillsSettings') ? '' : ' disabled'}><span class="field-hint">Lowercase letters, digits and hyphens.</span></label>
        <label class="field"><span class="field-label">Owner</span><input name="owner" value="${esc(st.owner)}"${can('skillsSettings') ? '' : ' disabled'}></label>
        ${toggleRow('strict', st.strict, 'Only this marketplace', 'Sets strictKnownMarketplaces, so developers cannot add others.')}</div>
        <div class="btn-row">${btn('Save', { submit: true, perm: 'skillsSettings', kind: 'primary' })}<span class="muted small">Last saved by ${esc(st.savedBy)} ${ago(st.savedAt)}</span></div>` }) + `</form>`;
}
const toggleRow = (name, on, label, hint) => `<label class="toggle-row"><span class="switch${can('skillsSettings') ? '' : ' is-disabled'}"><input type="checkbox" name="${name}"${on ? ' checked' : ''}${can('skillsSettings') ? '' : ' disabled'} role="switch"><span class="track"><span class="thumb"></span></span></span><span><b>${esc(label)}</b><small class="muted">${esc(hint)}</small></span></label>`;

function download(name, text, type = 'text/plain') { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }

export const ROUTES = [
  { path: '/approvals', render: approvals, init: () => ({ tab: 'pending', sel: [] }), actions: {
    go: (el) => { location.hash = el.dataset.href; },
    sel: (el, ctx) => { const s = new Set(ctx.v.sel || []); el.checked ? s.add(el.dataset.id) : s.delete(el.dataset.id); ctx.v.sel = [...s]; ctx.render(); },
    'sel-all': (el, ctx) => { ctx.v.sel = el.checked ? S.approvals.filter((a) => a.status === 'pending').map((a) => a.id) : []; ctx.render(); },
    review: (el, ctx) => review(el.dataset.id, ctx),
    'approve-one': (el, ctx) => { closeOverlay(); doDecide([el.dataset.id], 'approved', null, ctx); },
    'reject-one': (el, ctx) => { const r = (document.querySelector('.sheet textarea[name=reason]') || {}).value || ''; if (!r.trim()) { toast('Write a reason first: the requester sees it.', { tone: 'err' }); return; } closeOverlay(); doDecide([el.dataset.id], 'rejected', r.trim(), ctx); },
    'approve-sel': (el, ctx) => doDecide(ctx.v.sel, 'approved', null, ctx),
    'reject-sel': (el, ctx) => askReason(ctx.v.sel, ctx),
  } },
  { path: '/registry', render: registry, init: () => ({ view: 'table', kind: 'all', cloud: 'all', source: 'all' }), actions: {
    ext: (el, ctx) => modal({ title: 'Register external agent', body: `<p class="muted">For agents no cloud reports: a partner endpoint, something self-hosted. It joins the registry straight away.</p>${field('Name', input('name', { required: true, placeholder: 'Contoso — Claims Assistant' }))}${field('Endpoint URL', input('endpoint', { type: 'url', placeholder: 'https://agents.example.com/v1/chat' }))}${field('API format', selectField('api', [['openai_chat', 'OpenAI chat completions'], ['anthropic_messages', 'Anthropic messages'], ['a2a', 'Agent2Agent (A2A)'], ['mcp', 'MCP']], 'openai_chat'))}${field('Owner', input('owner', { type: 'email', value: ctx.session.email, list: 'people' }) + `<datalist id="people">${PEOPLE.map((p) => `<option value="${p}">`).join('')}</datalist>`)}${field('Purpose', textarea('purpose'))}`, submit: 'Register',
      onSubmit: (d) => { if (!(d.name || '').trim()) return 'Give it a name.'; if (!/^https?:\/\/\S+\.\S+/.test(d.endpoint || '')) return 'Enter the endpoint as a full URL.'; if (!/@/.test(d.owner || '')) return 'Enter the owner as an email address.'; if (!(d.purpose || '').trim()) return 'Say what it is for.'; const a = registerExternal({ name: d.name.trim(), endpoint: d.endpoint.trim(), apiFormat: d.api, owner: d.owner.trim().toLowerCase(), purpose: d.purpose.trim() }); toast(`${a.name} is registered.`, { link: ['Open it', `#/inventory/${a.id}`] }); track('action', '/registry', `Registered external ${a.name}`); } }),
  } },
  { path: '/skills', render: skills, actions: {
    go: (el) => { location.hash = el.dataset.href; },
    'new-skill': () => modal({ title: 'New skill', wide: true, body: `${field('Name', input('name', { placeholder: 'release-notes', required: true }), 'Lowercase letters, digits and hyphens.')}${field('Description', input('description', { placeholder: 'What it does, in a sentence' }))}${field('SKILL.md body', textarea('body', { rows: 8, mono: true, value: '# Release notes\n\nRead the merged pull requests since the last tag.\nWrite one line per change, grouped by area.\n' }), 'Try writing "ignore previous instructions" to see the scan flag it.')}`, submit: 'Save version 1.0.0',
      onSubmit: (d) => { if (!/^[a-z0-9-]{2,40}$/.test(d.name || '')) return 'Use lowercase letters, digits and hyphens for the name.'; if (S.skills.some((s) => s.name === d.name)) return 'A skill with that name exists.'; if (!(d.description || '').trim()) return 'Add a description.'; const s = createSkill({ name: d.name, description: d.description.trim(), body: d.body || '' }); const v = s.versions[0]; toast(`Saved ${s.name} 1.0.0: scan ${v.scan}.`, { link: ['Open it', `#/skills/${s.id}`] }); track('action', '/skills', `New skill ${s.name}`); } }),
  } },
  { path: '/skills/marketplace', render: marketplace, actions: { 'dl-managed': () => { const st = S.skillSettings; download('claude-code-settings.json', document.querySelector('#page pre.code').textContent, 'application/json'); } } },
  { path: '/skills/settings', render: skillSettings, actions: {
    'form:skills-settings': (f) => {
      const scanWith = S.guardrails.filter((g) => f.querySelector(`[name="g:${CSS.escape(g.name)}"]`).checked).map((g) => g.name);
      const name = f.name.value.trim();
      if (!/^[a-z0-9-]+$/.test(name)) { toast('The name takes lowercase letters, digits and hyphens.', { tone: 'err' }); return; }
      saveSkillSettings({ scanWith, name, owner: f.owner.value.trim(), serve: f.serve.checked, strict: f.strict.checked });
      toast('Saved.'); track('action', '/skills/settings', 'Saved skills settings');
    },
  } },
  { path: /^\/skills\/(sk_[0-9a-z]+)$/, render: skillPage, init: (r) => ({ t: r.query.tab || 'versions' }), actions: {
    mk: (el, ctx) => { setMarketplace(ctx.params[0], el.checked); toast(el.checked ? 'Listed in the marketplace.' : 'Taken out of the marketplace.'); },
    'make-live': (el, ctx) => { const s = skill(ctx.params[0]); const ok = makeLive(s.id, el.dataset.v); if (ok === false) { toast('That version is flagged: override its scan first.', { tone: 'err', link: ['Scan', `#/skills/${s.id}?tab=scan`] }); return; } toast(`${el.dataset.v} is live.`); track('action', ctx.route.path, `Made ${s.name} ${el.dataset.v} live`); },
    dl: (el, ctx) => { const s = skill(ctx.params[0]); const v = s.versions.find((x) => x.version === el.dataset.v); download(`${s.name}-${v.version}-SKILL.md`, v.files[0][1], 'text/markdown'); },
    files: (el, ctx) => { ctx.v.ver = el.dataset.v; ctx.set('t', 'files'); },
    override: (el, ctx) => modal({ title: `Override the scan of ${el.dataset.v}?`, body: field('Why it is safe', textarea('reason', { placeholder: 'Written next to the version and in the activity' })), submit: 'Override and make live', danger: true, onSubmit: (d) => { if (!(d.reason || '').trim()) return 'Say why.'; makeLive(ctx.params[0], el.dataset.v, d.reason.trim()); toast(`${el.dataset.v} is live, with its scan overridden.`); } }),
    'new-version': (el, ctx) => { const s = skill(ctx.params[0]); const last = s.versions[s.versions.length - 1]; modal({ title: `New version of ${s.name}`, wide: true, body: `${field('Notes', input('notes', { placeholder: 'What changed' }))}${field('SKILL.md', textarea('body', { rows: 10, mono: true, value: last.files[0][1] }))}`, submit: 'Save version', onSubmit: (d) => { if (!(d.notes || '').trim()) return 'Say what changed.'; const v = newSkillVersion(s.id, { notes: d.notes.trim(), body: d.body }); toast(`Saved ${v}: scan ${s.versions[s.versions.length - 1].scan}.`); track('action', ctx.route.path, `New version ${s.name} ${v}`); } }); },
    publish: (el, ctx) => { publishSkill(ctx.params[0], ctx.v.where); toast(`Published to ${ctx.v.where}.`); },
    deliver: (el, ctx) => { deliverSkill(ctx.params[0], el.dataset.id, el.checked); toast(el.checked ? 'Given to the agent.' : 'Taken away from the agent.'); },
  } },
];
