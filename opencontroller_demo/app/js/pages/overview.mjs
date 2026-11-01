import { pageHead, statCards, panel, table, btn, menu, miniBar, legend, search, chips, select, esc, icon, sevPill, sevDot, pill, sheet, toast } from '../ui.mjs';
import { S, live, registryStats, findings, needsAttention, shadowSpend, governed, runScan, SEV_ORDER } from '../store.mjs';
import { KINDS } from '../data.mjs';
import { KIND_ICON, cloudIcon, CLOUD_NAME } from '../icons.mjs';
import { money, int, pct, ago, duration, groupBy } from '../util.mjs';
import { track } from '../../../shared/session.mjs';

const SHORTCUTS = [['AI Inventory', '#/inventory', 'inventory', 'c-violet'], ['Shadow AI', '#/shadow-ai', 'shadow', 'c-red'], ['Approvals', '#/approvals', 'approvals', 'c-amber'], ['Registry', '#/registry', 'registry', 'c-green'],
  ['LLM Gateway', '#/llm-gateway', 'gateway', 'c-violet'], ['Virtual keys', '#/llm-gateway/virtual-keys', 'key', 'c-violet'], ['Gateway logs', '#/llm-gateway/logs', 'logs', 'c-violet'], ['Observability', '#/observability', 'observability', 'c-teal'],
  ['Projects', '#/observability/projects', 'projects', 'c-teal'], ['Evals', '#/evals', 'evals', 'c-green'], ['Fine-tuning', '#/fine-tuning', 'finetune', 'c-violet'], ['Findings', '#/findings', 'findings', 'c-red'],
  ['Audit log', '#/settings/audit-log', 'audit', 'c-orange'], ['Integrations', '#/integrations', 'integrations', 'c-accent'], ['Settings', '#/settings/general', 'settings', 'c-accent']];

export function registrySegs(list, label, filterKey) {
  const c = (r) => list.filter((a) => a.registry === r).length;
  return [
    { v: c('registered'), cls: 'reg', title: `${label}: ${c('registered')} registered`, act: 'go', data: { href: `#/inventory?tab=list&${filterKey}&registry=registered` } },
    { v: c('awaiting_approval'), cls: 'wait', title: `${label}: ${c('awaiting_approval')} awaiting approval`, act: 'go', data: { href: `#/approvals` } },
    { v: c('shadow'), cls: 'shadow', title: `${label}: ${c('shadow')} shadow`, act: 'go', data: { href: `#/shadow-ai?tab=list&${filterKey}` } },
    { v: c('not_governed'), cls: 'ng', title: `${label}: ${c('not_governed')} not governed`, act: 'go', data: { href: `#/inventory?tab=list&${filterKey}` } },
  ];
}

const GROUPS = { source: ['Source', (a) => a.source], cloud: ['Cloud', (a) => CLOUD_NAME[a.cloud]], registry: ['Registry', (a) => ({ registered: 'Registered', awaiting_approval: 'Awaiting approval', shadow: 'Shadow' }[a.registry] || 'Not governed')], state: ['State', (a) => ({ active: 'Active', draft: 'Draft', inactive: 'Inactive', na: 'Not applicable' }[a.stateCat])], type: ['Type', (a) => (a.orchestration === 'classic' ? 'Classic' : 'Generative')] };

function render({ v }) {
  const all = live();
  const rs = registryStats(all);
  const agents = all.filter((a) => a.kind === 'agent');
  const att = needsAttention();
  const ss = shadowSpend();
  const fs = findings();
  const lastScan = S.scans[0];
  const integ = lastScan && S.integrations.find((i) => i.id === lastScan.integrationId);

  const banner = att.length ? `<a class="banner banner-red" href="#/spend">${icon('alert', 18)}<b>${att.length} assets' spend need attention, ${att.filter((x) => x.critical).length} critical</b><span class="banner-text">${esc(att[0].asset.name)}: ${esc(att[0].reasons[0])}</span><span class="banner-link">Spend ${icon('arrow', 14)}</span></a>` : '';

  const shortcuts = panel({ title: 'Shortcuts', body: `<div class="shortcuts">${SHORTCUTS.map(([l, h, ic, c]) => `<a href="${h}"><span class="sc-ic ${c}">${icon(ic, 15)}</span>${esc(l)}</a>`).join('')}</div>` });

  const stats = statCards([
    { label: 'Assets', value: int(all.length), sub: `${new Set(all.map((a) => a.kind)).size} kinds`, href: '#/inventory?tab=list' },
    { label: 'Agents', value: int(agents.length), sub: `${all.filter((a) => a.kind === 'mcp_server').length} MCP servers`, href: '#/inventory?tab=list&kind=agent' },
    { label: 'Registered', value: pct(rs.pct), sub: `${rs.registered} of ${rs.governed} governed · ${rs.awaiting} awaiting approval`, href: '#/registry' },
    { label: 'Shadow', value: int(rs.shadow), sub: `Never registered · ${money(ss.total)} spent by ${ss.count} in 30 days`, href: '#/shadow-ai' },
  ], 2);

  const govRows = KINDS.map(([k, plural]) => {
    const l = all.filter((a) => a.kind === k); if (!l.length) return null;
    const g = l.filter(governed);
    const reg = l.filter((a) => a.registry === 'registered').length;
    return [`<span class="kind">${icon(KIND_ICON[k], 15)}<span>${plural}</span></span>`, miniBar(registrySegs(l, plural, `kind=${k}`), l.length), `<span class="num">${int(l.length)}</span>`, `<span class="num muted">${g.length ? pct(reg / l.length) : '0%'}</span>`];
  }).filter(Boolean);
  const gov = `<h2 class="sect-title">Governance</h2>` + panel({ title: 'Assets by registry status', right: legend([['Registered', 'reg'], ['Awaiting approval', 'wait'], ['Shadow', 'shadow'], ['Not governed', 'ng']]),
    body: table({ cols: [{ label: 'Kind', w: '30%' }, { label: 'Registry' }, { label: 'Assets', cls: 'r', w: '90px' }, { label: 'Registered', cls: 'r', w: '100px' }], rows: govRows }) });

  // Agents panel
  const g = v.group || 'source';
  const q = (v.q || '').toLowerCase();
  const state = v.state || 'all';
  const base = agents.filter((a) => (!q || a.name.toLowerCase().includes(q) || a.source.toLowerCase().includes(q)));
  const filtered = base.filter((a) => state === 'all' || a.stateCat === state);
  const groups = [...groupBy(filtered, GROUPS[g][1])].sort((x, y) => y[1].length - x[1].length);
  const counts = (s) => base.filter((a) => a.stateCat === s).length;
  const agentPanel = panel({ title: 'Agents', desc: 'Every agent discovered, grouped the way you choose. A row filters the inventory to it.',
    right: select('group', Object.entries(GROUPS).map(([k, [l]]) => [k, l]), g, { label: 'Group by', aria: 'Group by' }),
    body: `<div class="toolbar">${search('q', v.q, 'Search agents')}${chips('state', [['all', 'All', base.length], ['active', 'Active', counts('active')], ['draft', 'Draft', counts('draft')], ['inactive', 'Inactive', counts('inactive')], ['na', 'Not applicable', counts('na')]], state)}</div>` +
      table({ cols: [{ label: GROUPS[g][0], w: '32%' }, { label: 'Registry' }, { label: 'Agents', cls: 'r', w: '80px' }, { label: 'Share', w: '22%' }], empty: 'No agents match.',
        rows: groups.map(([name, l]) => {
          const filt = g === 'source' ? `source=${encodeURIComponent(name)}` : g === 'cloud' ? `cloud=${l[0].cloud}` : `q=`;
          return { attrs: `class="row-link" data-act="go" data-href="#/inventory?tab=list&kind=agent&${filt}"`, cells: [`<span class="cloud">${g === 'source' || g === 'cloud' ? cloudIcon(l[0].cloud, 15) : ''}<span>${esc(name)}</span></span>`, miniBar(registrySegs(l, name, `kind=agent&${filt}`), l.length), `<span class="num">${l.length}</span>`, `<span class="share"><i style="width:${(l.length / Math.max(1, filtered.length)) * 100}%"></i><em>${pct(l.length / Math.max(1, filtered.length))}</em></span>`] };
        }) }) });

  // Findings panel
  const byPol = [...groupBy(fs, (f) => f.code)].map(([code, l]) => ({ code, p: l[0].policy, n: l.length })).sort((a, b) => SEV_ORDER[a.p.severity] - SEV_ORDER[b.p.severity] || b.n - a.n);
  const findPanel = panel({ title: 'Findings', desc: 'Configuration worth a second look, from the latest inventory.', right: `<a class="lnk" href="#/findings">All findings</a>`,
    body: `<div class="flist">${byPol.slice(0, 6).map((x) => `<a href="#/findings?check=${x.code}">${sevDot(x.p.severity)}<span class="flist-sev">${x.p.severity}</span><span class="flist-title">${esc(x.p.title)}</span><span class="num">${x.n}</span></a>`).join('')}${byPol.length > 6 ? `<a class="lnk more" href="#/findings">${byPol.length - 6} more</a>` : ''}</div>` });

  const scanCard = lastScan ? panel({ title: 'Latest scan', right: `<a class="lnk" href="#/integrations/scans/${lastScan.id}">Scan details</a>`,
    body: `<div class="scan-card"><span class="cloud">${cloudIcon(lastScan.cloud, 18)}<span><b>${esc(CLOUD_NAME[lastScan.cloud])}</b> · started ${ago(lastScan.startedAt)}</span></span>
      ${lastScan.status === 'running' ? pill('Running', 'blue') : pill('Succeeded', 'green')}
      <div class="scan-nums"><div><small>Duration</small><b>${lastScan.status === 'running' ? '…' : duration(lastScan.durationMs)}</b></div><div><small>Sources read</small><b>${lastScan.sourcesRead}</b></div><div><small>Sources failed</small><b>${lastScan.sourcesFailed}</b></div><div><small>Connection</small><b>${esc(integ ? integ.name : '')}</b></div></div></div>` }) : '';

  return pageHead({ title: 'Overview', desc: 'Your AI estate across every connected cloud: how much of it is governed, what needs a second look, and when it was last scanned.',
    actions: menu('report', 'Estate report', [{ label: 'Open the report', act: 'report', icon: 'eye' }, { label: 'Download as Markdown', act: 'report-dl', icon: 'download' }], { icon: 'report' }) + btn('Run scan', { icon: 'refresh', act: 'scan', perm: 'scan' }) })
    + banner + shortcuts + stats + gov + `<div class="grid-2-1">${agentPanel}<div class="stack">${findPanel}${scanCard}</div></div>`;
}

function reportMd() {
  const all = live(); const rs = registryStats(all); const fs = findings(); const ss = shadowSpend();
  const by = { Critical: 0, High: 0, Medium: 0, Low: 0 }; for (const f of fs) by[f.severity]++;
  return `# Estate report: ${S.settings.displayName}\n\nGenerated by the opencontroller demo (synthetic data).\n\n## Inventory\n- Assets: ${all.length}\n- Agents: ${all.filter((a) => a.kind === 'agent').length}\n- Registered: ${Math.round(rs.pct * 100)}% (${rs.registered} of ${rs.governed} governed, ${rs.awaiting} awaiting approval)\n- Shadow: ${rs.shadow}, ${money(ss.total)} spent by ${ss.count} in 30 days\n\n## Posture\n- Open findings: ${fs.length} (critical ${by.Critical}, high ${by.High}, medium ${by.Medium}, low ${by.Low})\n\n## Spend needing attention\n${needsAttention().slice(0, 10).map((x) => `- ${x.asset.name}: ${money(x.asset.spend30d)} (${x.reasons[0]})`).join('\n')}\n`;
}

export const ROUTES = [{
  path: '/', render, init: () => ({ group: 'source', state: 'all', q: '' }),
  actions: {
    go: (el) => { location.hash = el.dataset.href; },
    scan: () => { const s = runScan(); toast(`Scanning ${s.length} connections. Watch the sidebar.`); track('action', '/', 'Run scan'); },
    report: () => sheet({ title: 'Estate report', sub: 'As of now', body: `<pre class="code">${esc(reportMd())}</pre>`, foot: btn('Download as Markdown', { icon: 'download', act: 'report-dl', kind: 'primary' }) }),
    'report-dl': () => { const blob = new Blob([reportMd()], { type: 'text/markdown' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'estate-report.md'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); track('action', '/', 'Estate report download'); },
  },
}];
