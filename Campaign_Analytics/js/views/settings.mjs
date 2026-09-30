// Admin: the reference lists every page reads (GSI accounts and designations, regions,
// targets, email rules, reach pools, editors) and the connections, with "pull now" buttons.
// Uploads live on the channel pages (LinkedIn, Instantly), not here.
export const noRange = true;

const TABS = [['gsi', 'GSI accounts'], ['regions', 'Regions'], ['targets', 'Targets'], ['email', 'Email rules'], ['icp', 'Reach pools'], ['editors', 'Editors'], ['connection', 'Connections and pulls']];
const SEED_FILE = { accounts: 'accounts.json', bands: 'band_titles.json', regions: 'regions.json', icp_pool: 'icp_pool.json' };
const DEFAULTS = { targets: { leads_per_month: 200, demo_mqls_per_month: 30, frequency: 3.5, reach_frequency: 3 }, editors: [] };
const REDIRECT_URI = 'https://lyzr.kailash-gm.com/Campaign_Analytics/';
const state = { tab: 'gsi', health: null };

export async function render(el, ctx) {
  if (!state.health) { try { state.health = await ctx.api.get('health'); } catch (e) { state.health = { ok: false, error: e.message }; } }
  if (!ctx.settings) { try { ctx.settings = await ctx.api.get('settings'); } catch { ctx.settings = {}; } }
  const isEditor = !!ctx.demo || !!(state.health && state.health.user && state.health.user.isEditor);
  el.innerHTML = `<div class="seghead">Admin</div><h1>Lists and connections</h1>
  <div class="intro">The lists here decide how every page counts: <b>GSI accounts</b> decide which HubSpot leads are GSI leads and what MD, MD-1 and MD-2 mean at each firm; <b>regions</b> group countries; <b>targets</b> are the monthly goals on the Overview. <b>Connections and pulls</b> shows whether Instantly, HubSpot and Claude are connected, with buttons to pull now instead of waiting for the 07:00 IST daily pull. ${isEditor ? 'You can edit.' : 'You can view; ask an editor to change anything.'}</div>
  <div id="tabs" style="margin-top:16px"></div><div id="tabBody"></div>`;
  const body = el.querySelector('#tabBody');
  const draw = () => { body.innerHTML = ''; TAB_RENDER[state.tab](body, ctx, isEditor); };
  ctx.ui.seg(el.querySelector('#tabs'), TABS.map(([value, label]) => ({ value, label })), v => { state.tab = v; draw(); }, state.tab);
  draw();
}

const TAB_RENDER = { email: emailRulesTab, gsi: async (b, c, e) => { const top = document.createElement('div'); const extra = document.createElement('div'); b.append(top, extra); await settingTab(top, c, e, 'accounts'); await gsiTab(extra, c, e); }, regions: (b, c, e) => settingTab(b, c, e, 'regions'), icp: (b, c, e) => settingTab(b, c, e, 'icp_pool'), targets: (b, c, e) => settingTab(b, c, e, 'targets'), editors: (b, c, e) => settingTab(b, c, e, 'editors'), connection: connectionTab };

// ---------------- generic setting tabs ----------------
const META = {
  accounts: { title: 'GSI accounts and designations', sub: 'This list decides who is a GSI lead. A HubSpot contact who submitted a form is pulled and counted as a GSI lead when their company name matches an account or alias below, or their email domain matches the account\'s website. Each account\'s own titles for MD (the top band, people who sign partnerships), MD-1 and MD-2 are used to band every lead\'s job title. Built from "GSI_SI Accounts – Over All" (owners and designations) and the ABM list export (websites).' },
  regions: { title: 'Regions', sub: 'Which countries roll up into which region. Used wherever a page groups by region: leads by region, where the ads land. A country that is in no list shows as Other.' },
  icp_pool: { title: 'Reach pools', sub: 'How many people work at each account, by country and band (Apollo headcounts). The LinkedIn page divides people reached by these numbers to show how much of each account the ads cover.' },
  targets: { title: 'Targets', sub: 'Monthly goals the Overview compares the current pace against, and two divisors that turn LinkedIn impressions into people: reach heat maps use impressions ÷ 3, penetration uses impressions ÷ 3.5 (people reached = impressions divided by the divisor).' },
  editors: { title: 'Editors', sub: 'People allowed to upload files, change these lists and run pulls. Everyone else at Lyzr can view.' },
};
function readable(key, value, ctx) {
  const { esc, fmt } = ctx.fmt;
  const T = ctx.ui.table;
  if (key === 'accounts') {
    const rows = Array.isArray(value) ? value : [];
    const withBands = rows.filter(a => a.bands).length, withSite = rows.filter(a => a.domain || (a.domains || []).length).length;
    return `<p class="muted" style="font-size:13px;margin-bottom:8px">${fmt(rows.length)} accounts · ${fmt(withBands)} with their own designations · ${fmt(withSite)} matched by website domain as well as name.</p><div style="max-height:560px;overflow:auto">` + T({ cols: [{ h: 'Account', k: 'name', left: true, f: a => `${esc(a.name)}${(a.aliases || []).length ? `<br><span class="muted" style="font-size:11.5px">also: ${esc(a.aliases.join(', '))}</span>` : ''}` }, { h: 'Owner', k: 'owner', left: true, f: a => esc(a.owner || '–') }, { h: 'Country', k: 'country', left: true, f: a => esc(a.country || '–') }, { h: 'Website', k: 'domain', left: true, f: a => `<span class="mono">${esc([...(a.domains || []), ...(a.domain && !(a.domains || []).includes(a.domain) ? [a.domain] : [])].join(', ') || '–')}</span>` }, { h: 'MD', k: 'md', left: true, f: a => esc((a.bands || {}).md || '–') }, { h: 'MD-1', k: 'md1', left: true, f: a => esc((a.bands || {}).md1 || '–') }, { h: 'MD-2', k: 'md2', left: true, f: a => esc((a.bands || {}).md2 || '–') }], rows }) + '</div>';
  }
  if (key === 'bands') {
    const g = value && value.global ? value.global : value || {};
    return T({ cols: [{ h: 'Band', k: 'b', left: true, f: r => `<b>${esc(r.b)}</b>` }, { h: 'LinkedIn job titles', k: 't', left: true, f: r => esc(r.t) }], rows: [['MD', (g.MD || []).join(', ')], ['MD-1', (g.MD1 || []).join(', ')], ['MD-2', (g.MD2 || []).join(', ')], ['Director', g.split || 'Director split 50/50 MD-1 and MD-2']].map(([b, t]) => ({ b, t })) });
  }
  if (key === 'regions') {
    const map = value && value.regions ? value.regions : value || {};
    return T({ cols: [{ h: 'Region', k: 'r', left: true, f: r => `<b>${esc(r.r)}</b>` }, { h: 'Countries', k: 'c', left: true, f: r => esc(r.c) }], rows: Object.entries(map).map(([r, c]) => ({ r, c: (c || []).join(', ') })) });
  }
  if (key === 'icp_pool') {
    const rows = Array.isArray(value) ? value : [];
    return T({ cols: [{ h: 'Account', k: 'company', left: true }, { h: 'Country', k: 'country', left: true }, { h: 'MD', k: 'md', f: r => fmt(r.md) }, { h: 'MD-1', k: 'md1', f: r => fmt(r.md1) }, { h: 'MD-2', k: 'md2', f: r => fmt(r.md2) }, { h: 'All', k: 'all', f: r => fmt((+r.md || 0) + (+r.md1 || 0) + (+r.md2 || 0)) }, { h: 'Source', k: 'source', left: true, f: r => `<span class="muted">${esc(r.source || '')}</span>` }], rows });
  }
  if (key === 'targets') {
    const t = value || {};
    const labels = { leads_per_month: 'Leads a month', demo_mqls_per_month: 'Book a demo MQLs a month', frequency: 'Frequency for penetration (impressions per person, default 3.5)', reach_frequency: 'Impressions per reach for the reach heat maps (default 3)', monthly_budget: 'Monthly budget (USD)' };
    return T({ cols: [{ h: 'Target', k: 'k', left: true, f: r => esc(labels[r.k] || r.k) }, { h: 'Value', k: 'v', f: r => esc(String(r.v)) }], rows: Object.entries(t).map(([k, v]) => ({ k, v })) });
  }
  if (key === 'editors') { const list = Array.isArray(value) ? value : []; return list.length ? `<ul>${list.map(e => `<li>${esc(e)}</li>`).join('')}</ul>` : ctx.ui.empty('No editors set. On the server, the ADMIN list in the Pages Function applies.'); }
  return `<pre class="mono">${esc(JSON.stringify(value, null, 1))}</pre>`;
}
async function settingTab(body, ctx, isEditor, key) {
  const m = META[key];
  body.innerHTML = ctx.ui.section(m.title, m.sub, `<div id="view"></div>${key === 'accounts' ? '<h3 style="margin-top:22px">Titles for accounts without their own designations</h3><p class="muted" style="font-size:13px;margin-bottom:8px">Generic title buckets, used when an account has no MD / MD-1 / MD-2 row above, and for the LinkedIn job-title heat map.</p><div id="viewBands"></div>' : ''}<div id="edit" style="margin-top:18px"></div>`);
  body.querySelector('#view').innerHTML = readable(key, ctx.settings && ctx.settings[key], ctx);
  if (key === 'accounts') body.querySelector('#viewBands').innerHTML = readable('bands', ctx.settings && ctx.settings.bands, ctx);
  const editBox = body.querySelector('#edit');
  if (!isEditor) { editBox.innerHTML = '<p class="muted" style="font-size:13px">Read-only. Ask an editor to change these lists.</p>'; return; }
  const keys = key === 'accounts' ? ['accounts', 'bands'] : [key];
  editBox.innerHTML = keys.map(k => `<details style="margin-top:10px"><summary style="cursor:pointer;font-weight:600">Edit ${k.replace('_', ' ')} as JSON</summary>
    <textarea data-k="${k}" style="width:100%;min-height:220px;font-family:var(--mono);font-size:12.5px;margin-top:8px">${ctx.fmt.esc(JSON.stringify(ctx.settings && ctx.settings[k] != null ? ctx.settings[k] : (DEFAULTS[k] ?? null), null, 1))}</textarea>
    <div class="row" style="margin-top:8px"><button class="btn primary" data-save="${k}">Save</button><button class="btn ghost" data-reset="${k}">Reset to defaults</button><span class="muted" data-msg="${k}" style="font-size:13px"></span></div></details>`).join('');
  editBox.querySelectorAll('[data-save]').forEach(b => b.onclick = async () => {
    const k = b.dataset.save, ta = editBox.querySelector(`textarea[data-k="${k}"]`), msg = editBox.querySelector(`[data-msg="${k}"]`);
    let value; try { value = JSON.parse(ta.value); } catch (e) { msg.textContent = 'Not valid JSON: ' + e.message; return; }
    b.disabled = true; msg.textContent = 'Saving';
    try { await ctx.api.put('settings', { key: k, value }); ctx.settings = { ...(ctx.settings || {}), [k]: value }; msg.textContent = 'Saved.'; ctx.toast(`${k} saved.`); settingTab(body, ctx, isEditor, key); }
    catch (e) { msg.textContent = 'Save failed: ' + (e.message || e); b.disabled = false; }
  });
  editBox.querySelectorAll('[data-reset]').forEach(b => b.onclick = async () => {
    const k = b.dataset.reset, ta = editBox.querySelector(`textarea[data-k="${k}"]`), msg = editBox.querySelector(`[data-msg="${k}"]`);
    try {
      let value = DEFAULTS[k];
      if (SEED_FILE[k]) { const r = await fetch(new URL('../../seed/' + SEED_FILE[k], import.meta.url), { cache: 'no-store' }); if (!r.ok) throw new Error('seed file missing'); value = await r.json(); }
      ta.value = JSON.stringify(value, null, 1); msg.textContent = 'Defaults loaded into the editor. Press Save to apply them.';
    } catch (e) { msg.textContent = 'Could not load defaults: ' + e.message; }
  });
}

// ---------------- Connection ----------------
async function connectionTab(body, ctx) {
  const { esc } = ctx.fmt;
  body.innerHTML = ctx.ui.section('Connection', 'Whether the server can reach its database, HubSpot and Claude, and what to set when it cannot.', ctx.ui.spinner('Checking'));
  try { state.health = await ctx.api.get('health'); } catch (e) { state.health = { ok: false, error: e.message }; }
  const h = state.health || {};
  const row = (name, ok, hint) => `<tr><td class="l"><b>${esc(name)}</b></td><td class="l">${ctx.ui.pill(ok ? 'Connected' : 'Not connected', ok ? 'p-high' : 'p-low')}</td><td class="l">${ok ? '<span class="muted">OK</span>' : esc(hint)}</td></tr>`;
  body.innerHTML = ctx.ui.section('Connection', 'Whether the server can reach its database, HubSpot and Claude, and what to set when it cannot. Secrets are set on the Cloudflare Pages site <span class="mono">lyzr-work-os</span>.',
    `<div class="tblwrap"><table><thead><tr><th class="l">Service</th><th class="l">Status</th><th class="l">Fix</th></tr></thead><tbody>
    ${row('Database (Supabase, ca_* tables)', h.db, 'Set CA_SUPABASE_URL and CA_SUPABASE_KEY (service role key) on the Pages site, then run supabase/001_campaign_analytics.sql.')}
    ${row('HubSpot (read-only)', h.hubspot, 'Set HUBSPOT_ACCESS_TOKEN (private app token) on the Pages site.')}
    ${row('Claude (AI panels)', h.claude, 'Set ANTHROPIC_API_KEY on the Pages site. Until then the AI panels show "Generate" but return an error.')}
    ${row('Instantly API (daily campaign pull)', h.instantly, 'Set INSTANTLY_API_KEY on the Pages site (already used by the GSI Tracker weekly report).')}
    ${row('Daily schedule', h.cron, 'Set CA_CRON_SECRET on the Pages site and the same value as a GitHub Actions secret; .github/workflows/ca-daily-pull.yml runs the pull every morning at 07:00 IST.')}
    </tbody></table></div>
    ${h.error ? `<p class="err" style="margin-top:10px">Health check failed: ${esc(h.error)}</p>` : ''}
    <h3 style="margin-top:22px">Pull now</h3>
    <p class="muted" style="font-size:13px;margin-bottom:10px">Everything below also runs by itself every morning at 07:00 IST. Use these to pull straight away. Pulls only read from Instantly and HubSpot; nothing is written back.</p>
    <div class="grid g3">
      <div class="card"><div class="ui-label">Instantly</div><p style="margin:6px 0 10px;font-size:13px">Every GSI-tagged campaign, full history: sends, opens, clicks, replies, bounces, opportunities per day.</p><button class="btn" data-pull="instantly">Pull Instantly now</button><p class="muted" data-out="instantly" style="font-size:12.5px;margin-top:8px"></p></div>
      <div class="card"><div class="ui-label">HubSpot</div><p style="margin:6px 0 10px;font-size:13px">GSI leads (form submitters at GSI accounts), their owner, status, notes and activity, then Claude reads any new message.</p><button class="btn" data-pull="hubspot">Pull HubSpot now</button><p class="muted" data-out="hubspot" style="font-size:12.5px;margin-top:8px"></p></div>
      <div class="card"><div class="ui-label">Messages</div><p style="margin:6px 0 10px;font-size:13px">Only the Claude step: read lead messages that have not been read yet (Sonnet 5, once per message).</p><button class="btn" data-pull="messages">Read new messages now</button><p class="muted" data-out="messages" style="font-size:12.5px;margin-top:8px"></p></div>
    </div>
    <div class="grid g2" style="margin-top:16px">
      <div class="card"><h3>Signed in as</h3><p>${esc((h.user && (h.user.name || h.user.email)) || (ctx.user && (ctx.user.name || ctx.user.email)) || 'unknown')}${h.user && h.user.email ? ` <span class="muted">(${esc(h.user.email)})</span>` : ''}</p><p class="muted" style="font-size:13px;margin-top:6px">Role: ${ctx.demo ? 'editor (demo mode)' : (h.user && h.user.isEditor ? 'editor' : 'viewer')}</p></div>
      <div class="card"><h3>Microsoft sign-in</h3><p style="font-size:13.5px">The Entra app "Lyzr MS UI" must list this page as a redirect URI (single-page application):</p><p class="mono" style="margin-top:6px;word-break:break-all">${REDIRECT_URI}</p><p class="muted" style="font-size:13px;margin-top:6px">Without it, sign-in fails with a redirect URI mismatch. Demo mode does not need it.</p></div>
    </div>
    <p class="muted" style="font-size:12.5px;margin-top:14px">API base: <span class="mono">/api/ca/</span> · ${ctx.demo ? 'Sample data: nothing is saved.' : 'Live.'}</p>`);
  body.querySelectorAll('[data-pull]').forEach(b => b.onclick = async () => {
    const kind = b.dataset.pull, out = body.querySelector(`[data-out="${kind}"]`);
    b.disabled = true;
    const loop = async (path, label, show) => { let cursor = null; for (let i = 0; i < 500; i++) { const r = await ctx.api.post(path, cursor ? { cursor } : {}); out.textContent = `${label}: ${show(r)}`; if (r.done) return r; cursor = r.cursor || null; } };
    try {
      if (kind === 'instantly') await loop('instantly/sync', 'Instantly', r => `${r.campaigns} campaigns, ${r.days} daily rows${r.progress ? ` (${r.progress.done} of ${r.progress.total})` : ''}`);
      if (kind === 'hubspot') await loop('hubspot/refresh', 'HubSpot', r => `${r.contacts} leads, ${r.notes} notes${r.progress ? ` · ${r.progress.phase} ${r.progress.done} of ${r.progress.total}` : ''}`);
      if (kind === 'hubspot' || kind === 'messages') { let n = 0; for (let i = 0; i < 300; i++) { const r = await ctx.api.post('hubspot/classify', {}); n += r.classified || 0; out.textContent = `Claude has read ${n} message${n === 1 ? '' : 's'}${r.done ? ', all done' : '…'}`; if (r.done) break; } }
      ctx.toast('Pull finished.');
    } catch (e) { out.innerHTML = `<span class="err">${esc(e.message || e)}</span>`; }
    b.disabled = false;
  });
}

// ---------------- Email rules ----------------
async function emailRulesTab(body, ctx, isEditor) {
  const { esc } = ctx.fmt;
  const R = { fast_click_seconds: 180, gsi_page_counts_as_demo: true, link_rules: [], domains: {}, ...((ctx.settings && ctx.settings.email_rules) || {}) };
  const rulesText = (R.link_rules || []).map(r => `${r.match} => ${r.category}${r.label ? ' | ' + r.label : ''}`).join('\n');
  const domText = Object.entries(R.domains || {}).map(([d, c]) => `${d} = ${c}`).join('\n');
  body.innerHTML = ctx.ui.section('Email rules', 'How the Email view reads Instantly events. Changes apply to every campaign, week and account at once, including data already uploaded.', `
    <div class="grid g2">
      <div class="card"><h3>Fast clicks</h3><p class="muted" style="font-size:13px">A click this many seconds after the email was sent (same person, same step) is flagged as a likely security scanner. Flagged clicks stay visible but are left out of human clicks, Book a Demo and every rate.</p>
        <label class="field" style="margin-top:8px">Seconds <input type="number" min="0" max="86400" data-k="fast" value="${esc(R.fast_click_seconds)}" ${isEditor ? '' : 'disabled'} style="width:120px"></label></div>
      <div class="card"><h3>Book a Demo</h3><p class="muted" style="font-size:13px">The direct calendar link always counts. In the GSI sequences every "Book a demo" button points at the GSI/SI page, so a click there can count too (shown as "via GSI/SI page", always split out from direct).</p>
        <label style="display:flex;gap:8px;align-items:center;margin-top:8px"><input type="checkbox" data-k="gsi" ${R.gsi_page_counts_as_demo ? 'checked' : ''} ${isEditor ? '' : 'disabled'}> A GSI/SI page click counts as Book a Demo</label></div>
      <div class="card"><h3>Link types</h3><p class="muted" style="font-size:13px">Extra rules, checked before the built-in ones. One per line: <span class="mono">text or /regex/ =&gt; Category | Label</span>. Categories: Book a Demo, Webinar &amp; Events, Case Studies, Playbooks, Blogs, Product Pages, Assessments &amp; Tools, Analyst &amp; Recognition, Press &amp; News, GSI/SI Partner Page, Website, Other.</p>
        <textarea data-k="rules" style="width:100%;min-height:120px;font-family:var(--mono);font-size:12.5px;margin-top:8px" placeholder="/agentic-roadmap/ => Assessments & Tools | Assessment: Agentic Roadmap" ${isEditor ? '' : 'disabled'}>${esc(rulesText)}</textarea></div>
      <div class="card"><h3>Email domains</h3><p class="muted" style="font-size:13px">Which company an email domain belongs to, when the built-in list or the accounts list gets it wrong. One per line: <span class="mono">domain = Company</span>.</p>
        <textarea data-k="domains" style="width:100%;min-height:120px;font-family:var(--mono);font-size:12.5px;margin-top:8px" placeholder="atkearney.com = Kearney" ${isEditor ? '' : 'disabled'}>${esc(domText)}</textarea></div>
    </div>
    ${isEditor ? '<div class="row" style="margin-top:12px"><button class="btn primary" data-save>Save email rules</button><span class="muted" data-msg style="font-size:13px"></span></div>' : '<p class="muted" style="font-size:13px;margin-top:10px">Read-only. Ask an editor to change these.</p>'}`);
  const save = body.querySelector('[data-save]'); if (!save) return;
  save.onclick = async () => {
    const msg = body.querySelector('[data-msg]');
    const link_rules = body.querySelector('[data-k=rules]').value.split('\n').map(l => l.trim()).filter(Boolean).map(l => { const [m, rest = ''] = l.split('=>'); const [category, label] = rest.split('|').map(x => (x || '').trim()); return { match: (m || '').trim(), category, ...(label ? { label } : {}) }; }).filter(r => r.match && r.category);
    const domains = Object.fromEntries(body.querySelector('[data-k=domains]').value.split('\n').map(l => l.split('=').map(x => x.trim())).filter(([d, c]) => d && c));
    const value = { fast_click_seconds: Number(body.querySelector('[data-k=fast]').value) || 0, gsi_page_counts_as_demo: body.querySelector('[data-k=gsi]').checked, link_rules, domains };
    save.disabled = true; msg.textContent = 'Saving';
    try { await ctx.api.put('settings', { key: 'email_rules', value }); ctx.settings = { ...(ctx.settings || {}), email_rules: value }; msg.textContent = 'Saved. The Email view uses the new rules.'; ctx.toast('Email rules saved.'); }
    catch (e) { msg.textContent = 'Save failed: ' + (e.message || e); }
    save.disabled = false;
  };
}

// ---------------- GSI companies ----------------
async function gsiTab(body, ctx, isEditor) {
  const { esc, fmt } = ctx.fmt;
  const list = Array.isArray(ctx.settings && ctx.settings.gsi_companies) ? ctx.settings.gsi_companies : [];
  body.innerHTML = ctx.ui.section('Extra GSI company names', `Names to treat as GSI on top of the accounts above, one per line: for example a new partner firm that is not in the account list yet. ${fmt(list.length)} extra now.`, `
    <textarea data-k="list" style="width:100%;min-height:140px;font-family:var(--mono);font-size:12.5px" ${isEditor ? '' : 'disabled'}>${esc(list.join('\n'))}</textarea>
    <p class="muted" style="font-size:12.5px;margin-top:6px">After saving, press Pull HubSpot now in Connections and pulls so the pull uses the new list.</p>
    ${isEditor ? '<div class="row" style="margin-top:10px"><button class="btn primary" data-save>Save list</button><span class="muted" data-msg style="font-size:13px"></span></div>' : ''}`);
  const save = body.querySelector('[data-save]'); if (!save) return;
  save.onclick = async () => {
    const msg = body.querySelector('[data-msg]');
    const value = [...new Set(body.querySelector('[data-k=list]').value.split('\n').map(s => s.trim()).filter(Boolean))];
    save.disabled = true; msg.textContent = 'Saving';
    try { await ctx.api.put('settings', { key: 'gsi_companies', value }); ctx.settings = { ...(ctx.settings || {}), gsi_companies: value }; msg.textContent = `Saved ${value.length} companies.`; ctx.toast('GSI company list saved.'); }
    catch (e) { msg.textContent = 'Save failed: ' + (e.message || e); }
    save.disabled = false;
  };
}
