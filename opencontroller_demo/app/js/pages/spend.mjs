import { pageHead, statCards, panel, table, btn, seg, select, tabs, pill, regPill, assetLink, modal, field, input, toast, esc, icon, barList, kindLabel } from '../ui.mjs';
import { S, live, needsAttention, findings, FIN_PILL, setLicencePrice, can, kindOne, assetByName } from '../store.mjs';
import { SERVICES, SPEND_SOURCES } from '../data.mjs';
import { stackedBars } from '../charts.mjs';
import { money, int, pct, ago, now, DAY, sum, groupBy, dayLabel } from '../util.mjs';
import { openRegister } from './inventory.mjs';
import { breakdown } from './observe.mjs';
import { track } from '../../../shared/session.mjs';

const PERIODS = [['month', 'This month'], ['last', 'Last month'], ['30d', '30 days'], ['7d', '7 days']];
const PROV_COLOR = { Anthropic: 'var(--c-orange)', Azure: 'var(--c-accent)', AWS: 'var(--c-amber)' };
const days = (from, to) => { const out = []; for (let d = new Date(from + 'T00:00:00Z'); d <= new Date(to + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10)); return out; };
function range(p) {
  if (p === 'last') return { cur: days('2026-09-01', '2026-09-30'), prev: days('2026-08-01', '2026-08-31'), label: 'September' };
  if (p === '7d') return { cur: days('2026-10-24', '2026-10-30'), prev: days('2026-10-17', '2026-10-23'), label: 'the last 7 days' };
  if (p === '30d') return { cur: days('2026-10-01', '2026-10-30'), prev: days('2026-09-01', '2026-09-30'), label: 'the last 30 days' };
  return { cur: days('2026-10-01', '2026-10-30'), prev: days('2026-09-01', '2026-09-30'), label: 'October so far' };
}
const rowsFor = (dayList, prov) => { const set = new Set(dayList); return S.spendRows.filter((r) => set.has(r.day) && (prov === 'all' || r.provider === prov)); };
// Share of the Claude bill in this period compared with October, to scale per-asset amounts.
const claudeScale = (cur) => sum(rowsFor(cur, 'Anthropic').filter((r) => r.service === 'Claude API'), (r) => r.billed) / 58222.59;

function unusual(prov) {
  const out = [];
  const all = days('2026-09-01', '2026-10-30');
  for (const svc of SERVICES) {
    if (prov !== 'all' && svc.provider !== prov) continue;
    const byDay = new Map(all.map((d) => [d, 0]));
    for (const r of S.spendRows) if (r.service === svc.service) byDay.set(r.day, byDay.get(r.day) + r.billed);
    all.forEach((d, i) => {
      if (i < 7 || !d.startsWith('2026-10')) return;
      const avg = all.slice(i - 7, i).reduce((a, x) => a + byDay.get(x), 0) / 7;
      const v = byDay.get(d);
      if (v >= 3 * avg && v - avg >= 10) out.push({ d, svc: svc.service, v, avg, x: avg ? v / avg : 99 });
    });
  }
  return out.sort((a, b) => (a.d < b.d ? 1 : -1));
}

function render({ v }) {
  const p = v.period || 'month'; const prov = v.prov || 'all';
  const { cur, prev, label } = range(p);
  const rows = rowsFor(cur, prov); const prevRows = rowsFor(prev, prov);
  const bills = sum(rows, (r) => r.billed); const prevBills = sum(prevRows, (r) => r.billed);
  const dlt = prevBills ? `${bills >= prevBills ? '+' : '−'}${Math.round(Math.abs(bills / prevBills - 1) * 100)}%` : 'new';
  const scale = claudeScale(cur);
  const att = needsAttention().filter((x) => prov === 'all' || (prov === 'Anthropic' ? x.asset.cloud === 'anthropic' : prov === 'Azure' ? x.asset.cloud === 'microsoft' : x.asset.cloud === 'aws'));
  const nShow = v.allAtt ? att.length : 6;
  const traced = sum(S.traces.filter((t) => now() - t.start <= 30 * DAY), (t) => t.cost);
  const seats = sum(S.licences, (l) => l.seats); const priced = S.licences.filter((l) => l.each != null);
  const licMonth = priced.length ? sum(priced, (l) => l.seats * l.each) : null;

  const attPanel = panel({ title: 'Needs attention', desc: `${att.length} assets whose spend needs a look, ${att.filter((x) => x.critical).length} critical: spend on what no one registered, days far above the usual, spend doubling every few days. Worked out after each read of the bills.`,
    body: `<div class="rows">${att.slice(0, nShow).map((x) => `<div class="row finding"><div class="grow">${assetLink(x.asset)} <span class="muted small">${esc(kindOne(x.asset.kind).toLowerCase())}</span><div class="btn-row" style="margin:6px 0 4px">${x.asset.registry === 'shadow' ? pill('Shadow', 'red') : ''}${x.codes.map((c) => pill(FIN_PILL[c], c === 'FIN-3' || c === 'FIN-4' ? 'amber' : c === 'FIN-5' ? 'grey' : 'red')).join('')}</div><p class="muted small">${esc(x.reasons[0])}. Since yesterday.</p></div><span class="num">${money(x.asset.spend30d)}</span>${x.asset.registry === 'shadow' ? btn('Register', { sm: true, act: 'register', data: { id: x.asset.id }, perm: 'register' }) : ''}</div>`).join('') || '<p class="muted">Nothing needs a look.</p>'}</div>${att.length > 6 ? btn(v.allAtt ? 'Show fewer' : `Show all ${att.length}`, { sm: true, act: 'set', data: { key: 'allAtt', val: !v.allAtt } }) : ''}` });

  const kpi = statCards([
    { label: 'Total AI spend', value: money(bills + (licMonth || 0)), delta: dlt, deltaTone: 'bad', sub: 'Bills and licences, against the period before' },
    { label: 'Bills', value: money(bills), delta: dlt, deltaTone: 'bad', sub: `$0.00 estimated${p === 'month' ? ` · ${money((sum(rowsFor(cur, prov), (r) => r.billed) / 30) * 31)} forecast for October` : ''}` },
    { label: 'Licences', value: licMonth == null ? '—' : money(licMonth), sub: `${int(seats)} seats · ${priced.length ? `${priced.length} of ${S.licences.length} priced` : 'prices not set'}` },
    { label: 'Idle licences', value: '—', sub: 'Needs usage reports to tell' },
    { label: 'Traced model calls', value: money(traced), delta: 'new', sub: 'Seen by opencontroller; may be in a cloud bill too' },
  ], 5);

  const byProv = [...groupBy(rows, (r) => r.provider)].map(([k, l]) => [k, sum(l, (r) => r.billed)]).sort((a, b) => b[1] - a[1]);
  const provPanel = panel({ title: 'By provider', desc: `${money(bills)} bills and licences, ${label}.`, body: barList(byProv.map(([k, val]) => ({ label: k, value: val, fmt: money(val), after: pct(bills ? val / bills : 0), color: PROV_COLOR[k], act: 'set', data: { key: 'prov', val: prov === k ? 'all' : k } }))) });

  const provs = [...new Set(rows.map((r) => r.provider))];
  const chart = panel({ title: 'Bills, day by day', desc: 'Billed, by provider. Hover a day for its amounts.', body: stackedBars({ series: provs.map((pv) => ({ name: pv, color: PROV_COLOR[pv], values: cur.map((d) => sum(rows.filter((r) => r.day === d && r.provider === pv), (r) => r.billed)) })), labels: cur.map((d) => `${Number(d.slice(8))} ${d.slice(5, 7) === '09' ? 'Sep' : 'Oct'}`), height: 190, fmt: (x) => money(x) }) + `<div class="legend">${provs.map((pv) => `<span><i style="background:${PROV_COLOR[pv]}"></i>${esc(pv)} ${money(sum(rows.filter((r) => r.provider === pv), (r) => r.billed))}</span>`).join('')}</div>` });

  const un = unusual(prov).filter((x) => cur.includes(x.d));
  const unPanel = panel({ title: 'Unusual days', desc: 'Days a service cost at least three times its daily average over the week before, and $10 more.', body: `<div class="rows">${un.map((x) => `<div class="row"><span class="muted" style="width:60px">${Number(x.d.slice(8))} ${x.d.slice(5, 7) === '09' ? 'Sep' : 'Oct'}</span><b>${esc(x.svc)}</b><span class="grow"></span><span class="num">${money(x.v)}</span><span class="muted small">vs about ${money(x.avg)} a day</span>${pill(`×${x.x >= 10 ? Math.round(x.x) : x.x.toFixed(1)}`, 'amber')}</div>`).join('') || '<p class="muted">No unusual days in this period.</p>'}</div>` });

  const by = v.by || 'service';
  const key = { service: (r) => r.service, provider: (r) => r.provider, account: (r) => r.account, resource: (r) => r.resource }[by];
  const groups = [...groupBy(rows, key)].map(([k, l]) => [k, sum(l, (r) => r.billed)]).sort((a, b) => b[1] - a[1]);
  if (by === 'service' && (prov === 'all' || prov === 'Azure')) groups.push(['Azure Bot Service', null]);
  const where = panel({ title: 'Where the bills go', right: seg('by', [['service', 'Services'], ['provider', 'Providers'], ['account', 'Accounts'], ['resource', 'Resources']], by, { sm: true }), body: table({ cols: [{ label: { service: 'Service', provider: 'Provider', account: 'Account', resource: 'Resource' }[by] }, { label: 'Billed', cls: 'r' }, { label: 'Estimated', cls: 'r' }], rows: groups.map(([k, val]) => [esc(k), `<span class="num">${val == null ? '—' : money(val)}</span>`, `<span class="num">${k === 'Amazon Bedrock AgentCore' ? '$0.00' : '—'}</span>`]) }) });

  const lic = panel({ title: 'Licences', desc: `${int(seats)} seats, ${licMonth == null ? '$0.00' : money(licMonth)} a month. Licence APIs carry no prices: set what each costs.`, body: table({ cols: [{ label: 'Licence' }, { label: 'Seats', cls: 'r' }, { label: 'Each', cls: 'r' }, { label: 'A month', cls: 'r' }, { label: 'Idle', cls: 'r' }], rows: S.licences.map((l) => [esc(l.name), `<span class="num">${l.seats}</span>`, can('licences') ? `<button type="button" class="lnk" data-act="price" data-n="${esc(l.name)}">${l.each == null ? 'Not set' : money(l.each)}</button>` : `<span class="muted">${l.each == null ? 'Not set' : money(l.each)}</span>`, `<span class="num">${l.each == null ? '—' : money(l.each * l.seats)}</span>`, '<span class="muted">—</span>']) }) });

  const showSh = v.show === 'shadow';
  const billedAssets = live().filter((a) => a.spend30d > 0 && (!showSh || a.registry === 'shadow')).filter((a) => prov === 'all' || (prov === 'Anthropic' ? a.cloud === 'anthropic' : prov === 'Azure' ? a.cloud === 'microsoft' || a.cloud === 'external' : a.cloud === 'aws')).sort((a, b) => b.spend30d - a.spend30d);
  const nTop = v.allTop ? billedAssets.length : 10;
  const top = panel({ title: 'Top agents, models and keys', desc: 'Joined from the bills to the inventory.', right: seg('show', [['all', 'All'], ['shadow', 'Shadow only']], v.show || 'all', { sm: true }), body: table({ cols: [{ label: 'Agent, model or key' }, { label: 'Kind' }, { label: 'Registry' }, { label: 'Billed', cls: 'r' }, { label: 'Estimated', cls: 'r' }, { label: 'Share of a bill', cls: 'r' }],
    rows: billedAssets.slice(0, nTop).map((a) => { const amt = a.cloud === 'anthropic' ? a.spend30d * scale : a.spend30d; return [assetLink(a), kindLabel(a.kind), regPill(a.registry), `<span class="num">${a.kind === 'api_key' || a.kind === 'identity' ? '—' : money(amt)}</span>`, '<span class="num muted">—</span>', `<span class="num">${a.kind === 'api_key' || a.kind === 'identity' ? money(amt) : '—'}</span>`]; }) })
    + (billedAssets.length > 10 ? btn(v.allTop ? 'Show fewer' : `Show all ${billedAssets.length}`, { sm: true, act: 'set', data: { key: 'allTop', val: !v.allTop } }) : '') });

  const models = live().filter((a) => a.kind === 'model' && a.cloud === 'anthropic' && a.spend30d > 0).sort((a, b) => b.spend30d - a.spend30d);
  const claude = prov === 'all' || prov === 'Anthropic' ? panel({ title: 'Claude API', right: `<a class="lnk" href="#/spend/anthropic">Claude spend, by API key and person ${icon('arrow', 13)}</a>`, body: `<div class="grid-2"><div><h3 class="sub-h">Model mix</h3>${barList(models.slice(0, 8).map((m) => ({ label: m.name, value: m.spend30d * scale, fmt: money(m.spend30d * scale), href: `#/inventory/${m.id}` })))}${models.length > 8 ? `<p class="muted small">And ${models.length - 8} more models.</p>` : ''}</div>
      <div><h3 class="sub-h">Caching and batching</h3>${statCards([{ label: 'Cache reads', value: money(2348.22 * scale) }, { label: 'Cache writes', value: money(4293.96 * scale) }, { label: 'Saved by caching, estimated', value: money(20125.51 * scale), tone: 'amber' }, { label: 'Batch calls', value: 'None' }], 2)}<p class="muted small">Cache reads cost a tenth of input; cache writes cost 1.25 times it. Batch calls cost half, and none were made: overnight jobs could move to the Batch API.</p></div></div>` }) : '';

  const traces = S.traces.filter((t) => now() - t.start <= 30 * DAY);
  const brk = breakdown(traces, S.traces.filter((t) => now() - t.start > 30 * DAY), v.brk || 'agents', ['agents', 'users', 'teams', 'providers', 'models']).replace(/data-key="by"/g, 'data-key="brk"');

  const sources = panel({ title: 'Sources', desc: 'Where spend is read from, through each connected integration, and how the last read went.', body: `<div class="rows">${SPEND_SOURCES.map((s) => `<div class="row finding"><div class="grow"><b>${esc(s.name)}</b> <code class="muted small">${s.conn}</code><p class="small ${s.status === 'read' ? 'muted' : s.status === 'failed' ? 't-red' : 't-amber'}">${esc(s.result)}</p></div>${pill({ read: 'Read', needs_permission: 'Needs a permission', failed: 'Failed', not_set_up: 'Not set up' }[s.status], { read: 'green', needs_permission: 'amber', failed: 'red', not_set_up: 'grey' }[s.status])}<span class="muted small">${ago(s.at)}</span></div>`).join('')}</div><p class="muted small">GitHub Copilot, Snowflake and Salesforce Agentforce are not read yet: there is no integration for them.</p>` });

  return pageHead({ title: 'Spend', desc: 'What the organization spends on AI: the clouds\' bills, the licences people hold, and the model calls opencontroller sees.', right: seg('period', PERIODS, p, { label: 'Period' }) + select('prov', [['all', 'All providers'], ['Anthropic', 'Anthropic'], ['Azure', 'Azure'], ['AWS', 'AWS']], prov, { label: 'Provider' }) })
    + attPanel + kpi + `<div class="grid-2">${provPanel}${unPanel}</div>` + chart + where + lic + top + claude + brk + sources;
}

// ---------------- Claude spend ----------------
function claude({ v }) {
  const p = v.period || 'month';
  const { cur } = range(p);
  const scale = claudeScale(cur);
  const rows = rowsFor(cur, 'Anthropic');
  const billed = sum(rows, (r) => r.billed);
  const keys = live().filter((a) => (a.kind === 'api_key' || a.kind === 'identity') && a.cloud === 'anthropic');
  const billedKeys = keys.filter((a) => a.spend30d > 0).sort((a, b) => b.spend30d - a.spend30d);
  const putDown = sum(billedKeys, (a) => a.spend30d * scale);
  const tab = v.tab || 'overview';
  const head = `<a class="crumb-back" href="#/spend">${icon('back', 14)}Spend</a>` + pageHead({ title: 'Claude spend', desc: 'The Claude bill by workspace, API key and person, and the keys that need a look.', right: seg('period', PERIODS, p, { label: 'Period' }) }) + tabs('tab', [['overview', 'Overview'], ['breakdown', 'Breakdown'], ['keys', 'API keys']], tab);
  if (tab === 'keys') {
    const fs = findings();
    return head + table({ cols: [{ label: 'Key' }, { label: 'Workspace' }, { label: 'Made by' }, { label: 'Last used' }, { label: 'Expires' }, { label: 'Registry' }, { label: 'Billed', cls: 'r' }],
      rows: keys.filter((k) => k.kind === 'api_key').sort((a, b) => b.spend30d - a.spend30d).map((k) => [assetLink(k), esc(k.workspace || '—'), esc(k.createdBy), k.lastUsed ? `<span class="${now() - k.lastUsed > 30 * DAY ? 't-amber' : 'muted'}">${ago(k.lastUsed)}</span>` : '—', k.expires ? (k.expires - now() < 14 * DAY ? pill(`in ${Math.max(1, Math.round((k.expires - now()) / DAY))} days`, 'amber') : `<span class="muted">${dayLabel(k.expires)}</span>`) : pill('Never', 'grey'), regPill(k.registry), `<span class="num">${k.spend30d ? money(k.spend30d * scale) : '—'}</span>`]) });
  }
  if (tab === 'breakdown') {
    return head + panel({ title: 'Whose it was', desc: 'Keys and the people who made them, by share of the bill.', body: table({ cols: [{ label: 'Key' }, { label: 'Made by' }, { label: 'Workspace' }, { label: 'Billed', cls: 'r' }, { label: 'Share', cls: 'r' }], rows: billedKeys.map((k) => [assetLink(k), esc(k.createdBy || '—'), esc(k.workspace || 'Default workspace'), `<span class="num">${money(k.spend30d * scale)}</span>`, `<span class="num">${pct(billed ? (k.spend30d * scale) / billed : 0, 1)}</span>`]) }) });
  }
  const totalTree = sum(billedKeys, (k) => k.spend30d) || 1;
  const tree = `<div class="treemap">${billedKeys.slice(0, 12).map((k) => `<a href="#/inventory/${k.id}" style="flex:${k.spend30d}" title="${esc(k.name)}: ${money(k.spend30d * scale)}"><b class="trunc">${esc(k.name)}</b><span>${money(k.spend30d * scale)}</span></a>`).join('')}</div>`;
  const keysToLook = keys.filter((k) => k.kind === 'api_key' && (now() - (k.lastUsed || 0) > 30 * DAY || !k.expires || (k.expires && k.expires - now() < 14 * DAY))).slice(0, 6);
  return head
    + panel({ title: 'October so far', body: `<div class="row-split"><span><b>Lyzr Org</b> · ${money(31482.14 * scale)} spent · headed for ${money(32540.89 * scale)} by the month's end</span><span class="muted">No limit entered</span></div><span class="bar-amber" style="margin:10px 0"><i style="width:96%"></i></span><p class="muted small">$852.21 a day over the last seven days.</p>` })
    + statCards([{ label: 'Billed', value: money(billed), delta: '+42%', deltaTone: 'bad' }, { label: 'Put down to keys and people', value: money(putDown), sub: `${pct(billed ? putDown / billed : 0)} of the Claude API and Web search bill` }, { label: 'Not put down to anyone', value: money(Math.max(0, billed - putDown)) }, { label: 'Managed Agents sessions', value: '$0.00' }], 4)
    + panel({ title: 'Billed, day by day', body: stackedBars({ series: [{ name: 'Claude API', color: 'var(--c-orange)', values: cur.map((d) => sum(rows.filter((r) => r.day === d && r.service === 'Claude API'), (r) => r.billed)) }, { name: 'Web search', color: 'var(--c-accent)', values: cur.map((d) => sum(rows.filter((r) => r.day === d && r.service === 'Web search'), (r) => r.billed)) }], labels: cur.map((d) => `${Number(d.slice(8))} ${d.slice(5, 7) === '09' ? 'Sep' : 'Oct'}`), fmt: money }) })
    + panel({ title: 'Where it went', desc: 'Organization → workspace → API key, each box sized by its share. Click one to open it.', body: tree })
    + panel({ title: 'Keys to look at', desc: 'Active API keys no one has used for 30 days, whose maker has left, or that expire soon or never.', right: `<button class="lnk" data-act="set" data-key="tab" data-val="&quot;keys&quot;">All ${keys.filter((k) => k.kind === 'api_key').length}, with every key</button>`, body: `<div class="cards-grid">${keysToLook.map((k) => `<div class="reg-card"><b>${esc(k.name)}</b><p class="muted small">${esc(k.workspace || 'Default workspace')} · made by ${esc(k.createdBy)}</p><div class="btn-row">${now() - (k.lastUsed || 0) > 30 * DAY ? pill('Unused for 30 days', 'amber') : ''}${!k.expires ? pill('Never expires', 'grey') : k.expires - now() < 14 * DAY ? pill(`Expires in ${Math.max(1, Math.round((k.expires - now()) / DAY))} days`, 'amber') : ''}</div>${k.registry === 'shadow' ? `<button type="button" class="lnk small" data-act="register" data-id="${k.id}">Register to disable</button>` : ''}</div>`).join('')}</div>` });
}

const actions = {
  register: (el, ctx) => openRegister([el.dataset.id], ctx),
  price: (el) => { const l = S.licences.find((x) => x.name === el.dataset.n); modal({ title: `What does ${l.name} cost?`, body: field('Each, a month (USD)', input('each', { type: 'number', value: l.each ?? '' })), submit: 'Save', onSubmit: (d) => { const n = parseFloat(d.each); if (!(n >= 0)) return 'Enter an amount.'; setLicencePrice(l.name, n); toast('Saved. Licences and Total AI spend include it now.'); track('action', '/spend', `Price ${l.name}`); } }); },
};
export const ROUTES = [
  { path: '/spend', render, init: () => ({ period: 'month', prov: 'all', by: 'service', show: 'all', brk: 'agents' }), actions },
  { path: '/spend/anthropic', render: claude, init: () => ({ period: 'month', tab: 'overview' }), actions },
];
