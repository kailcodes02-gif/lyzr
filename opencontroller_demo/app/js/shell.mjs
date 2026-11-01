// The frame around every screen: the sidebar (main, or a module's own with ← Back), the demo bar,
// the "About this screen" card and the Ask Ctrl panel.
import { esc, icon } from './ui.mjs';
import { S, prefs, registryStats, running } from './store.mjs';
import { EXPLAIN, TOUR, explainKey } from './explain.mjs';
import { suggestions } from './ctrl.mjs';
import { BOOK_DEMO_URL } from '../../shared/session.mjs';
import { CLOUD_NAME } from './icons.mjs';

const MAIN = [
  { href: '#/', label: 'Overview', icon: 'overview', match: (p) => p === '/' },
  { href: '#/spend', label: 'Spend', icon: 'spend', match: (p) => p.startsWith('/spend') },
  { act: 'ctrl-open', label: 'Ask Ctrl', icon: 'ask' },
  { group: 'Discover', items: [
    { href: '#/inventory', label: 'AI Inventory', icon: 'inventory', match: (p) => p.startsWith('/inventory') },
    { href: '#/shadow-ai', label: 'Shadow AI', icon: 'shadow', match: (p) => p === '/shadow-ai', badge: () => [registryStats().shadow, 'red'] },
  ] },
  { group: 'Govern', items: [
    { href: '#/approvals', label: 'Approvals', icon: 'approvals', match: (p) => p === '/approvals', badge: () => [S.approvals.filter((a) => a.status === 'pending').length, 'amber'] },
    { href: '#/registry', label: 'Registry', icon: 'registry', match: (p) => p === '/registry' },
    { label: 'Skills', icon: 'skills', nest: 'skills', match: (p) => p.startsWith('/skills'), items: [
      { href: '#/skills', label: 'Skills', match: (p) => p === '/skills' || /^\/skills\/sk_/.test(p) },
      { href: '#/skills/marketplace', label: 'Marketplace', match: (p) => p === '/skills/marketplace' },
      { href: '#/skills/settings', label: 'Settings', match: (p) => p === '/skills/settings' },
    ] },
  ] },
  { group: 'Runtime', items: [
    { href: '#/llm-gateway', label: 'LLM Gateway', icon: 'gateway', chevron: true },
    { href: '#/guardrails', label: 'Guardrails', icon: 'guardrails', match: (p) => p.startsWith('/guardrails') },
  ] },
  { group: 'Posture', items: [
    { href: '#/findings', label: 'Findings', icon: 'findings', match: (p) => p === '/findings' },
    { href: '#/posture/policies', label: 'Security policies', icon: 'policies', match: (p) => p === '/posture/policies' },
  ] },
  { group: 'Monitor', items: [
    { href: '#/observability', label: 'Observability', icon: 'observability', chevron: true },
    { href: '#/evals', label: 'Evals', icon: 'evals', chevron: true },
  ] },
  { group: 'Improve', items: [{ href: '#/fine-tuning', label: 'Fine-tuning', icon: 'finetune', chevron: true }] },
];

export const GW_GROUPS = {
  Traffic: ['Tool Calls', 'OpenTelemetry', 'OTLP Destinations', 'Alert Channels', 'Log Settings'],
  Routing: ['Model Catalog', 'Adaptive Routing', 'Complexity Router', 'Semantic Routes', 'Classifier Routing', 'Classifier Tags', 'Classifier Playground', 'Routing Insights', 'API Services', 'API Policies', 'Identity Providers', 'Tool Policies', 'Budgets & Limits', 'Pricing Overrides', 'Model Settings'],
  Tools: ['MCP Library', 'Tool Groups', 'MCP Sessions', 'MCP Settings'],
  Access: ['Members', 'Business Units', 'Provisioning (SCIM)', 'Roles', 'Access Profiles', 'Gateway Audit'],
  'API Hub': ['API Products', 'Access Requests', 'Approval Flows'],
  Policies: ['Guardrail Providers', 'LLM Policies', 'Rego Modules', 'Policy Decision Point', 'Policy Blocks', 'Plugins', 'Prompts'],
  System: ['Client Settings', 'Compatibility', 'Caching', 'Security', 'Outbound Proxy', 'Scoped API Keys', 'Performance', 'Feature Flags'],
};
export const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const MODULES = {
  gateway: { prefix: '/llm-gateway', title: 'LLM Gateway', sub: 'On Rekori', items: [
    ['', 'Overview', 'overview'], ['/virtual-keys', 'Virtual Keys', 'key'], ['/teams', 'Teams & Customers', 'building'], ['/logs', 'Logs', 'logs'],
    ['/providers', 'Providers', 'mcp'], ['/routing-rules', 'Routing Rules', 'route'], ['/mcp-servers', 'MCP Servers', 'tool'], ['/content-rules', 'Content Rules', 'guardrails']], groups: GW_GROUPS },
  observability: { prefix: '/observability', title: 'Observability', sub: 'On ClickHouse', items: [['', 'Overview', 'overview'], ['/projects', 'Projects', 'projects'], ['/cost', 'Cost', 'spend']] },
  evals: { prefix: '/evals', title: 'Evals', sub: "Judging your agents' traces", items: [['', 'Overview', 'overview'], ['/evaluators', 'Evaluators', 'evals'], ['/tasks', 'Tasks', 'list'], ['/scores', 'Scores', 'check'], ['/monitors', 'Monitors', 'pulse'], ['/datasets', 'Datasets', 'memory'], ['/prompts', 'Prompts', 'chat'], ['/connections', 'Connections', 'integrations']] },
  finetune: { prefix: '/fine-tuning', title: 'Fine-tuning', sub: 'On OpenFinetuner', items: [['', 'Studio', 'finetune']] },
};
export function moduleOf(path) {
  for (const [k, m] of Object.entries(MODULES)) if (path === m.prefix || path.startsWith(m.prefix + '/')) return k;
  return null;
}

function navItem(it, path) {
  const on = it.match ? it.match(path) : false;
  if (it.act) return `<button type="button" class="nav-item" data-act="${it.act}">${icon(it.icon, 17)}<span>${esc(it.label)}</span></button>`;
  if (it.nest) {
    const open = prefs.collapsed[`nest-${it.nest}`] === false || (prefs.collapsed[`nest-${it.nest}`] !== true && on);
    return `<button type="button" class="nav-item${on && !open ? ' on' : ''}" data-act="nav-nest" data-key="${it.nest}" aria-expanded="${open}">${icon(it.icon, 17)}<span>${esc(it.label)}</span>${icon(open ? 'down' : 'right', 14, 'nav-chev')}</button>
      ${open ? `<div class="nav-sub">${it.items.map((s) => `<a class="nav-item sub${s.match(path) ? ' on' : ''}" href="${s.href}">${esc(s.label)}</a>`).join('')}</div>` : ''}`;
  }
  const badge = it.badge ? it.badge() : null;
  return `<a class="nav-item${on ? ' on' : ''}" href="${it.href}"${on ? ' aria-current="page"' : ''}>${icon(it.icon, 17)}<span>${esc(it.label)}</span>${badge && badge[0] ? `<span class="nav-badge ${badge[1]}"><i></i>${badge[0]}</span>` : ''}${it.chevron ? icon('right', 14, 'nav-chev') : ''}</a>`;
}

function footer(session) {
  return `<div class="side-foot">
    <div class="side-user"><b>${esc(session.email)}</b><span>${esc(prefs.role)}</span></div>
    <div class="side-tools"><span class="live"><i></i>live · v0.134.1</span>
      <span class="side-icons">
        <button type="button" class="icon-btn" data-act="theme" title="Toggle theme" aria-label="Toggle theme">${icon('sun', 15)}</button>
        <button type="button" class="icon-btn" data-act="password" title="Change password" aria-label="Change password">${icon('key', 15)}</button>
        <button type="button" class="icon-btn" data-act="signout" title="Sign out" aria-label="Sign out">${icon('logout', 15)}</button>
        <button type="button" class="icon-btn" data-act="collapse" title="Collapse navigation" aria-label="Collapse navigation">${icon('panel', 15)}</button>
      </span></div></div>`;
}

export function sidebar(route, session) {
  const path = route.path;
  const mod = moduleOf(path);
  const brand = `<a class="brand" href="#/"><span class="mark">oc</span><span>opencontroller</span></a>`;
  let nav = '';
  if (mod) {
    const m = MODULES[mod];
    nav = `<a class="nav-item back" href="#/">${icon('back', 16)}<span>Back</span></a><div class="mod-title"><b>${m.title}</b><span>${esc(m.sub)}</span></div><div class="nav-sep"></div>`;
    nav += m.items.map(([suffix, label, ic]) => {
      const href = m.prefix + suffix;
      const on = suffix === '' ? path === m.prefix : path.startsWith(href) || (mod === 'observability' && suffix === '/projects' && path.startsWith('/observability/p/'));
      return `<a class="nav-item${on ? ' on' : ''}" href="#${href}">${icon(ic, 17)}<span>${esc(label)}</span></a>`;
    }).join('');
    if (mod === 'observability') nav += `<p class="nav-group-label">Recent projects</p><a class="nav-item sub" href="#/observability/p/${S && 'prj_9f2c41a7e0b3'}/overview">nordic-capital</a>`;
    if (m.groups) nav += Object.entries(m.groups).map(([g, items]) => {
      const open = prefs.collapsed[`gw-${g}`] === false || items.some((i) => path === `${m.prefix}/${slug(i)}`);
      return `<button type="button" class="nav-group" data-act="nav-group" data-key="gw-${esc(g)}" aria-expanded="${open}"><span>${esc(g)}</span>${icon(open ? 'down' : 'right', 14)}</button>${open ? `<div class="nav-sub">${items.map((i) => `<a class="nav-item sub${path === `${m.prefix}/${slug(i)}` ? ' on' : ''}" href="#${m.prefix}/${slug(i)}">${esc(i)}</a>`).join('')}</div>` : ''}`;
    }).join('');
  } else {
    nav = MAIN.map((it) => {
      if (!it.group) return navItem(it, path);
      const closed = prefs.collapsed[`grp-${it.group}`] === true;
      return `<button type="button" class="nav-group" data-act="nav-group" data-key="grp-${it.group}" aria-expanded="${!closed}"><span>${it.group}</span>${icon(closed ? 'right' : 'down', 14)}</button>${closed ? '' : it.items.map((x) => navItem(x, path)).join('')}`;
    }).join('');
    const r = running();
    nav += `<div class="nav-sep"></div>`;
    if (r.length) nav += `<a class="nav-item scanning" href="#/integrations/scans/${r[0].id}"><span class="spinner"></span><span>Scanning · ${r.reduce((a, s) => a + s.sourcesRead, 0)} sources</span></a>`;
    nav += `<a class="nav-item${path.startsWith('/integrations') ? ' on' : ''}" href="#/integrations">${icon('integrations', 17)}<span>Integrations</span></a>`;
    nav += `<a class="nav-item${path.startsWith('/settings') ? ' on' : ''}" href="#/settings/general">${icon('settings', 17)}<span>Settings</span></a>`;
  }
  return `<div class="side-top">${brand}</div><nav class="side-nav" aria-label="Main">${nav}</nav>${footer(session)}`;
}

export function demoBar(session) {
  const roles = ['Owner', 'Admin', 'Operator', 'Viewer'];
  return `<div class="demobar">
    <button type="button" class="icon-btn mob-only" data-act="mobile-nav" aria-label="Open navigation">${icon('list', 18)}</button>
    <span class="demo-tag">${icon('sparkles', 14)}<span>Interactive demo</span><span class="muted hide-sm">· synthetic data, changes stay in your browser</span></span>
    <span class="grow"></span>
    <label class="role-pick" title="See the same screens as each role sees them">${icon('user', 14)}<span class="hide-sm">Viewing as</span><span class="sel sel-inline"><select data-act="role" aria-label="Role">${roles.map((r) => `<option${r === prefs.role ? ' selected' : ''}>${r}</option>`).join('')}</select>${icon('down', 12)}</span></label>
    <button type="button" class="btn btn-sm btn-ghost hide-sm" data-act="tour-start">${icon('play', 13)}<span>Guided tour</span></button>
    <button type="button" class="btn btn-sm btn-ghost hide-sm" data-act="reset" title="Put every change back">${icon('undo', 13)}<span>Reset</span></button>
    <a class="btn btn-sm btn-primary" href="${BOOK_DEMO_URL}" target="_blank" rel="noopener" data-act="book">${icon('calendar', 13)}<span>Book a demo</span></a>
  </div>`;
}

export function explainer(route) {
  const key = explainKey(route);
  const e = EXPLAIN[key];
  if (!e) return '';
  const step = TOUR.findIndex((t) => t[0] === key);
  const next = step >= 0 && step < TOUR.length - 1 ? TOUR[step + 1] : null;
  const prev = step > 0 ? TOUR[step - 1] : null;
  // On a phone the card starts folded away; "About this screen" opens it.
  const narrow = typeof matchMedia === 'function' && matchMedia('(max-width: 700px)').matches;
  const open = prefs.explain && !prefs.seen[`min-${key}`] && (!narrow || prefs.seen[`open-${key}`]);
  if (!open) return `<button type="button" class="explain-fab" data-act="explain-open" data-key="${key}" aria-label="About this screen">${icon('help', 16)}<span>About this screen</span></button>`;
  return `<aside class="explain" role="complementary" aria-label="About this screen">
    <div class="explain-head"><span class="explain-eyebrow">${step >= 0 ? `Stop ${step + 1} of ${TOUR.length}` : 'About this screen'}</span><button type="button" class="icon-btn" data-act="explain-min" data-key="${key}" aria-label="Hide">${icon('x', 14)}</button></div>
    <h3>${esc(e.title)}</h3><p>${esc(e.what)}</p>
    ${e.how && e.how.length ? `<ul>${e.how.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>` : ''}
    ${e.try ? `<div class="explain-try">${icon('zap', 14)}<span><b>Try it:</b> ${esc(e.try)}</span></div>` : ''}
    <div class="explain-foot">${prev ? `<a href="${prev[1]}" class="btn btn-sm">${icon('left', 13)}<span>${esc(prev[2])}</span></a>` : '<span></span>'}${next ? `<a href="${next[1]}" class="btn btn-sm btn-primary"><span>Next: ${esc(next[2])}</span>${icon('right', 13)}</a>` : step === TOUR.length - 1 ? `<a class="btn btn-sm btn-primary" href="${BOOK_DEMO_URL}" target="_blank" rel="noopener" data-act="book"><span>Book a demo</span>${icon('arrow', 13)}</a>` : `<a href="#/" class="btn btn-sm"><span>Overview</span></a>`}</div>
    <button type="button" class="explain-off" data-act="explain-off">Stop showing these on every screen</button>
  </aside>`;
}

export function ctrlPanel(route, thread) {
  const key = explainKey(route);
  return `<aside class="ctrl" aria-label="Ask Ctrl">
    <div class="ctrl-head"><span>${icon('ask', 16)}<b>Ctrl</b><small>anthropic/claude-sonnet-5-5</small></span><button type="button" class="icon-btn" data-act="ctrl-close" aria-label="Close">${icon('x', 15)}</button></div>
    <div class="ctrl-body" id="ctrl-body">
      <p class="muted">Ask about your agents, clouds, scans or connections. I look things up live, can open the page that shows the answer, and ask before I run anything.</p>
      ${thread.map((m) => `<div class="msg ${m.role}">${m.role === 'user' ? esc(m.text) : m.html}${m.link ? `<a class="msg-link" href="${esc(m.link[1])}">${esc(m.link[0])} ${icon('arrow', 12)}</a>` : ''}</div>`).join('')}
      <div class="ctrl-sugg">${suggestions(key).map((s) => `<button type="button" data-act="ctrl-ask" data-q="${esc(s)}">${esc(s)}</button>`).join('')}</div>
    </div>
    <form class="ctrl-foot" data-form="ctrl"><input name="q" placeholder="Ask Ctrl anything about opencontroller…" autocomplete="off" aria-label="Ask Ctrl"><button type="submit" class="icon-btn" aria-label="Send" disabled>${icon('send', 15)}</button></form>
  </aside>`;
}

export { CLOUD_NAME };
