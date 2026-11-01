import { pageHead, panel, table, btn, seg, chips, toggle, pill, sevPill, sevDot, legend, sheet, toast, esc, icon, assetLink, kindLabel, closeOverlay } from '../ui.mjs';
import { S, findings, policy, setPolicy, setAllPolicies, evaluateNow, SEV_ORDER, can, kindOne } from '../store.mjs';
import { FRAMEWORKS } from '../data.mjs';
import { donut } from '../charts.mjs';
import { cloudIcon, CLOUD_NAME } from '../icons.mjs';
import { ago, groupBy, int, pct } from '../util.mjs';
import { track } from '../../../shared/session.mjs';

const CATS = ['Governance', 'Exposure', 'Identity and access', 'Agency', 'Observability', 'Runtime protection', 'Data and secrets', 'Supply chain'];
const CAT_COLOR = { Governance: 'var(--c-muted2)', Exposure: 'var(--c-red)', 'Identity and access': 'var(--c-muted)', Agency: 'var(--c-orange)', Observability: 'var(--c-grey3)', 'Runtime protection': 'var(--c-accent)', 'Data and secrets': 'var(--c-amber)', 'Supply chain': 'var(--c-violet)' };
const CLOUD_ORDER = ['anthropic', 'aws', 'databricks', 'external', 'gcp', 'microsoft', 'snowflake'];
const SEVS = ['Critical', 'High', 'Medium', 'Low'];

function render({ v }) {
  const fs = findings();
  // by cloud
  const byCloud = [...groupBy(fs, (f) => f.cloud)].sort((a, b) => b[1].length - a[1].length);
  const maxC = Math.max(1, ...byCloud.map((x) => x[1].length));
  const cloudPanel = panel({ title: 'Findings by cloud', desc: "Open findings on each cloud's assets, by severity.", body: `<div class="sevbars">${byCloud.map(([c, l]) => `<div class="sevbar"><span class="cloud">${cloudIcon(c, 15)}<span>${esc(CLOUD_NAME[c])}</span></span><span class="sb-track" style="--w:${(l.length / maxC) * 100}%">${SEVS.map((s) => { const n = l.filter((f) => f.severity === s).length; return n ? `<i class="sev-${s.toLowerCase()}" style="flex:${n}" title="${s}: ${n}"></i>` : ''; }).join('')}</span><span class="num">${l.length}</span></div>`).join('')}</div>` + legend([['Critical', 'critical'], ['High', 'high'], ['Medium', 'medium'], ['Low', 'low']]) });
  // by category
  const byCat = CATS.map((c) => [c, fs.filter((f) => f.category === c).length]);
  const catPanel = panel({ title: 'Findings by category', desc: 'What goes wrong: exposure, identity, data, agency, supply chain, runtime, governance and observability.', body: `<div class="donut-row">${donut(byCat.map(([c, n]) => ({ v: n, color: CAT_COLOR[c], label: c })), int(fs.length), 'open findings')}<div class="cat-list">${byCat.map(([c, n]) => `<div><i style="background:${CAT_COLOR[c]}"></i><span>${esc(c)}</span><b class="num">${n}</b><span class="muted num">${pct(fs.length ? n / fs.length : 0)}</span></div>`).join('')}</div></div>` });
  // heat
  const max = Math.max(1, ...CATS.flatMap((c) => CLOUD_ORDER.map((cl) => fs.filter((f) => f.category === c && f.cloud === cl).length)));
  const heat = panel({ title: 'Where it concentrates', desc: 'Open findings by category and cloud; the redder, the more. A cell lists its policies below.', body: `<div class="heat"><div class="heat-row head"><span></span>${CLOUD_ORDER.map((c) => `<span title="${CLOUD_NAME[c]}">${cloudIcon(c, 15)}</span>`).join('')}</div>${CATS.map((cat) => `<div class="heat-row"><span>${esc(cat)}</span>${CLOUD_ORDER.map((cl) => { const n = fs.filter((f) => f.category === cat && f.cloud === cl).length; return n ? `<button type="button" class="heat-cell" style="--a:${(0.15 + 0.85 * (n / max)).toFixed(2)}" data-act="cell" data-cat="${esc(cat)}" data-cloud="${cl}" title="${esc(cat)} on ${CLOUD_NAME[cl]}: ${n}">${n}</button>` : '<span class="heat-cell empty">·</span>'; }).join('')}</div>`).join('')}</div>` });
  // frameworks
  const fwPanel = panel({ title: 'Frameworks', desc: 'The items each framework names that the policies cover, and how many have something open.', body: `<div class="fw">${FRAMEWORKS.map(([key, name, items]) => {
    const codes = Object.keys(items);
    const covered = codes.filter((c) => S.policies.some((p) => (p.frameworks[key] || []).includes(c)));
    const open = covered.filter((c) => fs.some((f) => (f.policy.frameworks[key] || []).includes(c)));
    if (!covered.length) return '';
    return `<div class="fw-row"><div class="fw-top"><b>${esc(name)}</b><span class="muted">${open.length} of ${covered.length} with findings</span></div><span class="fw-bar"><i style="width:${(open.length / covered.length) * 100}%"></i></span><p class="muted small trunc">${open.map((c) => `${c} ${items[c]}`).join(' · ') || 'Nothing open'}</p></div>`;
  }).join('')}</div>` });
  // assets at risk
  const byAsset = [...groupBy(fs.filter((f) => f.code !== 'GOV-1' && f.code !== 'GOV-2'), (f) => f.asset.id)].map(([, l]) => ({ a: l[0].asset, l, sev: l.reduce((m, f) => (SEV_ORDER[f.severity] < SEV_ORDER[m] ? f.severity : m), 'Low') }))
    .sort((x, y) => SEV_ORDER[x.sev] - SEV_ORDER[y.sev] || y.l.length - x.l.length).slice(0, 10);
  const risk = panel({ title: 'Assets most at risk', desc: 'The assets with the most serious findings, leaving out shadow and ownership, which most assets share.', body: table({ cols: [{ label: 'Severity', w: '110px' }, { label: 'Asset' }, { label: 'Kind' }, { label: 'Found', w: '44%' }, { label: 'Findings', cls: 'r' }],
    rows: byAsset.map(({ a, l, sev }) => [sevPill(sev), `<span class="cloud">${cloudIcon(a.cloud, 14)}${assetLink(a)}</span>`, esc(kindOne(a.kind)), `<span class="clamp muted">${esc([...new Set(l.map((f) => f.policy.title))].join(' · '))}</span>`, `<span class="num">${l.length}</span>`]) }) });
  // policies
  const sev = v.sev || 'All';
  const byPol = [...groupBy(fs, (f) => f.code)].map(([code, l]) => ({ p: l[0].policy, l })).filter((x) => sev === 'All' || x.p.severity === sev).sort((a, b) => SEV_ORDER[a.p.severity] - SEV_ORDER[b.p.severity] || b.l.length - a.l.length);
  const quiet = S.policies.length - new Set(fs.map((f) => f.code)).size;
  const cellNote = v.cat && v.cloud ? `<div class="banner banner-blue">${icon('filter', 15)}<span>Showing policies with findings in <b>${esc(v.cat)}</b> on <b>${esc(CLOUD_NAME[v.cloud])}</b></span>${btn('Clear', { sm: true, act: 'clear-cell' })}</div>` : '';
  const polRows = (v.cat ? byPol.filter((x) => x.p.category === v.cat && x.l.some((f) => f.cloud === v.cloud)) : byPol);
  const pols = panel({ title: 'Policies', id: 'policies', desc: 'Each policy with open findings. Open one for the evidence and the fix.', right: chips('sev', ['All', ...SEVS].map((s) => [s, s, s === 'All' ? null : fs.filter((f) => f.severity === s).length]), sev),
    body: cellNote + table({ cols: [{ label: 'Severity', w: '110px' }, { label: 'Policy' }, { label: 'Clouds', w: '140px' }, { label: 'Assets', cls: 'r', w: '80px' }],
      rows: polRows.map(({ p, l }) => ({ attrs: `class="row-link" data-act="check" data-code="${p.code}"`, cells: [sevPill(p.severity), `<b>${esc(p.title)}</b><p class="muted small">${esc(p.category)} · ${p.code}</p>`, `<span class="cloud-row">${[...new Set(l.map((f) => f.cloud))].map((c) => cloudIcon(c, 14)).join('')}</span>`, `<span class="num">${l.length}</span>`] })) })
      + `<p class="muted small">${quiet} more policies find nothing open. <a class="lnk" href="#/posture/policies">Set the security policies</a></p>` });
  return pageHead({ title: 'Findings', desc: "Your AI estate's security posture across every cloud: what is exposed, misconfigured or ungoverned, and where. Evaluated after each scan.",
    right: `<span class="muted small">Evaluated ${ago(S.evaluatedAt)}</span>${btn('Export', { icon: 'download', act: 'export' })}${btn('Evaluate now', { icon: 'refresh', act: 'evaluate', perm: 'scan' })}` })
    + `<div class="grid-2">${cloudPanel}${catPanel}</div><div class="grid-2">${heat}${fwPanel}</div>${risk}${pols}`;
}

function openCheck(code) {
  const p = policy(code); if (!p) return;
  const l = findings().filter((f) => f.code === code).sort((a, b) => a.asset.name.localeCompare(b.asset.name));
  const fw = FRAMEWORKS.map(([k, name, items]) => (p.frameworks[k] || []).length ? `<div class="fw-tag"><b>${esc(name)}</b> ${(p.frameworks[k]).map((c) => `<code title="${esc(items[c] || '')}">${esc(c)}</code>`).join(' ')}</div>` : '').join('');
  sheet({ title: p.title, sub: `${sevPill(p.severity)} ${esc(p.category)} · ${p.code}`, wide: true,
    body: `<p>${esc(p.description)}</p><h4 class="sub-h">How to fix it</h4><p>${esc(p.fix)}</p>
      <h4 class="sub-h">Open on ${l.length} asset${l.length === 1 ? '' : 's'}</h4>${l.length ? `<div class="rows">${l.slice(0, 80).map((f) => `<div class="row finding">${sevDot(f.severity)}${cloudIcon(f.cloud, 14)}<div class="grow">${assetLink(f.asset)}<p class="muted small">${esc(f.evidence)}</p></div>${f.code === 'DAT-1' || f.code === 'DAT-3' ? pill('Reaches data', 'amber') : ''}</div>`).join('')}${l.length > 80 ? `<p class="muted">and ${l.length - 80} more</p>` : ''}</div>` : `<p class="muted">${p.on ? 'Nothing open.' : 'This policy is off.'}</p>`}
      <h4 class="sub-h">Frameworks it answers to</h4>${fw || '<p class="muted">None</p>'}`,
    foot: `<a class="btn" href="#/posture/policies">Security policies</a><button type="button" class="btn btn-primary" data-close>Close</button>` });
  document.querySelectorAll('.sheet [data-close]').forEach((b) => b.addEventListener('click', () => { if (/check=/.test(location.hash)) history.replaceState(null, '', '#/findings'); }));
}

// ---------------- policies ----------------
function policiesPage({ v }) {
  const by = v.by || 'category';
  const prov = v.prov || 'all';
  const fs = findings();
  let list = S.policies.filter((p) => prov === 'all' || p.providers.includes(prov));
  const fwKey = v.fw || null;
  if (by === 'framework' && fwKey) list = list.filter((p) => (p.frameworks[fwKey] || []).length);
  const cat = v.cat || null;
  if (by === 'category' && cat) list = list.filter((p) => p.category === cat || `${p.category}/${p.sub}` === cat);
  const onN = S.policies.filter((p) => p.on).length;
  const tree = by === 'category'
    ? `<button type="button" class="tree-item${!cat ? ' on' : ''}" data-act="set" data-key="cat" data-val="null"><span>Every policy</span><b>${S.policies.length}</b></button>${CATS.slice().sort((a, b) => ['Exposure', 'Identity and access', 'Data and secrets', 'Agency', 'Supply chain', 'Runtime protection', 'Governance', 'Observability'].indexOf(a) - ['Exposure', 'Identity and access', 'Data and secrets', 'Agency', 'Supply chain', 'Runtime protection', 'Governance', 'Observability'].indexOf(b)).map((c) => { const ps = S.policies.filter((p) => p.category === c); return `<button type="button" class="tree-item${cat === c ? ' on' : ''}" data-act="set" data-key="cat" data-val="${esc(JSON.stringify(c))}"><span>${esc(c)}</span><b>${ps.length}</b></button>${[...new Set(ps.map((p) => p.sub))].map((s) => `<button type="button" class="tree-item sub${cat === `${c}/${s}` ? ' on' : ''}" data-act="set" data-key="cat" data-val="${esc(JSON.stringify(`${c}/${s}`))}"><span>${esc(s)}</span><b>${ps.filter((p) => p.sub === s).length}</b></button>`).join('')}`; }).join('')}`
    : `<button type="button" class="tree-item${!fwKey ? ' on' : ''}" data-act="set" data-key="fw" data-val="null"><span>Every policy</span><b>${S.policies.length}</b></button>${FRAMEWORKS.map(([k, name]) => `<button type="button" class="tree-item${fwKey === k ? ' on' : ''}" data-act="set" data-key="fw" data-val="${esc(JSON.stringify(k))}"><span>${esc(name)}</span><b>${S.policies.filter((p) => (p.frameworks[k] || []).length).length}</b></button>`).join('')}`;
  const groups = [...groupBy(list, (p) => `${p.category} · ${p.sub}`)];
  return pageHead({ title: 'Security policies', desc: 'The detectors the posture runs over the inventory. Turn each on or off; a change is saved as you make it, and findings follow within a minute.', right: `<a class="lnk" href="#/findings">${icon('book', 14)} Framework guides</a>` })
    + `<div class="toolbar">${chips('prov', [['all', 'Every provider'], ['microsoft', 'Microsoft'], ['databricks', 'Databricks'], ['gcp', 'Google Cloud'], ['external', 'External'], ['aws', 'AWS'], ['anthropic', 'Anthropic']], prov)}</div>`
    + `<div class="split"><aside class="tree">${seg('by', [['category', 'By category'], ['framework', 'By framework']], by, { sm: true })}${tree}</aside>
      <div><div class="toolbar"><b>${S.policies.length} policies, ${onN === S.policies.length ? 'all on' : `${onN} on`}</b><span class="grow"></span>${btn('Turn all on', { sm: true, act: 'all-on', perm: 'policyToggle', disabled: onN === S.policies.length })}${btn('Turn all off', { sm: true, act: 'all-off', perm: 'policyToggle', disabled: onN === 0 })}</div>
      ${groups.map(([g, ps]) => `<h3 class="grp-h">${esc(g)}</h3>` + table({ cols: [{ label: 'Policy' }, { label: 'Severity', w: '100px' }, { label: 'Providers', w: '140px' }, { label: 'Open', cls: 'r', w: '60px' }, { label: 'On', cls: 'r', w: '60px' }],
        rows: ps.map((p) => [`<b>${esc(p.title)}</b> <code class="muted">${p.code}</code><p class="muted small">${esc(p.description)}</p>${p.note ? `<p class="small t-amber">${esc(p.note)}</p>` : ''}<div class="fw-chips">${FRAMEWORKS.flatMap(([k]) => (p.frameworks[k] || []).map((c) => `<span>${esc(c)}</span>`)).join('')}</div>`, sevPill(p.severity), `<span class="cloud-row">${p.providers.map((c) => cloudIcon(c, 14)).join('')}</span>`, `<span class="num">${p.on ? fs.filter((f) => f.code === p.code).length : '—'}</span>`, toggle('p', p.on, { act: 'pol', data: { code: p.code }, perm: 'policyToggle', aria: p.title })]) })).join('')}</div></div>`;
}

export const ROUTES = [
  { path: '/findings', render, init: () => ({ sev: 'All' }), mount: (ctx) => { const c = ctx.route.query.check; if (c && ctx.v.openedCheck !== c) { ctx.v.openedCheck = c; openCheck(c); } },
    actions: {
      check: (el) => { openCheck(el.dataset.code); history.replaceState(null, '', `#/findings?check=${el.dataset.code}`); },
      cell: (el, ctx) => { ctx.v.cat = el.dataset.cat; ctx.v.cloud = el.dataset.cloud; ctx.render(); document.getElementById('policies').scrollIntoView({ behavior: 'smooth' }); },
      'clear-cell': (el, ctx) => { ctx.v.cat = null; ctx.v.cloud = null; ctx.render(); },
      evaluate: () => { evaluateNow(); toast('Evaluated just now.'); },
      export: () => { const rows = [['severity', 'policy', 'code', 'asset', 'kind', 'cloud', 'evidence'], ...findings().map((f) => [f.severity, f.policy.title, f.code, f.asset.name, f.asset.kind, f.cloud, f.evidence])]; const csv = rows.map((r) => r.map((x) => (/[",\n]/.test(String(x)) ? `"${String(x).replace(/"/g, '""')}"` : x)).join(',')).join('\n'); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'findings.csv'; a.click(); track('action', '/findings', 'Export findings'); },
    } },
  { path: '/posture/policies', render: policiesPage, init: () => ({ by: 'category', prov: 'all' }), actions: {
    pol: (el) => { const p = policy(el.dataset.code); const before = findings().filter((f) => f.code === p.code).length; setPolicy(p.code, el.checked); toast(el.checked ? `${p.title} is on: ${findings().filter((f) => f.code === p.code).length} findings back.` : `${p.title} is off: ${before} findings removed.`, { link: ['Findings', '#/findings'] }); track('action', '/posture/policies', `${el.checked ? 'On' : 'Off'} ${p.code}`); },
    'all-on': () => { setAllPolicies(true); toast('Every policy is on.'); },
    'all-off': () => { setAllPolicies(false); toast('Every policy is off: Findings is empty now.'); },
  } },
];
