// The demo's state: the seed plus whatever the visitor changed (kept in this browser), the numbers
// derived from it (never hard-coded: registered %, findings, needs-attention), and every action.
import { buildSeed, UNGOVERNED_KINDS, LEFT_PEOPLE, SPEND_FLAG_NOTES, KIND_ONE, FAMILIES, newGuardrail, INTEGRATIONS } from './data.mjs';
import { now, rng, MIN, DAY, HOUR, money } from './util.mjs';

const SAVE_KEY = 'ocdemo.state.v1';
const PREF_KEY = 'ocdemo.prefs';
export let S = null;          // live state
let saved = null;             // what is persisted: { patches, added, collections... }
const listeners = new Set();
let version = 0;
const R = rng(Date.now() & 0xffffffff);

const COLLECTIONS = ['approvals', 'audit', 'scans', 'skills', 'skillSettings', 'guardrails', 'vkeys', 'gwTeams', 'integrations', 'licences', 'orgTeams', 'settings', 'evaluatedAt'];

function storage() { try { return window.localStorage; } catch { return null; } }

export function load() {
  S = buildSeed();
  saved = { patches: {}, added: [], policyOff: [] };
  try {
    const raw = storage() && storage().getItem(SAVE_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      if (p && p.v === S.version) {
        saved = { patches: p.patches || {}, added: p.added || [], policyOff: p.policyOff || [] };
        for (const c of COLLECTIONS) if (p[c] !== undefined) S[c] = p[c];
        for (const a of saved.added) S.assets.push(a.asset), S.relations.push(...(a.relations || []));
        const byId = new Map(S.assets.map((a) => [a.id, a]));
        for (const [id, patch] of Object.entries(saved.patches)) if (byId.has(id)) Object.assign(byId.get(id), patch);
        for (const p2 of S.policies) p2.on = !saved.policyOff.includes(p2.code);
      }
    }
  } catch { /* corrupt or blocked storage: start from the seed */ }
  // Scans that were "running" when the page closed have finished since.
  for (const s of S.scans) if (s.status === 'running') s.status = 'succeeded';
  index();
  return S;
}

function persist() {
  const st = storage(); if (!st) return;
  const out = { v: S.version, patches: saved.patches, added: saved.added, policyOff: S.policies.filter((p) => !p.on).map((p) => p.code) };
  for (const c of COLLECTIONS) out[c] = c === 'scans' ? S.scans.slice(0, 60) : S[c];
  try { st.setItem(SAVE_KEY, JSON.stringify(out)); } catch { /* quota or blocked */ }
}

export function reset() {
  try { storage() && storage().removeItem(SAVE_KEY); } catch { /* ignore */ }
  load(); changed();
}

export function on(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function changed() { version++; cache.clear(); persist(); for (const fn of listeners) fn(); }

// ---- prefs (role, theme, explainers): per browser, not part of the estate ----
export const prefs = Object.assign({ role: 'Admin', theme: 'dark', explain: true, seen: {}, collapsed: {} }, (() => { try { return JSON.parse(storage().getItem(PREF_KEY) || '{}'); } catch { return {}; } })());
export function setPref(k, v) { prefs[k] = v; try { storage().setItem(PREF_KEY, JSON.stringify(prefs)); } catch { /* ignore */ } for (const fn of listeners) fn(); }

const LEVEL = { Viewer: 0, Operator: 1, Admin: 2, Owner: 3 };
const NEEDS = {
  scan: 1, rescan: 1, verify: 1, register: 1, share: 1, tryGuardrail: 1, block: 2,
  approve: 2, reject: 2, revoke: 2, registerExternal: 2, newKey: 2, newGuardrail: 2, editGuardrail: 2, newSkill: 2, newVersion: 2, publish: 2,
  skillsSettings: 2, policyToggle: 2, integrations: 2, scanSchedule: 2, licences: 2, gateway: 2, delete: 2, override: 2, newTeam: 2, settings: 3, addRole: 3,
};
export const can = (action) => LEVEL[prefs.role] >= (NEEDS[action] ?? 0);
export function why(action) {
  const n = NEEDS[action] ?? 0;
  return n === 1 ? 'Needs the operator role' : n === 2 ? 'Only administrators can do this' : n === 3 ? 'Only the owner can do this' : '';
}

// ---- indexes and derived values ----
let byId = new Map();
let relFrom = new Map(), relTo = new Map();
function index() {
  byId = new Map(S.assets.map((a) => [a.id, a]));
  relFrom = new Map(); relTo = new Map();
  for (const r of S.relations) {
    if (!relFrom.has(r.from)) relFrom.set(r.from, []); relFrom.get(r.from).push(r);
    if (!relTo.has(r.to)) relTo.set(r.to, []); relTo.get(r.to).push(r);
  }
}
export const asset = (id) => byId.get(id);
export const assetByName = (n) => S.assets.find((a) => a.name === n);
export const uses = (id) => (relFrom.get(id) || []).filter((r) => byId.has(r.to) && !byId.get(r.to).removed);
export const usedBy = (id) => (relTo.get(id) || []).filter((r) => byId.has(r.from) && !byId.get(r.from).removed);
export const live = () => memo('live', () => S.assets.filter((a) => !a.removed));

const cache = new Map();
function memo(key, fn) { if (!cache.has(key)) cache.set(key, fn()); return cache.get(key); }

export const governed = (a) => !UNGOVERNED_KINDS.has(a.kind) && a.registry !== 'not_governed';

export function registryStats(list = live()) {
  const g = list.filter(governed);
  const reg = g.filter((a) => a.registry === 'registered').length;
  const wait = g.filter((a) => a.registry === 'awaiting_approval').length;
  const shadow = g.filter((a) => a.registry === 'shadow').length;
  return { governed: g.length, registered: reg, awaiting: wait, shadow, pct: g.length ? reg / g.length : 0, notGoverned: list.length - g.length };
}

// ---- posture: policies evaluated over the inventory ----
function sharedIdentityCount(a) {
  let most = 0;
  for (const r of uses(a.id)) if (r.type === 'runs_as') most = Math.max(most, usedBy(r.to).filter((x) => x.type === 'runs_as').length);
  return most;
}
const CHECKS = {
  'EXP-1': (a) => a.auth === 'none' && a.exposure === 'public' && 'Authentication: None · Channel: public web',
  'EXP-3': (a) => a.exposure === 'public' && `Exposure: public${a.attributes.endpoint ? ' · ' + a.attributes.endpoint : ''}`,
  'EXP-4': (a) => a.flags.publicNet && 'Networking: public, no VPC',
  'EXP-5': (a) => a.kind === 'agent' && (a.exposure === 'organization' || (a.registration && a.registration.shared === 'organization')) && 'Shared with: everyone in the organization',
  'EXP-6': (a) => a.kind === 'agent' && a.flags.readsWeb && 'Reads: web search, fetches pages',
  'IAM-1': (a) => a.kind === 'agent' && a.flags.makerCreds && `Signs in to tools as: its maker${a.createdBy ? ' (' + a.createdBy + ')' : ''}`,
  'IAM-2': (a) => a.kind === 'agent' && sharedIdentityCount(a) > 1 && `Runs as one identity with ${sharedIdentityCount(a) - 1} other agents`,
  'IAM-3': (a) => a.kind === 'api_key' && !a.revokedKey && !a.expires && 'Expires: never',
  'IAM-4': (a) => a.kind === 'api_key' && a.lastUsed && now() - a.lastUsed > 30 * DAY && `Last used: ${Math.round((now() - a.lastUsed) / DAY)} days ago`,
  'IAM-5': (a) => a.kind === 'api_key' && LEFT_PEOPLE.includes(a.createdBy) && `Made by: ${a.createdBy}, no longer a member`,
  'IAM-6': (a) => a.kind === 'tool' && a.flags.staticKey && 'Signs in with: a static API key',
  'DAT-1': (a) => a.envVars && a.envVars.length > 0 && `Variables: ${a.envVars.join(', ')}`,
  'DAT-3': (a) => a.kind === 'agent' && a.flags.lethal && `Outside input: reachable from outside, searches the web · Private data: ${a.flags.privateData} connector${a.flags.privateData === 1 ? '' : 's'} · Can act: ${a.flags.canAct} tool${a.flags.canAct === 1 ? '' : 's'}`,
  'AGY-1': (a) => {
    if (a.kind === 'tool') return a.flags.destructive && `Destructive: ${a.name}`;
    if (a.kind !== 'agent' || !a.flags.destructive) return false;
    const d = uses(a.id).map((r) => asset(r.to)).find((t) => t && t.kind === 'tool' && t.flags.destructive);
    return d && `Can call: ${d.name}, with no approval step`;
  },
  'AGY-2': (a) => a.kind === 'agent' && a.flags.runsCode && 'Code interpreter: on · Writes its own code',
  'AGY-3': (a) => a.kind === 'agent' && a.orchestration === 'generative' && a.instructionsLength < 200 && `Instructions: ${a.instructionsLength} characters`,
  'AGY-4': (a) => a.kind === 'agent' && a.flags.callsAgents && 'Calls: other agents as tools',
  'SUP-1': (a) => {
    if (a.kind !== 'agent') return false;
    const m = uses(a.id).map((r) => asset(r.to)).find((x) => x && x.kind === 'mcp_server' && x.registry !== 'registered');
    return m && `MCP server: ${m.name}, not in the registry`;
  },
  'RT-1': (a) => a.kind === 'agent' && a.stateCat === 'active' && !a.flags.guarded && !a.flags.viaGateway && 'Guardrail: none · LLM gateway: not routed',
  'RT-2': (a) => a.kind === 'agent' && a.flags.aroundGateway && 'Has a gateway key, and calls the model directly too',
  'GOV-1': (a) => a.registry === 'shadow' && 'Discovered, never registered',
  'GOV-2': (a) => governed(a) && !a.owner && 'Owner: nobody named',
  'GOV-4': (a) => a.owner && LEFT_PEOPLE.includes(a.owner) && `Owner: ${a.owner}, no longer a member`,
  'GOV-5': (a) => a.kind === 'agent' && a.environment === 'Lyzr (default)' && a.stateCat === 'active' && 'Environment: Lyzr (default)',
  'FIN-1': (a) => a.spend30d > 0 && a.registry === 'shadow' && !a.revoked && `Spent ${money(a.spend30d)} in the last 30 days, and no one registered it`,
  'FIN-2': (a) => a.spend30d > 0 && a.revoked && a.registry !== 'registered' && `Spent ${money(a.spend30d)} in the last 30 days, after its registration was revoked`,
  'FIN-3': (a) => { const n = SPEND_FLAG_NOTES[a.name]; return n && n.spike && `Cost ${money(n.spike.amount)} on ${n.spike.day}, against about ${money(n.spike.usual)} a day the week before`; },
  'FIN-4': (a) => { const n = SPEND_FLAG_NOTES[a.name]; return n && n.exponential && 'Spend has doubled about every 4 days this month'; },
  'FIN-5': (a) => a.spend30d > 0 && !a.owner && `Spent ${money(a.spend30d)} in 30 days, and nobody answers for it`,
  'OBS-1': (a) => a.kind === 'agent' && a.stateCat === 'active' && !a.flags.traced && 'Traces: none in 30 days',
  'OBS-2': (a) => a.kind === 'agent' && a.flags.traced && !a.flags.evaluated && 'Traced, no evaluator',
};
export const SEV_ORDER = { Critical: 0, High: 1, Medium: 2, Low: 3 };

export function findings() {
  return memo('findings', () => {
    const out = [];
    const list = live();
    for (const p of S.policies) {
      if (!p.on || !CHECKS[p.code] || p.note) continue;
      for (const a of list) {
        const ev = CHECKS[p.code](a);
        if (ev) out.push({ code: p.code, policy: p, asset: a, severity: p.severity, evidence: ev, category: p.category, cloud: a.cloud });
      }
    }
    return out;
  });
}
export const findingsFor = (assetId) => findings().filter((f) => f.asset.id === assetId).sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]);
export const policy = (code) => S.policies.find((p) => p.code === code);

// ---- spend ----
export const FIN_PILL = { 'FIN-1': 'Unregistered, spending', 'FIN-2': 'Revoked, still spending', 'FIN-3': 'Spike', 'FIN-4': 'Growing fast', 'FIN-5': 'No owner' };
export function needsAttention() {
  return memo('attention', () => {
    const m = new Map();
    for (const f of findings()) if (f.code.startsWith('FIN-')) {
      if (!m.has(f.asset.id)) m.set(f.asset.id, { asset: f.asset, codes: [], reasons: [], critical: false });
      const e = m.get(f.asset.id); e.codes.push(f.code); e.reasons.push(f.evidence); if (f.severity === 'Critical') e.critical = true;
    }
    return [...m.values()].sort((a, b) => b.asset.spend30d - a.asset.spend30d);
  });
}
export function shadowSpend() {
  const l = live().filter((a) => a.registry === 'shadow' && a.spend30d > 0);
  return { total: l.reduce((s, a) => s + a.spend30d, 0), count: l.length, list: l.sort((a, b) => b.spend30d - a.spend30d) };
}

// ---- audit ----
function audit(action, a, reason, outcome) {
  S.audit.unshift({ at: now(), action, asset: a ? a.name : null, assetId: a ? a.id : null, actor: me(), reason: reason || '', outcome: outcome || null });
}
let meEmail = 'you@demo';
export const me = () => meEmail;
export function setMe(email) { meEmail = email || meEmail; }

function patch(a, p) {
  Object.assign(a, p);
  const added = saved.added.find((x) => x.asset.id === a.id);
  if (added) Object.assign(added.asset, p);
  else saved.patches[a.id] = { ...(saved.patches[a.id] || {}), ...p };
}

// ---- governance flows ----
export function requestRegistration(ids, { owner, purpose, shared }) {
  let n = 0;
  for (const id of ids) {
    const a = asset(id);
    if (!a || a.registry !== 'shadow') continue;
    patch(a, { registry: 'awaiting_approval', owner: owner || a.owner, team: a.team });
    S.approvals.unshift({ id: `apr_${R.hex(8)}`, assetId: a.id, owner, purpose, shared, requestedBy: me(), requestedAt: now(), status: 'pending', checks: findingsFor(a.id).length ? `${findingsFor(a.id).length} findings` : 'No findings' });
    audit('Sent for approval', a, purpose, 'registered as pending, for an administrator to approve');
    n++;
  }
  changed();
  return n;
}
export function decide(approvalIds, outcome, reason) {
  let n = 0;
  for (const id of approvalIds) {
    const ap = S.approvals.find((x) => x.id === id);
    if (!ap || ap.status !== 'pending') continue;
    const a = asset(ap.assetId);
    ap.status = outcome; ap.decidedBy = me(); ap.decidedAt = now(); if (reason) ap.reason = reason;
    if (a) {
      if (outcome === 'approved') patch(a, { registry: 'registered', owner: ap.owner, revoked: false, registration: { owner: ap.owner, purpose: ap.purpose, approvedBy: me(), approvedAt: now(), shared: ap.shared, requestedBy: ap.requestedBy } });
      else patch(a, { registry: 'shadow' });
      audit(outcome === 'approved' ? 'Approved' : outcome === 'rejected' ? 'Rejected' : 'Withdrawn', a, reason || ap.purpose, outcome === 'approved' ? 'registered' : 'left shadow');
    }
    n++;
  }
  changed();
  return n;
}
export function revoke(id, reason) {
  const a = asset(id); if (!a) return;
  patch(a, { registry: 'shadow', revoked: true, registration: null });
  audit('Revoked', a, reason, a.spend30d > 0 ? 'still spending: FIN-2 raised' : 'back to shadow');
  changed();
}
export function registerExternal({ name, endpoint, apiFormat, owner, purpose }) {
  const host = (() => { try { return new URL(endpoint).host; } catch { return endpoint; } })();
  const a = {
    id: `ast_${R.hex(16)}`, name, kind: 'agent', cloud: 'external', source: 'external.endpoint', integrationId: null, account: 'registry', environment: null, region: 'global',
    status: null, stateCat: 'na', exposure: 'private', auth: 'required', registry: 'registered', owner, team: null, sponsor: null, createdAt: now(), createdBy: me(), firstDiscovered: now(), lastSynced: now(),
    reportedBy: ['registry'], attributes: { transport: 'http', endpoint, api_format: apiFormat, host, registered_by_hand: 'true' }, envVars: [], spend30d: 0, spendFlags: [], description: purpose, blocked: false, removed: false,
    flags: { traced: false, guarded: false, viaGateway: false }, orchestration: 'generative', instructionsLength: 1000,
    registration: { owner, purpose, approvedBy: me(), approvedAt: now(), shared: 'owner', requestedBy: me() },
  };
  S.assets.push(a); saved.added.push({ asset: a, relations: [] }); index();
  audit('Registered by hand', a, purpose, 'registered');
  changed();
  return a;
}
export function assetAction(id, action, extra = {}) {
  const a = asset(id); if (!a) return;
  if (action === 'block') { patch(a, { blocked: true }); audit('Blocked', a, extra.reason || 'Blocked from the asset page'); }
  if (action === 'unblock') { patch(a, { blocked: false }); audit('Unblocked', a, extra.reason || ''); }
  if (action === 'share') { patch(a, { exposure: extra.org ? 'organization' : a.exposure }); audit(extra.org ? 'Shared with the whole organization' : `Shared with ${extra.person} (can use)`, a, extra.reason || ''); }
  if (action === 'unshare') { patch(a, { exposure: 'private' }); audit('Ended organization-wide sharing', a, extra.reason || ''); }
  if (action === 'gateway') { patch(a, { flags: { ...a.flags, viaGateway: true, aroundGateway: false } }); audit('Routed through the LLM gateway (gw_rekori_01)', a, extra.reason || '', 'its model calls now go through rekori-gateway'); }
  if (action === 'ungateway') { patch(a, { flags: { ...a.flags, viaGateway: false } }); audit('Taken off the LLM gateway', a, extra.reason || ''); }
  if (action === 'delete') { patch(a, { removed: true }); audit('Deleted', a, extra.reason || '', `removed from ${a.source}`); }
  if (action === 'owner') { patch(a, { owner: extra.owner }); audit('Owner changed', a, `Owner is now ${extra.owner}`); }
  if (action === 'rescan') { patch(a, { lastSynced: now() }); }
  changed();
}

// ---- scans ----
let scanSeq = 0;
export const running = () => S.scans.filter((s) => s.status === 'running');
export function runScan(integrationIds) {
  const ids = integrationIds && integrationIds.length ? integrationIds : S.integrations.filter((i) => i.enabled).map((i) => i.id);
  const made = [];
  for (const iid of ids) {
    const integ = S.integrations.find((i) => i.id === iid); if (!integ) continue;
    const fam = FAMILIES[integ.cloud] || ['inventory'];
    const scan = { id: `scn_${R.hex(12)}`, integrationId: iid, cloud: integ.cloud, startedAt: now(), durationMs: 0, status: 'running', sourcesRead: 0, sourcesFailed: 0, sources: [], manual: true };
    S.scans.unshift(scan); made.push(scan);
    const total = fam.length; let i = 0;
    const tick = () => {
      if (i < total) {
        scan.sources.push({ account: integ.account, region: integ.cloud === 'aws' ? 'us-east-1' : integ.cloud === 'gcp' ? 'us-central1' : 'global', family: fam[i], assets: R.chance(0.5) ? 0 : R.int(1, 40) });
        scan.sourcesRead = scan.sources.length; i++;
        for (const fn of listeners) fn('scan');
        setTimeout(tick, 380 + R.int(0, 300));
      } else {
        scan.status = 'succeeded'; scan.durationMs = now() - scan.startedAt;
        integ.verified = now();
        discoverOnScan(integ);
        S.evaluatedAt = now();
        changed();
      }
    };
    setTimeout(tick, 500);
  }
  changed();
  return made;
}
// The first manual Microsoft scan "finds" a new agent, so the visitor sees discovery happen.
function discoverOnScan(integ) {
  scanSeq++;
  const name = integ.cloud === 'microsoft' ? 'procurement-intake-agent' : integ.cloud === 'aws' ? 'agentcore-returns' : integ.cloud === 'gcp' ? 'gcp-quote-builder' : null;
  if (!name || S.assets.some((a) => a.name === name)) return;
  const a = {
    id: `ast_${R.hex(16)}`, name, kind: 'agent', cloud: integ.cloud, source: integ.cloud === 'microsoft' ? 'Copilot Studio' : integ.cloud === 'aws' ? 'Bedrock AgentCore' : 'Agent Runtime',
    integrationId: integ.id, account: integ.account, environment: integ.cloud === 'microsoft' ? 'Lyzr (default)' : null, region: 'global', status: integ.cloud === 'microsoft' ? 'published' : 'active', stateCat: 'active',
    exposure: 'organization', auth: 'required', registry: 'shadow', registration: null, owner: null, team: null, sponsor: null, createdAt: now() - 2 * HOUR, createdBy: 'nina.costa@lyzrdev.onmicrosoft.com',
    firstDiscovered: now(), lastSynced: now(), reportedBy: [`${integ.id}/scan`], attributes: {}, envVars: [], spend30d: 0, spendFlags: [], description: 'New this scan', blocked: false, removed: false, newThisScan: true,
    flags: { readsWeb: true, privateData: 1, canAct: 1, guarded: false, viaGateway: false, traced: false, makerCreds: integ.cloud === 'microsoft' }, orchestration: 'generative', instructionsLength: 640, harness: null,
  };
  S.assets.push(a); saved.added.push({ asset: a, relations: [] }); index();
}

// ---- policies ----
export function setPolicy(code, onOff) {
  const p = policy(code); if (!p) return;
  p.on = onOff; S.evaluatedAt = now();
  S.audit.unshift({ at: now(), action: `Policy ${onOff ? 'turned on' : 'turned off'}`, asset: `${p.code} ${p.title}`, actor: me(), reason: '', outcome: null });
  changed();
}
export function setAllPolicies(onOff) { for (const p of S.policies) p.on = onOff; S.evaluatedAt = now(); changed(); }
export function evaluateNow() { S.evaluatedAt = now(); changed(); }

// ---- gateway ----
export function createKey({ name, belongsTo, mayCall, budget }) {
  const k = { id: `vk_${R.hex(10)}`, name, keyMasked: `sk-bf-…${R.hex(4)}`, belongsTo: belongsTo || null, mayCall, budget, createdAt: now() };
  S.vkeys.unshift(k);
  S.audit.unshift({ at: now(), action: 'Virtual key made', asset: name, actor: me(), reason: budget ? `Budget ${money(budget.limit)} ${budget.period}` : 'No budget', outcome: null });
  changed(); return k;
}
export function deleteKey(id) { S.vkeys = S.vkeys.filter((k) => k.id !== id); changed(); }
export function createTeam(t) { S.gwTeams.push(t); changed(); }

// ---- guardrails ----
export function guardrail(id) { return S.guardrails.find((g) => g.id === id); }
export function updateGuardrail(id, fn) { const g = guardrail(id); if (!g) return; fn(g); g.updatedAt = now(); changed(); }
export function createGuardrail(name, purpose) { const g = newGuardrail(name, { purpose, updatedAt: now() }); g.id = R.hex(24); S.guardrails.push(g); changed(); return g; }

// ---- skills ----
export const skill = (id) => S.skills.find((s) => s.id === id);
function scanVersion(files) {
  const text = files.map((f) => f[1]).join('\n').toLowerCase();
  const found = [];
  if (S.skillSettings.scanWith.length === 0) return { scan: 'none', findings: [] };
  if (/ignore (the user|previous|all)/.test(text)) found.push('Prompt injection: instructions that override the user');
  if (/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/.test(text)) found.push('Personal data: an email address in the skill');
  if (/(sk-[a-z0-9]{8,}|api[_-]?key\s*[:=])/.test(text)) found.push('Secret: something that looks like an API key');
  return { scan: found.length ? 'flagged' : 'passed', findings: found };
}
export function createSkill({ name, description, body }) {
  const files = [['SKILL.md', `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}`]];
  const sc = scanVersion(files);
  const s = { id: `sk_${R.hex(12)}`, name, description, live: null, inMarketplace: false, publications: [], agents: {},
    versions: [{ version: '1.0.0', notes: 'First version', savedBy: me(), savedAt: now(), size: files[0][1].length, scan: sc.scan, findings: sc.findings, files }],
    activity: [{ when: now(), what: 'skill.version_created', who: me(), detail: '1.0.0' }, { when: now(), what: 'skill.created', who: me(), detail: name }] };
  S.skills.unshift(s); changed(); return s;
}
export function newSkillVersion(id, { notes, body }) {
  const s = skill(id); if (!s) return;
  const last = s.versions[s.versions.length - 1];
  const [a, b, c] = last.version.split('.').map(Number);
  const v = `${a}.${b}.${c + 1}`;
  const files = last.files.map((f) => (f[0] === 'SKILL.md' ? [f[0], body] : f));
  const sc = scanVersion(files);
  s.versions.push({ version: v, notes, savedBy: me(), savedAt: now(), size: files.reduce((x, f) => x + f[1].length, 0), scan: sc.scan, findings: sc.findings, files });
  s.activity.unshift({ when: now(), what: 'skill.version_created', who: me(), detail: `${v}, scan ${sc.scan}` });
  changed(); return v;
}
export function makeLive(id, version, overrideReason) {
  const s = skill(id); const v = s && s.versions.find((x) => x.version === version); if (!v) return;
  if (v.scan === 'flagged' && !overrideReason) return false;
  if (overrideReason) { v.override = { by: me(), reason: overrideReason, at: now() }; }
  s.live = version;
  for (const p of s.publications) p.version = version;
  s.activity.unshift({ when: now(), what: 'skill.live', who: me(), detail: `${version}, ${v.scan === 'flagged' ? 'scan overridden: ' + overrideReason : 'scan passed'}` });
  changed(); return true;
}
export function setMarketplace(id, onOff) { const s = skill(id); if (!s) return; s.inMarketplace = onOff; s.activity.unshift({ when: now(), what: 'skill.changed', who: me(), detail: `in the marketplace: ${onOff}` }); changed(); }
export function publishSkill(id, where) { const s = skill(id); if (!s || !s.live) return; s.publications = s.publications.filter((p) => p.where !== where); s.publications.push({ where, version: s.live, at: now() }); s.activity.unshift({ when: now(), what: 'skill.published', who: me(), detail: `${s.live} to ${where}` }); changed(); }
export function deliverSkill(id, agentId, onOff) { const s = skill(id); if (!s) return; s.agents[agentId] = onOff; const a = asset(agentId); s.activity.unshift({ when: now(), what: onOff ? 'skill.delivered' : 'skill.withdrawn', who: me(), detail: a ? a.name : agentId }); changed(); }
export function saveSkillSettings(p) { Object.assign(S.skillSettings, p, { savedBy: me(), savedAt: now() }); changed(); }

// ---- integrations and settings ----
export function setIntegration(id, p) { const i = S.integrations.find((x) => x.id === id); if (i) Object.assign(i, p); changed(); }
export function connectIntegration({ name, cloud, account }) {
  const i = { id: `con_${R.hex(12)}`, name, cloud, account, accountLabel: account, control: 'Control: off', verified: now(), enabled: true, scanEvery: 5, guardrails: 'none' };
  S.integrations.push(i);
  S.audit.unshift({ at: now(), action: 'Connected', asset: name, actor: me(), reason: `${cloud} · ${account}`, outcome: 'verified: read access works' });
  changed(); runScan([i.id]); return i;
}
export function setLicencePrice(name, each) { const l = S.licences.find((x) => x.name === name); if (l) l.each = each; changed(); }
export function saveSettings(p) { Object.assign(S.settings, p); changed(); }
export function addOrgTeam(t) { S.orgTeams.push({ ...t, at: now() }); changed(); }
export function setScanEvery(id, every) { setIntegration(id, { scanEvery: every }); }

export const kindOne = (k) => KIND_ONE[k] || k;
export { INTEGRATIONS, version as _version };
