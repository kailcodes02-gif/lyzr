import { pageHead, statCards, panel, table, btn, toggle, pill, modal, field, input, textarea, selectField, toast, esc, icon, empty, kv, menu } from '../ui.mjs';
import { S, runScan, setIntegration, connectIntegration, saveSettings, addOrgTeam, setScanEvery, can, why, prefs, assetByName } from '../store.mjs';
import { ROLES } from '../data.mjs';
import { cloudIcon, CLOUD_NAME } from '../icons.mjs';
import { ago, until, stamp, duration, int, now, MIN } from '../util.mjs';
import { track } from '../../../shared/session.mjs';

const statusPill = (s) => (s === 'running' ? pill('Running', 'blue') : s === 'failed' ? pill('Failed', 'red') : pill('Succeeded', 'green'));

function integrations() {
  const next = S.integrations.filter((i) => i.enabled).map((i) => { const last = S.scans.find((s) => s.integrationId === i.id); return `${i.name} every ${i.scanEvery} min, next ${until((last ? last.startedAt : now()) + i.scanEvery * MIN)}`; });
  return pageHead({ title: 'Integrations', desc: 'The cloud accounts and tenants opencontroller discovers from, whether it can reach each one, and every discovery scan.', actions: btn('Connect', { icon: 'plus', act: 'connect', perm: 'integrations', kind: 'primary' }) })
    + table({ cols: [{ label: 'Name' }, { label: 'Account' }, { label: 'Access' }, { label: 'Enabled' }, { label: 'Actions', cls: 'r' }],
      rows: S.integrations.map((i) => [`<span class="cloud">${cloudIcon(i.cloud, 18)}<span><b>${esc(i.name)}</b><small class="muted block">${esc(CLOUD_NAME[i.cloud])} · ${esc(i.control)} · Guardrails: ${esc(i.guardrails)}</small></span></span>`, `<code class="small">${esc(i.accountLabel)}</code>`, `${pill('Verified', 'green')} <span class="muted small">${ago(i.verified)}</span>`,
        toggle('en', i.enabled, { act: 'enable', data: { id: i.id }, perm: 'integrations', aria: `Enable ${i.name}` }),
        `<div class="btn-row end">${btn('Verify', { sm: true, act: 'verify', data: { id: i.id }, perm: 'verify' })}${btn('Map', { sm: true, href: `#/inventory?mcloud=${i.cloud}` })}${menu(`i-${i.id}`, '', [{ label: 'Scan this connection', act: 'scan-one', data: { id: i.id }, perm: 'scan' }, { label: 'Copy connection ID', act: 'copy', data: { text: i.id } }], { icon: 'more', noCaret: true, sm: true, right: true, aria: `More for ${i.name}` })}</div>`]) })
    + panel({ title: 'Guardrails only', desc: 'Cloud guardrail services opencontroller can call, without discovering from the account.', body: `<div class="rows">${['AWS Bedrock Guardrails', 'Azure AI Content Safety', 'Google Model Armor'].map((n) => `<div class="row"><b>${n}</b><span class="grow"></span><span class="muted">None yet.</span></div>`).join('')}</div>` })
    + panel({ title: 'Discovery scans', desc: `Automatic · ${esc(next.slice(0, 3).join(', '))}…`, right: `<a class="lnk" href="#/settings/scan-schedule">Details</a>${btn('Run scan', { icon: 'refresh', act: 'scan', perm: 'scan' })}`,
      body: table({ cols: [{ label: 'Status' }, { label: 'Provider' }, { label: 'Started' }, { label: 'Duration', cls: 'r' }, { label: 'Sources read', cls: 'r' }, { label: 'Failed', cls: 'r' }],
        rows: S.scans.slice(0, 50).map((s) => { const i = S.integrations.find((x) => x.id === s.integrationId) || { name: '' }; return { attrs: `class="row-link" data-act="go" data-href="#/integrations/scans/${s.id}"`, cells: [statusPill(s.status), `<span class="cloud">${cloudIcon(s.cloud, 14)}<code>${esc(s.cloud.toUpperCase())}</code><span class="muted">· ${esc(i.name)}</span></span>`, `<span class="muted">${ago(s.startedAt)}</span>`, `<span class="num">${s.status === 'running' ? '…' : duration(s.durationMs)}</span>`, `<span class="num">${s.sourcesRead}</span>`, `<span class="num">${s.sourcesFailed}</span>`] }; }) }) });
}

function scanPage(ctx) {
  const s = S.scans.find((x) => x.id === ctx.params[0]);
  if (!s) return empty('No such scan', 'Only the latest 60 scans are kept in the demo.', btn('Integrations', { href: '#/integrations' }));
  const v = ctx.v;
  const shown = v.empty ? s.sources : s.sources.filter((x) => x.assets > 0);
  const hidden = s.sources.length - s.sources.filter((x) => x.assets > 0).length;
  const newAssets = S.assets.filter((a) => a.newThisScan && a.integrationId === s.integrationId && a.firstDiscovered >= s.startedAt);
  return `<a class="crumb-back" href="#/integrations">${icon('back', 14)}Integrations</a>`
    + pageHead({ title: `${s.cloud.toUpperCase()} scan`, desc: `Started ${stamp(s.startedAt)} · ${s.status === 'running' ? 'running…' : duration(s.durationMs)}`, right: statusPill(s.status) })
    + statCards([{ label: 'Sources read', value: int(s.sourcesRead) }, { label: 'Sources failed', value: int(s.sourcesFailed) }, { label: 'Assets reported', value: int(s.sources.reduce((a, x) => a + x.assets, 0)) }], 3)
    + (newAssets.length ? `<div class="banner banner-blue">${icon('sparkles', 15)}<span>New in this scan: ${newAssets.map((a) => `<a class="lnk" href="#/inventory/${a.id}">${esc(a.name)}</a>`).join(', ')}. ${newAssets.length === 1 ? 'It is' : 'They are'} shadow until someone registers ${newAssets.length === 1 ? 'it' : 'them'}.</span></div>` : '')
    + panel({ title: 'Sources', right: toggle('empty', v.empty, { label: 'Show empty sources' }), desc: hidden && !v.empty ? `${hidden} read fine and found nothing; they are hidden.` : '',
      body: table({ cols: [{ label: 'Account' }, { label: 'Region' }, { label: 'Family' }, { label: 'Assets', cls: 'r' }], rows: shown.map((x) => [esc(x.account), esc(x.region), `<code>${esc(x.family)}</code>`, `<span class="num">${x.assets}</span>`]), empty: s.status === 'running' ? 'Reading the first sources…' : 'Every source found nothing.' }) });
}

// ---------------- settings ----------------
const SETTINGS_NAV = [['Organization', [['general', 'General'], ['roles', 'Roles'], ['teams', 'Teams']]], ['Discovery', [['scan-schedule', 'Scan schedule']]], ['Security', [['audit-log', 'Audit log']]], ['Modules', [['guardrails', 'Guardrails']]]];
function settings(ctx) {
  const tab = ctx.params[0];
  const nav = `<aside class="subnav">${SETTINGS_NAV.map(([g, items]) => `<p class="nav-group-label">${g}</p>${items.map(([k, l]) => `<a class="nav-item${tab === k ? ' on' : ''}" href="#/settings/${k}">${l}</a>`).join('')}`).join('')}</aside>`;
  let body = '';
  if (tab === 'general') body = pageHead({ title: 'General', desc: 'The organization opencontroller runs for.' }) + `<form data-form="general">${panel({ body: `<div class="form-grid one">${field('Organization ID', `<input value="${esc(S.settings.orgId)}" disabled>`, 'Set when the organization was made; it never changes.')}${field('Display name', `<input name="displayName" value="${esc(S.settings.displayName)}"${can('settings') ? '' : ' disabled'}>`)}${field('Description <span class="muted">optional</span>', `<textarea name="description" rows="2"${can('settings') ? '' : ' disabled'}>${esc(S.settings.description)}</textarea>`)}</div><div class="btn-row">${btn('Save', { submit: true, kind: 'primary', perm: 'settings' })}</div>` })}</form>`;
  if (tab === 'roles') body = pageHead({ title: 'Roles', desc: 'What each role may see and change. Use the role switch in the top bar to try each one.', actions: btn('Add role', { icon: 'plus', act: 'add-role', perm: 'addRole' }) })
    + table({ cols: [{ label: 'Name' }, { label: 'Description' }, { label: 'Type' }, { label: 'Permissions' }, { label: '', cls: 'r' }], rows: ROLES.map((r) => [`<b>${r.name}</b>${r.name === prefs.role ? ' ' + pill('You, now', 'blue') : ''}`, esc(r.description), pill(r.type, 'grey'), `<span class="num">${r.permissions} of 67</span>`, btn(r.name === prefs.role ? 'Current' : 'View as', { sm: true, act: 'view-as', data: { r: r.name }, disabled: r.name === prefs.role })]) });
  if (tab === 'teams') body = pageHead({ title: 'Teams', desc: 'Groups that own agents, linked to groups in your identity provider.', actions: btn('New team', { icon: 'plus', act: 'new-team', perm: 'settings' }) })
    + (S.orgTeams.length ? table({ cols: [{ label: 'Team' }, { label: 'Identity provider group' }, { label: 'Made' }], rows: S.orgTeams.map((t) => [`<b>${esc(t.name)}</b>`, `<code>${esc(t.group || '—')}</code>`, `<span class="muted">${ago(t.at)}</span>`]) }) : `<div class="hero-empty">${icon('users', 26)}<h2>No teams yet</h2><p class="muted">Make one for each group that owns agents, and link it to that group in your identity provider.</p>${btn('New team', { icon: 'plus', act: 'new-team', perm: 'settings', kind: 'primary' })}</div>`);
  if (tab === 'scan-schedule') body = pageHead({ title: 'Scan schedule', desc: 'How often each connection is scanned. Only administrators change the schedule.' })
    + table({ cols: [{ label: 'Connection' }, { label: 'Every' }, { label: 'Next scan' }, { label: 'Last scan' }], rows: S.integrations.map((i) => { const last = S.scans.find((s) => s.integrationId === i.id); return [`<span class="cloud">${cloudIcon(i.cloud, 15)}<span><b>${esc(i.name)}</b><small class="muted block">${esc(i.accountLabel)}</small></span></span>`, can('scanSchedule') ? `<span class="sel sel-inline"><select data-act="every" data-id="${i.id}" aria-label="Scan every">${[5, 15, 30, 60, 360].map((m) => `<option value="${m}"${i.scanEvery === m ? ' selected' : ''}>${m < 60 ? `${m} min` : `${m / 60} h`}</option>`).join('')}</select>${icon('down', 12)}</span>${i.scanEvery === 5 ? ' ' + pill('Default', 'grey') : ''}` : `${i.scanEvery} min ${i.scanEvery === 5 ? pill('Default', 'grey') : ''}`, i.enabled ? until((last ? last.startedAt : now()) + i.scanEvery * MIN) : '<span class="muted">Disabled</span>', last ? `${ago(last.startedAt)} ${statusPill(last.status)}` : '—']; }) });
  if (tab === 'audit-log') {
    const q = (ctx.v.q || '').toLowerCase();
    const l = S.audit.filter((a) => !q || `${a.action} ${a.asset} ${a.actor} ${a.reason}`.toLowerCase().includes(q));
    body = pageHead({ title: 'Audit log', desc: 'Every change anyone made, with the reason they gave. Your own changes in this demo are here too.' }) + `<div class="toolbar"><label class="search">${icon('search', 15)}<input data-bind="q" value="${esc(ctx.v.q || '')}" placeholder="Search actions, assets and people" aria-label="Search the audit log"></label></div>`
      + `<div class="timeline">${l.map((a) => { const as = a.assetId ? S.assets.find((x) => x.id === a.assetId) : assetByName(a.asset); return `<div class="tl-item${a.actor === ctx.session.email ? ' mine' : ''}"><div class="tl-head"><b>${esc(a.action)}</b>${a.asset ? ` · ${as ? `<a class="lnk" href="#/inventory/${as.id}">${esc(a.asset)}</a>` : esc(a.asset)}` : ''}</div><p class="muted small">${ago(a.at)} · ${esc(a.actor)}${a.actor === ctx.session.email ? ' (you)' : ''}</p>${a.reason ? `<p class="tl-reason">“${esc(a.reason)}”</p>` : ''}${a.outcome ? `<p class="small t-muted2">${icon('right', 12)} ${esc(a.outcome)}</p>` : ''}</div>`; }).join('') || '<p class="muted">Nothing matches.</p>'}</div>`;
  }
  if (tab === 'guardrails') body = pageHead({ title: 'Guardrails', desc: 'The engine that runs guardrails, and the cloud guardrail services it can call.' })
    + panel({ title: 'Guardrail engine', right: btn('Check', { sm: true, act: 'check-engine' }), body: `<p>${pill('Answering', 'green')} · ${S.guardrails.length} guardrails</p>` })
    + panel({ title: 'Cloud credentials', right: `<a class="lnk" href="#/integrations">Manage in Integrations</a>`, body: kv([['AWS Bedrock Guardrails', '<span class="muted">None</span>'], ['Azure AI Content Safety', '<span class="muted">None</span>'], ['Google Model Armor', '<span class="muted">None</span>']]) });
  return `<div class="split settings">${nav}<div>${body}</div></div>`;
}

export const ROUTES = [
  { path: '/integrations', render: integrations, actions: {
    go: (el) => { location.hash = el.dataset.href; },
    scan: () => { const s = runScan(); toast(`Scanning ${s.length} connections.`); track('action', '/integrations', 'Run scan'); },
    'scan-one': (el) => { const [s] = runScan([el.dataset.id]); location.hash = `#/integrations/scans/${s.id}`; track('action', '/integrations', 'Scan one'); },
    verify: (el) => { setIntegration(el.dataset.id, { verified: now() }); toast('Verified: read access works.'); },
    enable: (el) => { setIntegration(el.dataset.id, { enabled: el.checked }); toast(el.checked ? 'Enabled: scans resume.' : 'Disabled: no more scans until you turn it back on.'); },
    connect: () => modal({ title: 'Connect a cloud', wide: true,
      body: `<p class="muted">opencontroller reads with a read-only role or app. In the demo, any account name works; the scan that follows is simulated.</p>${field('Cloud', selectField('cloud', [['aws', 'AWS'], ['microsoft', 'Microsoft (Entra tenant)'], ['gcp', 'Google Cloud'], ['databricks', 'Databricks'], ['anthropic', 'Anthropic'], ['snowflake', 'Snowflake']], 'aws'))}${field('Name', input('name', { placeholder: 'aws-prod', required: true }))}${field('Account', input('account', { placeholder: 'Account ID, tenant ID, project or workspace host' }))}${field('Credentials', textarea('cred', { rows: 3, mono: true, placeholder: 'arn:aws:iam::123456789012:role/opencontroller-read' }), 'Never stored in the demo.')}`,
      submit: 'Verify and connect',
      onSubmit: (d) => { if (!(d.name || '').trim()) return 'Name the connection.'; if (!(d.account || '').trim()) return 'Enter the account.'; if (!(d.cred || '').trim()) return 'Paste the role, app or key it reads with.'; const i = connectIntegration({ name: d.name.trim(), cloud: d.cloud, account: d.account.trim() }); toast(`Connected ${i.name}. Its first scan is running.`); track('action', '/integrations', `Connect ${d.cloud}`); } }),
  } },
  { path: /^\/integrations\/scans\/(scn_[0-9a-f]+)$/, render: scanPage, live: true },
  { path: /^\/settings\/(general|roles|teams|scan-schedule|audit-log|guardrails)$/, render: settings, actions: {
    'form:general': (f) => { saveSettings({ displayName: f.displayName.value.trim() || S.settings.displayName, description: f.description.value.trim() }); toast('Saved.'); },
    'view-as': (el, ctx) => { ctx.store.setPref('role', el.dataset.r); toast(`Now viewing as ${el.dataset.r}.`); },
    'add-role': () => toast('Custom roles: pick from the 67 permissions. Not in the demo.'),
    'new-team': () => modal({ title: 'New team', body: `${field('Name', input('name', { required: true }))}${field('Identity provider group', input('group', { placeholder: 'sg-ai-platform' }))}`, submit: 'Make it', onSubmit: (d) => { if (!(d.name || '').trim()) return 'Name the team.'; addOrgTeam({ name: d.name.trim(), group: (d.group || '').trim() }); toast('Team made.'); } }),
    'check-engine': () => toast('The guardrail engine answered in 41 ms.'),
    every: (el) => { setScanEvery(el.dataset.id, Number(el.value)); toast('Schedule saved.'); },
  } },
];
