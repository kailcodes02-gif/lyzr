import { pageHead, statCards, panel, table, btn, menu, seg, select, toggle, search, pager, regPill, sevPill, sevDot, pill, kv, tabs, person, sourceLabel, kindLabel, assetLink, copyBtn, modal, field, input, textarea, radios, toast, esc, icon, empty, avatar } from '../ui.mjs';
import { S, live, asset, uses, usedBy, registryStats, findings, findingsFor, shadowSpend, requestRegistration, revoke, assetAction, can, why, kindOne, governed } from '../store.mjs';
import { KINDS, KIND_PLURAL, ALL_SOURCES, PEOPLE } from '../data.mjs';
import { KIND_ICON, cloudIcon, CLOUD_NAME } from '../icons.mjs';
import { money, int, pct, ago, stamp, esc as e2 } from '../util.mjs';
import { track } from '../../../shared/session.mjs';

const PER = 50;
const CLOUDS = [['all', 'All clouds'], ['microsoft', 'Microsoft'], ['gcp', 'Google Cloud'], ['aws', 'AWS'], ['databricks', 'Databricks'], ['anthropic', 'Anthropic'], ['snowflake', 'Snowflake'], ['external', 'External']];
const KIND_OPTS = [['all', 'All'], ...KINDS.map(([k, p]) => [k, p])];
const SRC_OPTS = [['all', 'All'], ...ALL_SOURCES.map((s) => [s, s])];

export function noncompliant() {
  const s = new Set();
  for (const f of findings()) if (f.severity === 'Critical' || f.severity === 'High') s.add(f.asset.id);
  return s;
}

function filterAssets(v, base) {
  const q = (v.q || '').toLowerCase().trim();
  return base.filter((a) => (v.kind === 'all' || !v.kind || a.kind === v.kind)
    && (!v.cloud || v.cloud === 'all' || a.cloud === v.cloud)
    && (!v.source || v.source === 'all' || a.source === v.source)
    && (!v.registry || a.registry === v.registry)
    && (!v.exposure || v.exposure === 'any' || a.exposure === v.exposure)
    && (!v.auth || v.auth === 'any' || a.auth === v.auth)
    && (!v.account || a.account.toLowerCase().includes(v.account.toLowerCase()))
    && (!v.region || a.region.toLowerCase().includes(v.region.toLowerCase()))
    && (!q || a.name.toLowerCase().includes(q) || a.id.includes(q) || a.source.toLowerCase().includes(q)));
}

function filterBar(v, o = {}) {
  return `<div class="toolbar wrap">${search('q', v.q, 'Search name or ARN')}
    ${select('kind', KIND_OPTS, v.kind || 'all', { label: 'Kind', aria: 'Kind' })}
    ${select('cloud', CLOUDS.map(([k, l]) => [k, k === 'all' ? 'All' : l]), v.cloud || 'all', { label: 'Cloud', aria: 'Cloud' })}
    ${select('source', SRC_OPTS, v.source || 'all', { label: 'Source', aria: 'Source' })}
    ${btn('More filters', { icon: 'sliders', act: 'set', data: { key: 'more', val: !v.more }, cls: v.more ? 'on' : '' })}
    ${v.registry ? `<button type="button" class="chip on" data-act="set" data-key="registry" data-val="&quot;&quot;">${esc(v.registry.replace('_', ' '))} ${icon('x', 12)}</button>` : ''}
    ${o.right || ''}</div>
    ${v.more ? `<div class="toolbar wrap sub">${select('exposure', [['any', 'Any'], ['public', 'Public'], ['organization', 'Organization'], ['private', 'Private']], v.exposure || 'any', { label: 'Exposure' })}
      ${select('auth', [['any', 'Any'], ['required', 'Required'], ['none', 'None']], v.auth || 'any', { label: 'Authentication' })}
      <label class="search sm"><span class="sel-label">Account</span><input data-bind="account" value="${esc(v.account || '')}" aria-label="Account"></label>
      <label class="search sm"><span class="sel-label">Region</span><input data-bind="region" value="${esc(v.region || '')}" aria-label="Region"></label>
      ${toggle('removed', v.removed, { label: 'Include removed' })}</div>` : ''}`;
}

function statusCell(a) { return a.status ? `<span class="status-txt">${esc(a.status)}</span>` : '<span class="muted">—</span>'; }

function listView(v, base, o = {}) {
  const items = filterAssets(v, base);
  const page = Math.min(v.page || 0, Math.max(0, Math.ceil(items.length / PER) - 1));
  const rows = items.slice(page * PER, page * PER + PER);
  const sel = new Set(v.sel || []);
  const cols = [...(o.select ? [{ label: `<input type="checkbox" data-act="sel-page" aria-label="Select this page"${rows.length && rows.every((a) => sel.has(a.id)) ? ' checked' : ''}>`, w: '36px' }] : []),
    { label: 'Name' }, { label: 'Kind', w: '140px' }, { label: 'Source', w: '200px' }, { label: 'Status', w: '100px' }, { label: 'Registry', w: '150px' }, { label: o.select ? '' : 'Last synced', w: o.select ? '110px' : '130px', cls: o.select ? 'r' : '' }];
  return table({ cols, empty: 'No assets match these filters.',
    rows: rows.map((a) => [...(o.select ? [`<input type="checkbox" data-act="sel" data-id="${a.id}" aria-label="Select ${esc(a.name)}"${sel.has(a.id) ? ' checked' : ''}>`] : []),
      assetLink(a), kindLabel(a.kind), sourceLabel(a), statusCell(a), regPill(a.registry),
      o.select ? btn('Register', { sm: true, act: 'register-one', data: { id: a.id }, perm: 'register', disabled: a.registry !== 'shadow' }) : `<span class="muted">${ago(a.lastSynced)}</span>`]) }) + pager(page, items.length, PER);
}

// ---------------- map ----------------
function mapView(v, all, nc) {
  const q = (v.q || '').toLowerCase();
  const onlyNc = !!v.nc;
  const cloudF = v.mcloud || 'all';
  let agents = all.filter((a) => a.kind === 'agent' && (cloudF === 'all' || a.cloud === cloudF) && (!onlyNc || nc.has(a.id)));
  if (q) agents = agents.filter((a) => a.name.toLowerCase().includes(q));
  const colourKind = v.colour === 'kind';
  const accounts = [];
  for (const integ of [...S.integrations, { id: null, name: 'registry', cloud: 'external' }]) {
    const ag = agents.filter((a) => (integ.id ? a.integrationId === integ.id : !a.integrationId));
    const others = all.filter((a) => a.kind !== 'agent' && (integ.id ? a.integrationId === integ.id : false) && (!onlyNc || nc.has(a.id)));
    if (!ag.length && !others.length) continue;
    const products = new Map();
    for (const a of ag) { if (!products.has(a.source)) products.set(a.source, { agents: [], other: 0 }); products.get(a.source).agents.push(a); }
    if (integ.cloud === 'microsoft') { const ent = others.filter((a) => a.source === 'Entra ID').length; if (ent && !q) products.set('Entra ID', { agents: [], other: ent }); }
    accounts.push({ integ, ag, products: [...products].sort((x, y) => y[1].agents.length - x[1].agents.length) });
  }
  accounts.sort((x, y) => y.ag.length - x.ag.length);
  const firstProduct = accounts[0] && accounts[0].products[0] ? `${accounts[0].integ.id}|${accounts[0].products[0][0]}` : null;
  const expanded = v.expandAll ? 'all' : v.exp || firstProduct;
  const isExp = (k) => expanded === 'all' || expanded === k;
  const shown = [];
  for (const acc of accounts) for (const [src, p] of acc.products) if (isExp(`${acc.integ.id}|${src}`)) shown.push(...p.agents.map((a) => ({ a, key: `${acc.integ.id}|${src}` })));
  const maxShown = 14;
  const vis = shown.slice(0, maxShown);
  const usedKinds = KINDS.filter(([k]) => k !== 'agent' && !['guardrail', 'registry', 'artifact', 'workspace', 'api_key'].includes(k)).map(([k, p]) => {
    const l = all.filter((a) => a.kind === k && (cloudF === 'all' || a.cloud === cloudF) && (!onlyNc || nc.has(a.id)));
    return { k, p, n: l.length, bad: l.filter((a) => nc.has(a.id)).length };
  }).filter((x) => x.n);
  const dot = (n) => (n ? `<span class="rdot">${n}</span>` : '');
  const chipCls = (a) => (colourKind ? 'k-agent' : nc.has(a.id) ? 'bad' : 'ok');
  return `<div class="map" id="map">
    <div class="map-cols"><span>Accounts</span><span>Products</span><span>Agents</span><span>${v.uses === false ? '' : 'What they use'}</span></div>
    <div class="map-grid">
      <div class="map-col">${accounts.map((acc) => `<div class="map-node acc" data-node="acc:${acc.integ.id}">${cloudIcon(acc.integ.cloud, 18)}<span><b>${esc(acc.integ.name)}</b><small>${esc(CLOUD_NAME[acc.integ.cloud])} · ${acc.ag.length} agent${acc.ag.length === 1 ? '' : 's'}</small></span></div>`).join('') || '<p class="muted">Nothing matches.</p>'}</div>
      <div class="map-col">${accounts.map((acc) => acc.products.map(([src, p]) => { const k = `${acc.integ.id}|${src}`; const bad = p.agents.filter((a) => nc.has(a.id)).length; return p.agents.length ? `<button type="button" class="map-node prod${isExp(k) ? ' open' : ''}" data-node="prod:${esc(k)}" data-parent="acc:${acc.integ.id}" data-act="map-exp" data-key="${esc(k)}" title="${esc(src)}">${icon(isExp(k) ? 'down' : 'right', 13)}<span class="trunc">${esc(src)}</span>${bad ? `<span class="rdot">${bad}</span>` : ''}<span class="n">${p.agents.length}</span></button>` : `<div class="map-node prod flat" data-node="prod:${esc(k)}" data-parent="acc:${acc.integ.id}"><span class="trunc">${esc(src)}</span><span class="n muted">${p.other} assets</span></div>`; }).join('')).join('')}</div>
      <div class="map-col">${vis.map(({ a, key }) => `<a class="map-node ag ${chipCls(a)}" href="#/inventory/${a.id}" data-node="ag:${a.id}" data-parent="prod:${esc(key)}" title="${esc(a.name)}"><i></i><span class="trunc">${esc(a.name)}</span></a>`).join('')}${shown.length > maxShown ? `<button type="button" class="lnk more" data-act="go" data-href="#/inventory?tab=list&kind=agent">+${shown.length - maxShown} more agents</button>` : ''}${!vis.length ? '<p class="muted small">Open a product to see its agents.</p>' : ''}</div>
      <div class="map-col">${v.uses === false ? '' : usedKinds.map((x) => `<button type="button" class="map-node use" data-node="use:${x.k}" data-act="go" data-href="#/inventory?tab=list&kind=${x.k}">${icon('right', 13)}<span class="trunc">${esc(x.p)}</span>${colourKind ? '' : dot(x.bad)}<span class="n">${x.n}</span></button>`).join('')}</div>
    </div><svg class="map-edges" aria-hidden="true"></svg>
    <script type="application/json" class="map-links">${JSON.stringify(vis.flatMap(({ a }) => uses(a.id).map((r) => { const t = asset(r.to); return t ? [`ag:${a.id}`, `use:${t.kind}`] : null; }).filter(Boolean)))}</script>
  </div>`;
}

function drawEdges() {
  const map = document.getElementById('map'); if (!map) return;
  const svg = map.querySelector('.map-edges');
  const box = map.getBoundingClientRect();
  svg.setAttribute('width', box.width); svg.setAttribute('height', box.height);
  const pos = (el, side) => { const r = el.getBoundingClientRect(); return [side === 'r' ? r.right - box.left : r.left - box.left, r.top - box.top + r.height / 2]; };
  const path = ([x1, y1], [x2, y2], cls) => { const mx = (x1 + x2) / 2; return `<path class="${cls}" d="M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}"/>`; };
  let html = '';
  map.querySelectorAll('[data-parent]').forEach((el) => {
    const p = map.querySelector(`[data-node="${CSS.escape(el.dataset.parent)}"]`);
    if (p) html += path(pos(p, 'r'), pos(el, 'l'), el.classList.contains('bad') ? 'e bad' : 'e');
  });
  let links = [];
  try { links = JSON.parse(map.querySelector('.map-links').textContent); } catch { /* none */ }
  const seen = new Set();
  for (const [from, to] of links) {
    const k = from + to; if (seen.has(k)) continue; seen.add(k);
    const a = map.querySelector(`[data-node="${CSS.escape(from)}"]`), b = map.querySelector(`[data-node="${CSS.escape(to)}"]`);
    if (a && b) html += path(pos(a, 'r'), pos(b, 'l'), 'e use');
  }
  svg.innerHTML = html;
}

function mapToolbar(v, nc) {
  return `<div class="toolbar wrap">${search('q', v.q, 'Find agents, models, tools…')}${select('mcloud', CLOUDS, v.mcloud || 'all', { aria: 'Cloud' })}
    ${toggle('nc', v.nc, { label: 'Non-compliant only', count: nc.size })}<span class="grow"></span>
    ${menu('view', 'View', [{ head: 'Show' }, { label: 'The whole estate', act: 'set', data: { key: 'show', val: 'whole' }, check: (v.show || 'whole') === 'whole' }, { label: 'One asset and what it touches', act: 'set', data: { key: 'show', val: 'one' }, check: v.show === 'one' },
      { head: 'Colour by' }, { label: 'Compliance', act: 'set', data: { key: 'colour', val: 'compliance' }, check: v.colour !== 'kind' }, { label: 'Kind', act: 'set', data: { key: 'colour', val: 'kind' }, check: v.colour === 'kind' },
      { head: 'Layout' }, { label: 'Layers', act: 'set', data: { key: 'layout', val: 'layers' }, check: (v.layout || 'layers') === 'layers' }, { label: 'Neat', act: 'set', data: { key: 'layout', val: 'neat' }, check: v.layout === 'neat' }, { label: 'Graph', act: 'set', data: { key: 'layout', val: 'graph' }, check: v.layout === 'graph' },
      '-', { label: 'Show what agents use', act: 'set', data: { key: 'uses', val: v.uses === false }, check: v.uses !== false }, { label: v.expandAll ? 'Collapse accounts' : 'Expand every account', act: 'set', data: { key: 'expandAll', val: !v.expandAll } }], { icon: 'sliders', right: true })}
    ${btn('Ask', { icon: 'chat', act: 'ctrl-open' })}</div>`;
}

function oneAsset(v, all) {
  const agents = all.filter((a) => a.kind === 'agent');
  const id = v.focus || agents[0].id;
  return `<div class="toolbar">${select('focus', agents.map((a) => [a.id, a.name]), id, { label: 'Asset', aria: 'Asset' })}${btn('Back to the whole estate', { act: 'set', data: { key: 'show', val: 'whole' } })}</div>` + panel({ body: graph(asset(id), { expand: true }) });
}

export function inventoryBody(v, { shadowMode = false } = {}) {
  const all = live().filter((a) => v.removed || !a.removed);
  const nc = noncompliant();
  if ((v.tab || 'map') === 'map') {
    const mv = v.show === 'one' ? oneAsset(v, all) : mapView(v, shadowMode ? all.filter((a) => a.registry !== 'registered') : all, nc);
    return mapToolbar(v, nc) + `<div class="layout-${v.layout || 'layers'}">${mv}</div>`;
  }
  const base = shadowMode ? all.filter((a) => a.registry === 'shadow') : all;
  if (shadowMode) {
    const items = filterAssets(v, base);
    const sel = (v.sel || []).filter((id) => asset(id) && asset(id).registry === 'shadow');
    return filterBar(v) + `<div class="toolbar bulk"><span class="muted">${sel.length ? `${sel.length} selected` : 'Tick assets to register several at once.'}</span><span class="grow"></span>${btn('Register selected', { act: 'register-sel', perm: 'register', disabled: !sel.length, kind: sel.length ? 'primary' : '' })}${btn(`Register all ${items.length}`, { act: 'register-all', perm: 'register', disabled: !items.length })}</div>` + listView(v, base, { select: true });
  }
  const sub = v.sub || 'agents';
  const vv = sub === 'agents' && (!v.kind || v.kind === 'all') ? { ...v, kind: 'agent' } : v;
  return tabs('sub', [['agents', 'Agents', all.filter((a) => a.kind === 'agent').length], ['all', 'All assets', all.length]], sub) + filterBar(v) + listView(vv, base);
}

function inventory({ v }) {
  const all = live(); const rs = registryStats(all);
  return pageHead({ title: 'AI Inventory', desc: 'Every AI agent and everything it uses (models, MCP servers, tools, identities), as discovered across your clouds, and where each stands in the registry.' })
    + statCards([
      { label: 'Assets', value: int(all.length), sub: `${new Set(all.map((a) => a.kind)).size} kinds`, href: '#/inventory?tab=list&sub=all' },
      { label: 'Agents', value: int(all.filter((a) => a.kind === 'agent').length), sub: `${all.filter((a) => a.kind === 'mcp_server').length} MCP servers`, href: '#/inventory?tab=list&kind=agent' },
      { label: 'Registered', value: pct(rs.pct), sub: `${rs.registered} of ${rs.governed} governed · ${rs.awaiting} awaiting`, href: '#/registry' },
      { label: 'Shadow', value: int(rs.shadow), sub: 'Discovered, never registered', href: '#/shadow-ai' },
    ])
    + `<div class="toolbar">${seg('tab', [['map', 'Map', 'map'], ['list', 'List', 'list']], v.tab || 'map', { label: 'View' })}</div>` + inventoryBody(v);
}

function shadow({ v }) {
  const rs = registryStats(); const ss = shadowSpend();
  const head = `<div class="progress-head"><div class="ph-big"><strong>${pct(rs.pct)}</strong><span>of governed assets registered</span></div>
    <div class="ph-bar"><i class="seg-reg" style="width:${(rs.registered / rs.governed) * 100}%"></i><i class="seg-wait" style="width:${(rs.awaiting / rs.governed) * 100}%"></i><i class="seg-shadow" style="width:${(rs.shadow / rs.governed) * 100}%"></i></div>
    <div class="ph-links"><a href="#/registry"><i class="lg-reg"></i>${rs.registered} Registered</a><a href="#/approvals"><i class="lg-wait"></i>${rs.awaiting} Awaiting approval</a><a href="#/shadow-ai?tab=list"><i class="lg-shadow"></i>${rs.shadow} Shadow</a></div></div>`;
  const spending = panel({ title: 'Spending, and not registered', desc: `${money(ss.total)} over the last 30 days on ${ss.count} assets nobody registered, the costliest first.`, right: `<a class="lnk" href="#/spend">What needs attention in spend</a>`,
    body: `<div class="rows">${ss.list.slice(0, 5).map((a) => `<div class="row">${assetLink(a)}<span class="muted">${esc(kindOne(a.kind))}</span><span class="grow"></span><span class="num">${money(a.spend30d)}</span>${btn('Register', { sm: true, act: 'register-one', data: { id: a.id }, perm: 'register' })}</div>`).join('') || '<p class="muted">Nothing unregistered is spending.</p>'}</div>` });
  return pageHead({ title: 'Shadow AI', desc: 'Discovered AI assets that nobody has registered. Register them, one at a time or a whole connection at once, to send them for approval.' })
    + head + spending + `<div class="toolbar">${seg('tab', [['map', 'Map', 'map'], ['list', 'List', 'list']], v.tab || 'map', { label: 'View' })}</div>` + inventoryBody(v, { shadowMode: true });
}

// ---------------- register ----------------
export function openRegister(ids, ctx, label) {
  const list = ids.map(asset).filter((a) => a && a.registry === 'shadow');
  if (!list.length) { toast('Nothing to register: those are not shadow any more.'); return; }
  const first = list[0];
  modal({ title: list.length === 1 ? `Register ${first.name}` : `Register ${list.length} assets`,
    body: `<p class="muted">Registering names an owner and a purpose and sends ${list.length === 1 ? 'it' : 'them'} to an administrator. Until approved, ${list.length === 1 ? 'it shows' : 'they show'} as Awaiting approval.</p>
      ${list.length > 1 ? `<div class="reg-list">${list.slice(0, 8).map((a) => `<span>${icon(KIND_ICON[a.kind], 13)}${esc(a.name)}</span>`).join('')}${list.length > 8 ? `<span class="muted">and ${list.length - 8} more</span>` : ''}</div>` : ''}
      ${field('Owner', input('owner', { type: 'email', value: first.owner && !first.owner.includes('onmicrosoft') ? first.owner : ctx.session.email, required: true, list: 'people' }) + `<datalist id="people">${PEOPLE.map((p) => `<option value="${p}">`).join('')}</datalist>`, 'Answers for it technically. Must be a person in the organization.')}
      ${field('Purpose', textarea('purpose', { placeholder: 'What it is for, in a sentence', maxlength: 300 }))}
      ${field('Share with', radios('shared', [['owner', 'Only its owner'], ['organization', 'Everyone in the organization', 'Raises "Assets shared with the whole organization" on agents'], ['people', 'People', 'Name them after approval']], 'owner'))}`,
    submit: 'Send for approval',
    onSubmit: (d) => {
      if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(d.owner || '')) return 'Enter the owner as an email address.';
      if (!(d.purpose || '').trim()) return 'Say what it is for.';
      const n = requestRegistration(list.map((a) => a.id), { owner: d.owner.trim().toLowerCase(), purpose: d.purpose.trim(), shared: d.shared || 'owner' });
      if (ctx.v.sel) ctx.v.sel = [];
      toast(`${n} sent for approval.`, { link: ['Open Approvals', '#/approvals'] });
      track('action', ctx.route.path, `Registered ${list.length === 1 ? first.name : `${n} assets`}`);
    } });
}

const shared = {
  go: (el) => { location.hash = el.dataset.href; },
  'map-exp': (el, ctx) => ctx.set('exp', ctx.v.exp === el.dataset.key ? '__none' : el.dataset.key),
  'register-one': (el, ctx) => openRegister([el.dataset.id], ctx),
  'register-sel': (el, ctx) => openRegister(ctx.v.sel || [], ctx),
  'register-all': (el, ctx) => openRegister(filterAssets(ctx.v, live().filter((a) => a.registry === 'shadow' && !a.removed)).map((a) => a.id), ctx),
  sel: (el, ctx) => { const s = new Set(ctx.v.sel || []); el.checked ? s.add(el.dataset.id) : s.delete(el.dataset.id); ctx.v.sel = [...s]; ctx.render(); },
  'sel-page': (el, ctx) => { const s = new Set(ctx.v.sel || []); document.querySelectorAll('#page input[data-act="sel"]').forEach((c) => (el.checked ? s.add(c.dataset.id) : s.delete(c.dataset.id))); ctx.v.sel = [...s]; ctx.render(); },
  nc: (el, ctx) => ctx.set('nc', el.checked),
};

// ---------------- asset detail ----------------
const REL_LABEL = { uses_model: 'Uses model', uses_tool: 'Uses tool', uses_mcp: 'Uses MCP server', runs_as: 'Runs as', behind_gateway: 'Behind gateway', uses: 'Uses', calls_agent: 'Calls agent' };
const NODE_CLS = { agent: 'n-agent', tool: 'n-tool', mcp_server: 'n-mcp', gateway: 'n-gw', model: 'n-model', identity: 'n-id', credential_provider: 'n-id', memory: 'n-tool', code_interpreter: 'n-tool' };

export function graph(a, { expand = false, zoom = 1 } = {}) {
  if (!a) return '';
  const out = uses(a.id).map((r) => ({ r, n: asset(r.to) }));
  const inn = usedBy(a.id).map((r) => ({ r, n: asset(r.from) }));
  if (!out.length && !inn.length) return `<div class="graph-empty">Nothing is linked to this asset yet.</div>`;
  const W = 900, rowH = 54, GAP = 300;
  const second = expand ? out.flatMap(({ n }) => uses(n.id).map((r) => ({ r, n: asset(r.to), parent: n.id }))).slice(0, 8) : [];
  const H = Math.max(out.length, inn.length, second.length, 1) * rowH + 40;
  const cx = expand ? 260 : 450, cy = H / 2;
  const node = (n, x, y, center) => `<g class="gnode ${NODE_CLS[n.kind] || 'n-other'}${center ? ' center' : ''}" transform="translate(${x},${y})"><a href="#/inventory/${n.id}"><rect x="-82" y="-16" width="164" height="32" rx="8"/><text y="5" text-anchor="middle">${e2(n.name.length > 22 ? n.name.slice(0, 21) + '…' : n.name)}</text><title>${e2(n.name)} · ${e2(kindOne(n.kind))}</title></a></g>`;
  // Labels sit next to the far node, where edges have spread apart, not at the crowded middle.
  const edge = (x1, y1, x2, y2, label, side = 'out') => `<path class="gedge" d="M${x1},${y1} C${(x1 + x2) / 2},${y1} ${(x1 + x2) / 2},${y2} ${x2},${y2}"/><text class="glabel" x="${side === 'out' ? x2 - 8 : x1 + 8}" y="${(side === 'out' ? y2 : y1) - 7}" text-anchor="${side === 'out' ? 'end' : 'start'}">${e2(label)}</text>`;
  let svg = '';
  const outPos = out.map((_, i) => 20 + rowH / 2 + i * rowH + (H - 40 - out.length * rowH) / 2);
  const inPos = inn.map((_, i) => 20 + rowH / 2 + i * rowH + (H - 40 - inn.length * rowH) / 2);
  out.forEach(({ r }, i) => { svg += edge(cx + 82, cy, cx + GAP - 82, outPos[i], (REL_LABEL[r.type] || r.type).toLowerCase()); });
  inn.forEach(({ r }, i) => { svg += edge(cx - GAP + 82, inPos[i], cx - 82, cy, (REL_LABEL[r.type] || r.type).toLowerCase(), 'in'); });
  const secPos = second.map((_, i) => 20 + rowH / 2 + i * rowH);
  second.forEach(({ r, parent }, i) => { const pi = out.findIndex((o) => o.n.id === parent); if (pi >= 0) svg += edge(cx + GAP + 82, outPos[pi], cx + 2 * GAP - 82, secPos[i], (REL_LABEL[r.type] || r.type).toLowerCase()); });
  svg += out.map(({ n }, i) => node(n, cx + GAP, outPos[i])).join('') + inn.map(({ n }, i) => node(n, cx - GAP, inPos[i])).join('') + second.map(({ n }, i) => node(n, cx + 2 * GAP, secPos[i])).join('') + node(a, cx, cy, true);
  return `<div class="graph-wrap"><svg class="graph" viewBox="0 0 ${expand ? 1100 : W} ${H}" style="max-height:${Math.round(H * zoom)}px;transform:scale(${zoom});transform-origin:center top">${svg}</svg></div>
    <div class="legend graph-legend"><span><i class="lg-agent"></i>Agent</span><span><i class="lg-tool"></i>Tool</span><span><i class="lg-mcp"></i>MCP · gateway</span><span><i class="lg-model"></i>Model</span><span><i class="lg-id"></i>Identity · credential</span></div>`;
}

function assetPage(ctx) {
  const a = asset(ctx.params[0]);
  if (!a) return empty('No such asset', 'It may have been removed. Go back to the inventory.', btn('AI Inventory', { href: '#/inventory' }));
  const v = ctx.v;
  const fs = findingsFor(a.id);
  const rel = uses(a.id).length + usedBy(a.id).length;
  const isAgent = a.kind === 'agent';
  const t = v.t || 'overview';
  const tabList = [['overview', 'Overview'], [isAgent ? 'relations' : 'relations', a.kind === 'identity' ? 'Identity & access' : 'Relations', rel || null], ['findings', 'Findings', fs.length || null], ['ownership', 'Ownership'], ...(a.spend30d > 0 ? [['spend', 'Spend']] : []), ['config', 'Configuration']];
  const actions = menu('actions', 'Actions', [
    { label: 'Open in Shadow AI map', act: 'go', data: { href: '#/shadow-ai' }, icon: 'shadow' }, { label: 'View on the map', act: 'go', data: { href: '#/inventory' }, icon: 'map' }, { label: 'Copy resource ID', act: 'copy', data: { text: a.id }, icon: 'copy' }, '-',
    a.blocked ? { label: 'Unblock', act: 'asset', data: { a: 'unblock' }, perm: 'block', icon: 'check' } : { label: 'Block', act: 'asset-reason', data: { a: 'block' }, perm: 'block', icon: 'ban' },
    { label: a.exposure === 'organization' ? 'End organization-wide sharing' : 'Share…', act: a.exposure === 'organization' ? 'asset' : 'share', data: { a: 'unshare' }, perm: 'share', icon: 'users' },
    ...(isAgent ? [a.flags.viaGateway ? { label: 'Take off the LLM gateway', act: 'asset', data: { a: 'ungateway' }, perm: 'gateway', icon: 'gateway' } : { label: 'Route through the LLM gateway', act: 'asset-reason', data: { a: 'gateway' }, perm: 'gateway', icon: 'gateway' }] : []),
    { label: 'Delete', act: 'asset-reason', data: { a: 'delete' }, perm: 'delete', icon: 'trash', danger: true },
  ], { right: true });

  const head = `<a class="crumb-back" href="#/inventory?tab=list&kind=${a.kind}">${icon('back', 14)}${esc(KIND_PLURAL[a.kind])}</a>
    <div class="asset-head"><span class="asset-ic">${icon(KIND_ICON[a.kind], 20)}</span><div><h1>${esc(a.name)}</h1>
    <p class="meta">${a.cloud === 'external' ? '<span class="tag-mini">REGISTRY</span> ' : cloudIcon(a.cloud, 14)} ${esc(a.source)}${a.environment ? ` / ${esc(a.environment)}` : ''} · ${esc(kindOne(a.kind))}${a.status ? ` · ${esc(a.status)}` : ''} · Created ${ago(a.createdAt)} · Last synced ${ago(a.lastSynced)} ${regPill(a.registry)}${a.blocked ? ' ' + pill('Blocked', 'red') : ''}${a.removed ? ' ' + pill('Removed', 'grey') : ''}</p>
    <div class="page-actions">${btn('Rescan', { icon: 'refresh', act: 'asset', data: { a: 'rescan' }, perm: 'rescan' })}${actions}</div></div></div>`;

  let body = '';
  if (t === 'overview') {
    const z = v.zoom || 1;
    const graphCard = panel({ title: 'Graph', right: `<div class="btn-row">${btn(v.expand ? 'Collapse' : 'Expand all', { sm: true, act: 'set', data: { key: 'expand', val: !v.expand } })}${btn('', { sm: true, icon: 'plus', act: 'set', data: { key: 'zoom', val: Math.min(1.6, z + 0.2) }, aria: 'Zoom in' })}${btn('', { sm: true, icon: 'x', act: 'set', data: { key: 'zoom', val: Math.max(0.6, z - 0.2) }, aria: 'Zoom out', cls: 'zoom-out' })}${btn('Fit to view', { sm: true, act: 'set', data: { key: 'zoom', val: 1 } })}</div>`, body: graph(a, { expand: v.expand, zoom: z }) });
    const details = panel({ title: 'Item details', h: 'h3', body: kv([['Name', esc(a.name)], ['Owner', person(a.owner)], ['Item type', esc(kindOne(a.kind))], ['Created in', esc(a.source)], a.harness && ['Harness', esc(a.harness)], a.status && ['Status', esc(a.status)], a.orchestration && ['Orchestration', esc(a.orchestration[0].toUpperCase() + a.orchestration.slice(1))], ['Authentication', a.auth === 'none' ? '<span class="t-red">None</span>' : 'Required'], ['Exposure', esc(a.exposure)], ['Item ID', `<code class="trunc-code">${esc(a.cloud === 'external' ? 'endpoint:' + (a.attributes.endpoint || a.id) : a.id)}</code>${copyBtn(a.id)}`], a.description && ['Description', esc(a.description)]]) });
    const where = panel({ title: 'Where it lives', h: 'h3', body: kv([['Source', sourceLabel(a)], ['Integration', a.integrationId ? `<a class="lnk" href="#/integrations">${esc(a.integrationId)}</a>` : '<span class="muted">Registered by hand</span>'], ['Account', esc(a.account)], a.environment && ['Environment', esc(a.environment)], a.environmentType && ['Environment type', esc(a.environmentType)], ['Region', esc(a.region)]]) });
    const activity = panel({ title: 'Activity', h: 'h3', body: kv([['Created by', person(a.createdBy)], ['Created on', stamp(a.createdAt)], ['First discovered', stamp(a.firstDiscovered)], ['Last synced', ago(a.lastSynced)], ['Reported by', a.reportedBy.map((r) => `<code>${esc(r)}</code>`).join('<br>')]]) });
    const spendFs = fs.filter((f) => f.code.startsWith('FIN-'));
    const spendCard = a.spend30d > 0 ? panel({ title: 'Spend, 30 days', h: 'h3', body: kv([['Billed', `<b>${money(a.spend30d)}</b>`]]) + (spendFs.length ? `<div class="needs">${spendFs.map((f) => `<p>${sevPill(f.severity)} ${esc(f.evidence)}</p>`).join('')}</div>` : '') + `<a class="lnk" href="#/spend">More in Spend</a>` }) : '';
    body = graphCard + `<div class="grid-2">${details}${where}</div><div class="grid-2">${activity}${registration(a)}</div>${spendCard}`;
  }
  if (t === 'relations') {
    const row = (r, n) => `<div class="row">${icon(KIND_ICON[n.kind], 14)}${assetLink(n)}<span class="muted">${esc(kindOne(n.kind))}</span><span class="grow"></span>${pill(REL_LABEL[r.type] || r.type, 'grey')}</div>`;
    const u = uses(a.id), ub = usedBy(a.id);
    body = panel({ title: a.kind === 'identity' ? 'Identity & access' : 'Relations', desc: 'What this asset uses, and what uses it.', body: rel ? `<h4 class="sub-h">Uses</h4><div class="rows">${u.map((r) => row(r, asset(r.to))).join('') || '<p class="muted">Nothing</p>'}</div><h4 class="sub-h">Used by</h4><div class="rows">${ub.map((r) => row(r, asset(r.from))).join('') || '<p class="muted">Nothing</p>'}</div>` : empty('No relationships', 'Nothing links to this asset, and it links to nothing.') });
  }
  if (t === 'findings') {
    body = panel({ title: 'Findings', desc: 'Each check this asset fails, with what was found.', body: fs.length ? `<div class="rows">${fs.map((f) => `<div class="row finding">${sevPill(f.severity)}<div class="grow"><b>${esc(f.policy.title)}</b><p class="muted">${esc(f.evidence)}</p></div><a class="lnk" href="#/findings?check=${f.code}">The check and how to fix it</a></div>`).join('')}</div>` : empty('Nothing found', 'Every check on this asset passed.') });
  }
  if (t === 'ownership') {
    const card = (title, who, def, extra = '') => `<div class="own-card"><h3>${title}</h3>${who ? person(who) : '<span class="muted">Nobody named</span>'}<p class="muted">${def}</p>${extra}</div>`;
    body = `<div class="grid-3">${card('Team', null, 'The team it belongs to, from the identity provider group.', a.team ? `<p><b>${esc(a.team)}</b></p>` : '')}${card('Owner', a.owner, 'Answers for it technically: changes, incidents, access.', btn('Change owner', { sm: true, act: 'owner', perm: 'register' }))}${card('Sponsor', a.sponsor, 'Answers for it to the business. A sponsor is named by an administrator.')}</div>`;
  }
  if (t === 'spend') {
    body = panel({ title: 'Spend', desc: 'What the bills put down to this asset over the last 30 days.', body: statCards([{ label: 'Billed, 30 days', value: money(a.spend30d) }, { label: 'A day, on average', value: money(a.spend30d / 30) }, { label: 'Registry', value: regPill(a.registry) }]) + `<a class="lnk" href="#/spend">Open Spend</a>` });
  }
  if (t === 'config') {
    const attrs = Object.entries(a.attributes || {});
    body = panel({ title: 'Attributes', desc: 'Stated the same way for every cloud.', body: kv([['Transport', esc(a.attributes.transport || (a.kind === 'agent' ? 'http' : '—'))], ['Endpoint', a.attributes.endpoint ? `<code>${esc(a.attributes.endpoint)}</code>` : null], ['Environment variables', a.envVars.length ? a.envVars.map((x) => `<code>${esc(x)}</code>`).join(' ') : null]]) })
      + panel({ title: 'As read from the cloud', desc: 'Secret values are never stored: variables and headers are recorded by name only.', body: `<pre class="code">${esc(JSON.stringify({ id: a.id, name: a.name, kind: a.kind, source: a.source, ...Object.fromEntries(attrs), exposure: a.exposure, authentication: a.auth, ...(a.envVars.length ? { env: a.envVars.map((n) => ({ name: n, value: '(not stored)' })) } : {}) }, null, 2))}</pre>` });
  }
  return head + tabs('t', tabList, t) + body;
}

function registration(a) {
  if (a.registry === 'registered' && a.registration) {
    const r = a.registration;
    return panel({ title: 'Registration', h: 'h3', right: regPill('registered'), body: kv([['Owner', person(r.owner)], ['Purpose', esc(r.purpose)], ['Shared with', r.shared === 'organization' ? '<span class="t-amber">Everyone in the organization</span>' : 'Only its owner'], ['Approved', `${esc(r.approvedBy)}, ${ago(r.approvedAt)}`]]) + btn('Revoke', { act: 'revoke', perm: 'revoke', kind: 'danger-ghost' }) });
  }
  if (a.registry === 'awaiting_approval') return panel({ title: 'Registration', h: 'h3', right: regPill('awaiting_approval'), body: `<p class="muted">Sent for approval. An administrator approves or rejects it in Approvals.</p><a class="lnk" href="#/approvals">Open Approvals</a>` });
  if (a.registry === 'shadow') return panel({ title: 'Registration', h: 'h3', right: regPill('shadow'), body: `<p><b>Shadow</b>: discovered, but nobody has registered it.${a.revoked ? ' Its registration was revoked.' : ''}</p>` + btn('Register', { act: 'register-one', data: { id: a.id }, perm: 'register', kind: 'primary' }) });
  return panel({ title: 'Registration', h: 'h3', right: regPill('not_governed'), body: '<p class="muted">The registry does not govern this kind of asset. It is inventoried, and checked by the security policies.</p>' });
}

function reasonModal(title, submit, fn, danger = false) {
  modal({ title, body: field('Reason', textarea('reason', { placeholder: 'Written to the audit log' })), submit, danger, onSubmit: (d) => { if (!(d.reason || '').trim()) return 'Give a reason: it goes in the audit log.'; fn(d.reason.trim()); } });
}

export const ROUTES = [
  { path: '/inventory', render: inventory, init: (r) => ({ tab: 'map', kind: 'all', cloud: 'all', source: 'all', q: '', sub: r.query.kind && r.query.kind !== 'agent' ? 'all' : 'agents' }), actions: shared, mount: () => drawEdges() },
  { path: '/shadow-ai', render: shadow, init: () => ({ tab: 'map', nc: true, kind: 'all', cloud: 'all', source: 'all', q: '', sel: [] }), actions: shared, mount: () => drawEdges() },
  { path: /^\/inventory\/(ast_[0-9a-f]+)$/, render: assetPage, init: (r) => ({ t: r.query.t || 'overview', zoom: 1 }),
    actions: {
      ...shared,
      revoke: (el, ctx) => reasonModal('Revoke the registration?', 'Revoke', (reason) => { const a = asset(ctx.params[0]); revoke(a.id, reason); toast(`${a.name} is shadow again.${a.spend30d > 0 ? ' It still spends, so FIN-2 is raised.' : ''}`); track('action', ctx.route.path, `Revoked ${a.name}`); }, true),
      asset: (el, ctx) => { const a = asset(ctx.params[0]); assetAction(a.id, el.dataset.a); toast(el.dataset.a === 'rescan' ? `Rescanned ${a.name}.` : 'Done. It is in the audit log.'); track('action', ctx.route.path, `${el.dataset.a} ${a.name}`); },
      'asset-reason': (el, ctx) => { const a = asset(ctx.params[0]); const act = el.dataset.a; const t = { block: ['Block this asset?', 'Block'], gateway: ['Route through the LLM gateway?', 'Route it'], delete: ['Delete this asset?', 'Delete'] }[act]; reasonModal(t[0], t[1], (reason) => { assetAction(a.id, act, { reason }); toast(act === 'delete' ? `${a.name} was deleted from ${a.source}.` : 'Done. It is in the audit log.'); track('action', ctx.route.path, `${act} ${a.name}`); if (act === 'delete') location.hash = '#/inventory?tab=list'; }, act === 'delete'); },
      share: (el, ctx) => { const a = asset(ctx.params[0]); modal({ title: `Share ${a.name}`, body: field('Share with', radios('to', [['person', 'A person'], ['org', 'Everyone in the organization']], 'person')) + field('Person', input('person', { type: 'email', placeholder: 'name@lyzr.com', list: 'people' }) + `<datalist id="people">${PEOPLE.map((p) => `<option value="${p}">`).join('')}</datalist>`) + field('Reason', textarea('reason')), submit: 'Share', onSubmit: (d) => { if (d.to === 'person' && !/@/.test(d.person || '')) return 'Enter the person as an email address.'; assetAction(a.id, 'share', { org: d.to === 'org', person: d.person, reason: d.reason }); toast('Shared. It is in the audit log.'); } }); },
      owner: (el, ctx) => { const a = asset(ctx.params[0]); modal({ title: 'Change owner', body: field('Owner', input('owner', { type: 'email', value: a.owner || '', list: 'people' }) + `<datalist id="people">${PEOPLE.map((p) => `<option value="${p}">`).join('')}</datalist>`), submit: 'Save', onSubmit: (d) => { if (!/@/.test(d.owner || '')) return 'Enter an email address.'; assetAction(a.id, 'owner', { owner: d.owner.trim().toLowerCase() }); toast('Owner changed.'); } }); },
    } },
];
export { filterAssets };
