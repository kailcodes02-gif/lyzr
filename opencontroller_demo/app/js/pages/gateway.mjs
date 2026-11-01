import { pageHead, statCards, panel, table, btn, select, search, tabs, pill, modal, sheet, field, input, selectField, toast, esc, icon, empty, kv, menu } from '../ui.mjs';
import { S, createKey, deleteKey, createTeam, prefs, can } from '../store.mjs';
import { stackedBars } from '../charts.mjs';
import { money, money4, int, pct, ago, timeLabel, dayLabel, now, HOUR, DAY, MIN } from '../util.mjs';
import { GW_GROUPS, slug } from '../shell.mjs';
import { track } from '../../../shared/session.mjs';

const WINDOWS = [['1h', 'Last hour', HOUR], ['24h', 'Last 24 hours', DAY], ['7d', 'Last 7 days', 7 * DAY], ['30d', 'Last 30 days', 30 * DAY]];
const win = (v) => (WINDOWS.find((w) => w[0] === (v.win || '24h')) || WINDOWS[1]);
const logsIn = (v) => S.gwLogs.filter((l) => now() - l.at <= win(v)[2]);
const PROVIDER_MODELS = { anthropic: ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5', 'claude-fable-5-1'], openai: ['gpt-5.4-mini', 'gpt-4o-mini', 'gpt-5', 'o4-mini'], azure: ['opencontroller-gateway-3415/gpt-4.1', 'opencontroller-gateway-3415/gpt-4o'], 'lyzr-studio': ['lyzr-default'] };

const budgetBar = (b) => (b ? `<div class="budget"><span>${money(b.spent)} of ${money(b.limit)} ${esc(b.period)}</span><i><b style="width:${Math.min(100, (b.spent / b.limit) * 100)}%" class="${b.spent / b.limit > 0.8 ? 'hot' : ''}"></b></i></div>` : '<span class="muted">No budget</span>');
const mayCall = (k) => (k.mayCall.length ? k.mayCall.map((m) => `${esc(m.provider)} <span class="muted">(${m.models === 'every' ? 'every model' : esc(m.models.join(', '))})</span>`).join(' · ') : '<span class="muted">Nothing</span>');

function overview({ v }) {
  const logs = logsIn(v);
  const ok = logs.filter((l) => l.status === 'succeeded');
  const w = win(v);
  const buckets = w[0] === '1h' ? 12 : w[0] === '24h' ? 24 : w[0] === '7d' ? 7 : 30;
  const size = w[2] / buckets;
  const vals = Array.from({ length: buckets }, (_, i) => logs.filter((l) => Math.floor((now() - l.at) / size) === buckets - 1 - i).reduce((a, l) => a + l.cost, 0));
  const labels = Array.from({ length: buckets }, (_, i) => { const t = now() - (buckets - 1 - i) * size; return w[2] <= DAY ? timeLabel(t) : dayLabel(t); });
  const closest = S.vkeys.filter((k) => k.budget).sort((a, b) => b.budget.spent / b.budget.limit - a.budget.spent / a.budget.limit).slice(0, 6);
  return pageHead({ title: 'LLM Gateway', desc: 'The gateway in front of the models your agents call: what went through it, what it cost, and who is closest to their budget.', right: select('win', WINDOWS.map(([k, l]) => [k, l]), w[0], { aria: 'Window' }) })
    + statCards([{ label: 'Calls', value: int(logs.length) }, { label: 'Succeeded', value: pct(logs.length ? ok.length / logs.length : 0, 1) }, { label: 'Average latency', value: `${int(logs.length ? logs.reduce((a, l) => a + l.latencyMs, 0) / logs.length : 0)} ms` }, { label: 'Cost', value: money(logs.reduce((a, l) => a + l.cost, 0)) }])
    + `<h2 class="sect-title">Spend</h2><p class="desc">Cost per period, ${w[1].toLowerCase()}.</p>` + panel({ body: stackedBars({ series: [{ name: 'Cost', color: 'var(--c-accent)', values: vals }], labels, height: 170, fmt: (x) => money4(x) }) })
    + `<div class="grid-2">` + panel({ title: 'Providers', desc: `All ${S.vkeys && 4} up`, right: `<a class="lnk" href="#/llm-gateway/providers">All providers</a>`, body: `<div class="rows">${['anthropic', 'azure', 'lyzr-studio', 'openai'].map((p) => `<div class="row"><span class="dot green"></span><b>${p}</b></div>`).join('')}</div>` })
    + panel({ title: 'MCP servers', desc: '1 of 4 need attention', right: `<a class="lnk" href="#/llm-gateway/mcp-servers">All MCP servers</a>`, body: `<div class="rows">${[['deepwiki', 'healthy', 3], ['pocdeepwiki', 'disabled', 3], ['pocgithub', 'disabled', 28], ['pocghuser', 'disabled', 28]].map(([n, s, t]) => `<div class="row"><span class="dot ${s === 'healthy' ? 'green' : 'grey'}"></span><b>${n}</b><span class="muted">${s} · ${t} tools</span></div>`).join('')}</div>` }) + `</div>`
    + `<div class="grid-2">` + panel({ title: 'Closest to budget', right: `<a class="lnk" href="#/llm-gateway/virtual-keys">Virtual keys</a>`, body: `<div class="rows">${closest.map((k) => `<div class="row col"><b>${esc(k.name)}</b>${budgetBar(k.budget)}</div>`).join('') || '<p class="muted">No key has a budget.</p>'}</div>` })
    + panel({ title: 'Latest calls', right: `<a class="lnk" href="#/llm-gateway/logs">All logs</a>`, body: `<div class="rows">${S.gwLogs.slice(0, 6).map((l) => `<div class="row"><code>${esc(l.model)}</code><span class="grow"></span>${l.status === 'succeeded' ? pill('Succeeded', 'green') : pill('Failed', 'red')}<span class="muted">${ago(l.at)}</span></div>`).join('')}</div>` }) + `</div>`;
}

function keys() {
  return pageHead({ title: 'Virtual keys', desc: 'The keys agents and teams call the gateway with: which providers and models each may reach, and how much it may spend.', actions: btn('New key', { icon: 'plus', act: 'new-key', perm: 'newKey', kind: 'primary' }) })
    + table({ cols: [{ label: 'Name' }, { label: 'Key' }, { label: 'Belongs to' }, { label: 'May call', w: '34%' }, { label: 'Budget', w: '200px' }, { label: '', cls: 'r', w: '50px' }],
      rows: S.vkeys.map((k) => [`<b>${esc(k.name)}</b>`, `<code>${esc(k.keyMasked)}</code>`, k.belongsTo ? esc(k.belongsTo) : '<span class="muted">—</span>', mayCall(k), budgetBar(k.budget),
        menu(`k-${k.id}`, '', [{ label: 'Copy key ID', act: 'copy', data: { text: k.id } }, { label: 'Delete', act: 'del-key', data: { id: k.id }, perm: 'newKey', danger: true }], { icon: 'more', noCaret: true, sm: true, right: true, aria: `More for ${k.name}` })]) });
}

function teams({ v }) {
  const tab = v.tab || 'team';
  const list = S.gwTeams.filter((t) => t.kind === tab);
  return pageHead({ title: 'Teams & Customers', desc: 'Group virtual keys so spend rolls up, and cap a whole team or customer with one budget.', actions: btn(tab === 'team' ? 'New team' : 'New customer', { icon: 'plus', act: 'new-team', perm: 'newTeam', kind: 'primary' }) })
    + tabs('tab', [['team', 'Teams'], ['customer', 'Customers']], tab)
    + table({ cols: [{ label: 'Name' }, { label: 'Customer' }, { label: 'Budget' }, { label: 'Rate limit' }], empty: tab === 'team' ? 'No teams yet.' : 'No customers yet.', rows: list.map((t) => [`<b>${esc(t.name)}</b>`, t.customer ? esc(t.customer) : '<span class="muted">—</span>', t.budget ? `${money(t.budget)} a month` : '<span class="muted">No budget</span>', t.rate ? `${int(t.rate)} calls a minute` : '<span class="muted">No rate limit</span>']) });
}

function logs({ v }) {
  const q = (v.q || '').toLowerCase();
  const st = v.status || 'any';
  const list = logsIn(v).filter((l) => (st === 'any' || l.status === st) && (!q || l.prompt.toLowerCase().includes(q) || l.model.includes(q) || l.caller.toLowerCase().includes(q)));
  const page = v.page || 0;
  return pageHead({ title: 'Logs', desc: 'Every call that went through the gateway: who made it, to which model, how long it took and what it cost.' })
    + `<div class="toolbar wrap">${select('win', WINDOWS.map(([k, l]) => [k, l]), win(v)[0], { aria: 'Window' })}${select('status', [['any', 'Any status'], ['succeeded', 'Succeeded'], ['failed', 'Failed'], ['running', 'Running']], st, { aria: 'Status' })}${search('q', v.q, 'Search prompts and answers')}</div>`
    + table({ cols: [{ label: 'When' }, { label: 'Model' }, { label: 'Status' }, { label: 'Caller' }, { label: 'Tokens', cls: 'r' }, { label: 'Latency', cls: 'r' }, { label: 'Cost', cls: 'r' }], empty: 'No calls in this window.',
      rows: list.slice(page * 50, page * 50 + 50).map((l) => ({ attrs: `class="row-link" data-act="log" data-id="${l.id}"`, cells: [`<span class="muted">${ago(l.at)}</span>`, `<code>${esc(l.model)}</code>`, l.status === 'succeeded' ? pill('Succeeded', 'green') : pill('Failed', 'red'), esc(l.caller), `<span class="num">${int(l.tokens)}</span>`, `<span class="num">${int(l.latencyMs)} ms</span>`, `<span class="num">${money4(l.cost)}</span>`] })) })
    + (list.length > 50 ? `<div class="pager"><span>${page * 50 + 1}–${Math.min(list.length, page * 50 + 50)} of ${list.length}</span>${btn('Previous', { sm: true, act: 'set', data: { key: 'page', val: page - 1 }, disabled: !page })}${btn('Next', { sm: true, act: 'set', data: { key: 'page', val: page + 1 }, disabled: (page + 1) * 50 >= list.length })}</div>` : '');
}

function placeholder(ctx) {
  const p = ctx.route.path.replace('/llm-gateway/', '');
  const all = { providers: 'Providers', 'routing-rules': 'Routing Rules', 'mcp-servers': 'MCP Servers', 'content-rules': 'Content Rules' };
  for (const items of Object.values(GW_GROUPS)) for (const i of items) all[slug(i)] = i;
  const title = all[p] || 'Gateway';
  return pageHead({ title, desc: "From the gateway's own console." }) + `<div class="console-ph"><div>${icon('gateway', 28)}<h3>${esc(title)} lives in the Rekori console</h3><p class="muted">In opencontroller this page embeds the gateway's own console, signed in as you. In the demo the console is not connected.</p>${btn('Open on its own', { icon: 'external', act: 'open-own' })}</div></div>`;
}

export const ROUTES = [
  { path: '/llm-gateway', render: overview, init: () => ({ win: '24h' }) },
  { path: '/llm-gateway/virtual-keys', render: keys, actions: {
    'new-key': () => modal({ title: 'New virtual key', wide: true,
      body: `${field('Name', input('name', { placeholder: 'claims-agent', required: true }))}${field('Belongs to', selectField('team', [['', 'Nobody in particular'], 'Platform', 'Sales Engineering', 'Customer Support', 'Finance Ops', 'People Ops'], ''))}
        <div class="field"><span class="field-label">May call</span><div class="checks cols">${Object.entries(PROVIDER_MODELS).map(([p, ms]) => `<fieldset class="prov"><legend><label class="check"><input type="checkbox" name="p:${p}"><span><b>${p}</b></span></label></legend>${ms.map((m) => `<label class="check sm"><input type="checkbox" name="m:${p}:${m}"><span>${esc(m)}</span></label>`).join('')}<label class="check sm"><input type="checkbox" name="all:${p}"><span>Every model</span></label></fieldset>`).join('')}</div></div>
        <div class="row2">${field('Budget', input('limit', { type: 'number', placeholder: '5.00' }), 'Leave empty for no budget.')}${field('Per', selectField('period', [['a day', 'Day'], ['a month', 'Month']], 'a day'))}</div>`,
      submit: 'Make the key',
      onSubmit: (d) => {
        if (!(d.name || '').trim()) return 'Give the key a name.';
        if (S.vkeys.some((k) => k.name === d.name.trim())) return 'A key with that name exists.';
        const mayCall = Object.keys(PROVIDER_MODELS).filter((p) => d[`p:${p}`] || d[`all:${p}`] || PROVIDER_MODELS[p].some((m) => d[`m:${p}:${m}`])).map((p) => ({ provider: p, models: d[`all:${p}`] ? 'every' : PROVIDER_MODELS[p].filter((m) => d[`m:${p}:${m}`]).length ? PROVIDER_MODELS[p].filter((m) => d[`m:${p}:${m}`]) : 'every' }));
        const lim = parseFloat(d.limit);
        if (d.limit && (!(lim > 0) || lim > 100000)) return 'The budget is an amount above zero.';
        const k = createKey({ name: d.name.trim(), belongsTo: d.team || null, mayCall, budget: lim > 0 ? { spent: 0, limit: lim, period: d.period } : null });
        toast(`Made ${k.name}: ${k.keyMasked}. It is shown in full only once in the real product.`);
        track('action', '/llm-gateway/virtual-keys', `New key ${k.name}`);
      } }),
    'del-key': (el) => modal({ title: 'Delete this key?', body: '<p>Agents calling with it start getting 401s straight away.</p>', submit: 'Delete', danger: true, onSubmit: () => { deleteKey(el.dataset.id); toast('Key deleted.'); } }),
  } },
  { path: '/llm-gateway/teams', render: teams, init: () => ({ tab: 'team' }), actions: {
    'new-team': (el, ctx) => modal({ title: ctx.v.tab === 'customer' ? 'New customer' : 'New team', body: `${field('Name', input('name', { required: true }))}${ctx.v.tab === 'customer' ? '' : field('Customer', input('customer', { placeholder: 'Optional' }))}${field('Monthly budget', input('budget', { type: 'number', placeholder: 'Optional' }))}${field('Rate limit, calls a minute', input('rate', { type: 'number', placeholder: 'Optional' }))}`, submit: 'Save',
      onSubmit: (d) => { if (!(d.name || '').trim()) return 'Give it a name.'; createTeam({ name: d.name.trim(), customer: d.customer || null, budget: parseFloat(d.budget) || null, rate: parseInt(d.rate, 10) || null, kind: ctx.v.tab || 'team' }); toast('Saved.'); } }),
  } },
  { path: '/llm-gateway/logs', render: logs, init: () => ({ win: '24h', status: 'any' }), actions: {
    log: (el) => {
      const l = S.gwLogs.find((x) => x.id === el.dataset.id);
      const hidden = prefs.role === 'Viewer';
      sheet({ title: l.model, sub: `Call · ${ago(l.at)}`, body: kv([['Status', l.status === 'succeeded' ? pill('Succeeded', 'green') : pill('Failed', 'red')], ['Caller', esc(l.caller)], ['Tokens', int(l.tokens)], ['Latency', `${int(l.latencyMs)} ms`], ['Cost', money4(l.cost)], l.error && ['Error', `<span class="t-red">${esc(l.error)}</span>`]])
        + `<h4 class="sub-h">Request</h4>${hidden ? '<p class="muted">Hidden for your role: it may quote what the agent was asked.</p>' : `<pre class="code">${esc(JSON.stringify({ model: l.model, messages: [{ role: 'user', content: l.prompt }] }, null, 2))}</pre>`}
        <h4 class="sub-h">Response</h4>${hidden ? '<p class="muted">Hidden for your role.</p>' : `<pre class="code">${esc(l.status === 'succeeded' ? JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'Done. The details are attached.' } }], usage: { total_tokens: l.tokens } }, null, 2) : JSON.stringify({ error: l.error }, null, 2))}</pre>`}` });
    },
  } },
  { path: /^\/llm-gateway\/[a-z0-9-]+$/, render: placeholder, actions: { 'open-own': () => toast('The gateway console is not connected in the demo.') } },
];
