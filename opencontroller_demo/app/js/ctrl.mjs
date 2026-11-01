// Ask Ctrl: canned, page-aware answers worked out from the live demo state (so they change as the
// visitor registers, approves or turns policies off), each with a link to the page that shows it.
import { S, live, findings, registryStats, shadowSpend, needsAttention, running } from './store.mjs';
import { money, int, ago, esc } from './util.mjs';
import { CLOUD_NAME } from './icons.mjs';

const GLOBAL = ['Summarize my findings', 'Which agents can reach the internet directly?', 'Which cloud has the most agents?', 'Why did the last Microsoft scan fail?'];
const BY_PAGE = {
  inventory: ['Show me only the agents', 'Which of these are in Microsoft?', 'Which agents keep credentials in environment variables?'],
  shadow: ['What is the costliest shadow asset?', 'How many shadow assets are spending money?', 'Summarize my findings'],
  approvals: ['What is waiting for approval?', 'How much of the estate is registered?'],
  registry: ['How much of the estate is registered?', 'Which registered assets are shared with everyone?'],
  spend: ['What are we spending on Claude?', 'What is the costliest shadow asset?', 'Which days were unusual?'],
  'spend-anthropic': ['What are we spending on Claude?', 'Which keys nobody uses?'],
  findings: ['Summarize my findings', 'Which agents keep credentials in environment variables?', 'Which agents can reach the internet directly?'],
  policies: ['Summarize my findings', 'Which policies find the most?'],
  gateway: ['Which key is closest to its budget?', 'Why are gateway calls failing?'],
  'gateway-keys': ['Which key is closest to its budget?'], 'gateway-logs': ['Why are gateway calls failing?'],
  observability: ['What broke this week?', 'Which project costs the most?'], 'obs-project': ['What broke this week?'],
  guardrails: ['What does Customer-facing assistant check?'], guardrail: ['What does Customer-facing assistant check?'],
};
export const suggestions = (key) => BY_PAGE[key] || GLOBAL;

const list = (items) => `<ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>`;
const a = (x) => `<a href="#/inventory/${x.id}">${esc(x.name)}</a>`;

export function answer(q) {
  const t = q.toLowerCase();
  const fs = findings();
  const agents = live().filter((x) => x.kind === 'agent');
  if (/summar|finding/.test(t) && !/credential|environment/.test(t)) {
    const by = { Critical: 0, High: 0, Medium: 0, Low: 0 };
    for (const f of fs) by[f.severity]++;
    const pol = new Map(); for (const f of fs) pol.set(f.policy, (pol.get(f.policy) || 0) + 1);
    const top = [...pol].sort((x, y) => y[1] - x[1]).slice(0, 4);
    return { html: `There are <b>${int(fs.length)}</b> open findings: ${by.Critical} critical, ${by.High} high, ${by.Medium} medium and ${by.Low} low. The biggest groups:${list(top.map(([p, n]) => `${esc(p.title)} <span class="muted">(${p.code})</span>: ${n}`))}Start with the critical ones: credentials in environment variables and agents anyone can use without signing in.`, link: ['Open Findings', '#/findings'] };
  }
  if (/internet|reach|public/.test(t)) {
    const l = agents.filter((x) => x.exposure === 'public' || x.flags.readsWeb || x.flags.publicNet);
    return { html: `${l.length} agents can reach, or be reached from, the internet. ${l.filter((x) => x.auth === 'none').length} of them need no sign-in at all:${list(l.slice(0, 6).map((x) => `${a(x)} <span class="muted">· ${esc(x.source)}${x.auth === 'none' ? ' · no authentication' : x.flags.readsWeb ? ' · reads the web' : ' · public endpoint'}</span>`))}`, link: ['See the check', '#/findings?check=EXP-1'] };
  }
  if (/most agents|which cloud/.test(t)) {
    const c = new Map(); for (const x of agents) c.set(x.cloud, (c.get(x.cloud) || 0) + 1);
    const rows = [...c].sort((x, y) => y[1] - x[1]);
    return { html: `${CLOUD_NAME[rows[0][0]]} has the most, with ${rows[0][1]} of ${agents.length} agents:${list(rows.map(([k, n]) => `${CLOUD_NAME[k]}: ${n}`))}`, link: ['Open the map', '#/inventory'] };
  }
  if (/scan/.test(t)) {
    const last = S.scans.find((s) => s.cloud === 'microsoft');
    const r = running();
    return { html: `${r.length ? `A scan is running now (${r.length}). ` : ''}The last Microsoft scan did not fail: it <b>${last.status}</b> ${ago(last.startedAt)}, read ${last.sourcesRead} sources and none failed. What does fail is reading bills: <b>AWS Cost and Usage Report</b> cannot assume its role, and <b>Databricks billable usage</b> has an expired secret. Microsoft usage reports need Reports.Read.All.`, link: ['Scan details', `#/integrations/scans/${last.id}`] };
  }
  if (/only the agents|show me.*agents/.test(t)) return { html: `There are ${agents.length} agents. The list is filtered to them.`, link: ['Agents only', '#/inventory?tab=list&kind=agent'] };
  if (/microsoft/.test(t)) { const n = live().filter((x) => x.cloud === 'microsoft'); return { html: `${n.length} assets are in Microsoft, ${n.filter((x) => x.kind === 'agent').length} of them agents (Azure AI Foundry, Copilot Studio, Agent Builder and Agent 365).`, link: ['Microsoft only', '#/inventory?tab=list&cloud=microsoft'] }; }
  if (/credential|environment/.test(t)) {
    const l = fs.filter((f) => f.code === 'DAT-1');
    return { html: `${l.length} agents keep credentials in environment variables:${list(l.map((f) => `${a(f.asset)} <span class="muted">· ${esc(f.evidence)}</span>`))}Move the values into a secrets manager and give each agent its own identity.`, link: ['The check and how to fix it', '#/findings?check=DAT-1'] };
  }
  if (/costliest|spending money|shadow asset/.test(t)) {
    const s = shadowSpend();
    return { html: `${s.count} shadow assets spent ${money(s.total)} in the last 30 days. The costliest:${list(s.list.slice(0, 5).map((x) => `${a(x)} <span class="muted">· ${esc(x.kind.replace('_', ' '))}</span> ${money(x.spend30d)}`))}Register them from Shadow AI or straight from Spend.`, link: ['Spending, and not registered', '#/shadow-ai'] };
  }
  if (/waiting|approval/.test(t)) {
    const p = S.approvals.filter((x) => x.status === 'pending');
    return { html: p.length ? `${p.length} request${p.length === 1 ? ' is' : 's are'} waiting:${list(p.map((x) => { const as = live().find((y) => y.id === x.assetId); return `${as ? a(as) : 'an asset'} <span class="muted">· owner ${esc(x.owner)} · ${ago(x.requestedAt)}</span>`; }))}` : 'Nothing is waiting for approval.', link: ['Open Approvals', '#/approvals'] };
  }
  if (/registered\?|how much of the estate/.test(t)) { const r = registryStats(); return { html: `${Math.round(r.pct * 100)}% of governed assets are registered: ${r.registered} of ${r.governed}. ${r.awaiting} are awaiting approval and ${r.shadow} are shadow.`, link: ['Shadow AI', '#/shadow-ai'] }; }
  if (/shared with everyone/.test(t)) { const l = live().filter((x) => x.registration && x.registration.shared === 'organization'); return { html: `${l.length} registered assets are shared with everyone in the organization:${list(l.slice(0, 6).map(a))}`, link: ['Registry cards', '#/registry?view=cards'] }; }
  if (/claude|spending on/.test(t)) return { html: 'Claude cost <b>$58,447.30</b> this month, 42% more than September, almost all of it the Claude API. claude-opus-4-6 and claude-opus-5-5 are the largest models; lyzr-studio-prod is the largest key, and nobody registered it.', link: ['Claude spend', '#/spend/anthropic'] };
  if (/unusual|spike/.test(t)) return { html: 'Six days cost at least three times the week before. The biggest jump: Foundry Models on 16 Oct, $120.39 against about $5 a day.', link: ['Unusual days', '#/spend'] };
  if (/nobody uses|unused/.test(t)) { const l = fs.filter((f) => f.code === 'IAM-4'); return { html: `${l.length} active keys have not been used for 30 days.`, link: ['API keys', '#/spend/anthropic?tab=keys'] }; }
  if (/budget/.test(t)) { const k = S.vkeys.filter((x) => x.budget).sort((x, y) => y.budget.spent / y.budget.limit - x.budget.spent / x.budget.limit)[0]; return { html: k ? `<b>${esc(k.name)}</b> is closest: ${money(k.budget.spent)} of ${money(k.budget.limit)} ${esc(k.budget.period)}.` : 'No key has a budget yet.', link: ['Virtual keys', '#/llm-gateway/virtual-keys'] }; }
  if (/failing|fail/.test(t)) return { html: 'Most failed calls in the last day were stopped on purpose: the guardrails-compliance guardrail blocked prompt injections and card numbers. The rest are 429s from openai and one budget cap.', link: ['Failed calls', '#/llm-gateway/logs?status=failed'] };
  if (/broke|issue/.test(t)) return { html: `Top issues this week:${list(S.issues.slice(0, 4).map((i) => `${esc(i.name)}: ${esc(i.error)} <span class="muted">· ${i.count}×</span>`))}`, link: ['Observability', '#/observability'] };
  if (/project costs/.test(t)) return { html: 'nordic-capital: $316.23 over 557 runs in the last 7 days. Everything else together is $8.30.', link: ['Projects', '#/observability/projects'] };
  if (/check\??$|customer-facing/.test(t)) return { html: 'It blocks prompt injection, toxic text and sexual content; redacts card numbers, emails, phone numbers and US social security numbers; and masks secrets.', link: ['Open it', `#/guardrails/${S.guardrails[0].id}`] };
  if (/policies find the most/.test(t)) return answer('summarize findings');
  const hit = live().filter((x) => x.name.toLowerCase().includes(t.replace(/[?.!]/g, '').trim().split(/\s+/).pop()));
  if (hit.length && t.trim().length > 2) return { html: `I found ${hit.length} asset${hit.length === 1 ? '' : 's'} matching:${list(hit.slice(0, 6).map((x) => `${a(x)} <span class="muted">· ${esc(x.kind.replace('_', ' '))} · ${esc(x.registry.replace('_', ' '))}</span>`))}` };
  return { html: 'In this demo I answer from the synthetic estate. Try asking about findings, shadow assets, spend, approvals, scans, the gateway or a specific agent by name.' };
}
