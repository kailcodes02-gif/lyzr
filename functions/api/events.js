// =============================================================================
// Cloudflare Pages Function: /api/events   (GSI & SI Event Intelligence)
// =============================================================================
//   GET  /api/events            -> read events.json from GitHub (live)
//   POST /api/events            -> add a new event   (EDITORS only)
//   PUT  /api/events?id=EVT-0001 -> edit / assign an event (EDITORS only)
//
// Reuses the SAME Cloudflare env vars as the prototype pipeline function:
//   GITHUB_OWNER, GITHUB_REPO, GITHUB_TOKEN, GITHUB_BRANCH
// The events file path is fixed here (does NOT use GITHUB_PATH, which the
// pipeline function already points at pipeline/data.json).
// =============================================================================

const EVENTS_PATH = 'GSIEvents/events.json';

// View access = any verified @lyzr.ai account. Write access (add/edit/assign) =
// only these emails. Edit this list to add/remove editors.
const EDITOR_EMAILS = [
  'subs@lyzr.ai',        // Kailash (admin)
  'kailash.gm@lyzr.ai',  // Kailash (admin)
  'ani@lyzr.ai',         // Anirudh
  'ankita@lyzr.ai',      // Ankita
  'anju@lyzr.ai',        // Anju
  'kailcodes02@gmail.com', // dev fallback
];

const CATS = ['hosted_open', 'hosted_invite_only', 'hosted_internal', 'attending'];
const BUCKET = {
  hosted_open: 'Hosted – Open (external can join)',
  hosted_invite_only: 'Hosted – Invite-only',
  hosted_internal: 'Hosted – Internal (employee-facing)',
  attending: 'Attending / Sponsoring',
};
const PARTICIPATION = ['', 'going', 'attending', 'sponsoring', 'not_going', 'revisit_next_year'];

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
    },
  });
}

function parseEmails(v) {
  if (!v) return [];
  if (Array.isArray(v)) return [...new Set(v.map((s) => String(s).trim().toLowerCase()).filter(Boolean))];
  return [...new Set(String(v).split(/[,;\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean))];
}

async function verifyGoogleToken(accessToken) {
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const p = await res.json();
    const email = (p.email || '').toLowerCase();
    const verified = p.email_verified === true || p.email_verified === 'true';
    const isLyzr = verified && (email.endsWith('@lyzr.ai') || p.hd === 'lyzr.ai' || email === 'kailcodes02@gmail.com');
    if (!isLyzr) return null;
    return { name: p.name, email, isEditor: EDITOR_EMAILS.map((e) => e.toLowerCase()).includes(email) };
  } catch {
    return null;
  }
}

async function ghGet(env) {
  const url = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${EVENTS_PATH}?ref=${env.GITHUB_BRANCH || 'main'}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'lyzr-gsi-events-fn',
    },
  });
  if (!res.ok) throw Object.assign(new Error(`GitHub GET ${res.status}`), { status: res.status });
  const meta = await res.json();
  const content = atob(meta.content.replace(/\n/g, ''));
  return { data: JSON.parse(content), sha: meta.sha };
}

async function ghPut(env, data, sha, message) {
  const url = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${EVENTS_PATH}`;
  const content = btoa(unescape(encodeURIComponent(JSON.stringify(data, null, 1))));
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      'User-Agent': 'lyzr-gsi-events-fn',
    },
    body: JSON.stringify({ message, content, sha, branch: env.GITHUB_BRANCH || 'main' }),
  });
  if (!res.ok) throw Object.assign(new Error(`GitHub PUT ${res.status}: ${await res.text()}`), { status: res.status });
  return res.json();
}

// read-modify-write with SHA-conflict retry
async function commit(env, mutate, buildMsg, maxAttempts = 4) {
  let last;
  for (let i = 0; i < maxAttempts; i++) {
    const { data, sha } = await ghGet(env);
    const r = mutate(data);
    if (r === null) return null;
    try {
      await ghPut(env, data, sha, buildMsg(r));
      return r;
    } catch (e) {
      if (e.status === 409 || e.status === 422) { last = e; continue; }
      throw e;
    }
  }
  throw new Error('SHA conflict after retries: ' + (last && last.message));
}

function nextId(events) {
  let max = 0;
  for (const e of events) {
    const m = (e.id || '').match(/EVT-(\d+)/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `EVT-${String(max + 1).padStart(4, '0')}`;
}

function envReady(env) {
  return env.GITHUB_OWNER && env.GITHUB_REPO && env.GITHUB_TOKEN;
}

// ---- GET -------------------------------------------------------------------
export async function onRequestGet({ env }) {
  if (!envReady(env)) return json({ error: 'GitHub env vars not configured' }, 503);
  try {
    const { data } = await ghGet(env);
    return json(data);
  } catch (e) {
    return json({ error: e.message }, 502);
  }
}

// ---- POST (add) ------------------------------------------------------------
export async function onRequestPost({ request, env }) {
  const auth = (request.headers.get('Authorization') || '');
  if (!auth.startsWith('Bearer ')) return json({ error: 'Missing Authorization' }, 401);
  const user = await verifyGoogleToken(auth.slice(7));
  if (!user) return json({ error: 'Not a verified @lyzr.ai account' }, 403);
  if (!user.isEditor) return json({ error: 'Only designated editors can add events' }, 403);
  if (!envReady(env)) return json({ error: 'GitHub env vars not configured' }, 503);

  let b;
  try { b = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  if (!b.event_name || !b.company || !b.category) return json({ error: 'event_name, company, category required' }, 400);
  if (!CATS.includes(b.category)) return json({ error: 'Invalid category' }, 400);

  try {
    const row = await commit(env, (data) => {
      const events = data.events || (data.events = []);
      const rec = {
        id: nextId(events),
        company: String(b.company).trim(),
        event_name: String(b.event_name).trim(),
        category: b.category,
        hosting_bucket: BUCKET[b.category],
        role: b.role || '',
        startup_friendly: !!b.startup_friendly,
        event_type: b.event_type || '',
        date: b.date || '',
        start_iso: b.start_iso || null,
        end_iso: b.end_iso || b.start_iso || null,
        city: b.city || '',
        country: b.country || '',
        region: b.region || '',
        format: b.format || '',
        registration: b.registration || '',
        url: b.url || '',
        evidence: b.evidence || '',
        confidence: b.confidence || 'medium',
        month: b.month || '',
        status: b.status || '',
        owner: parseEmails(b.owner),
        attendees: parseEmails(b.attendees),
        participation: PARTICIPATION.includes(b.participation) ? b.participation : '',
        source: 'added',
        created_by: user.email,
        created_at: new Date().toISOString(),
      };
      events.push(rec);
      data.counts = { ...(data.counts || {}), total: events.length };
      return rec;
    }, (r) => `events: add "${r.event_name}" [${r.id}] by ${user.email}`);
    return json({ success: true, event: row }, 201);
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}

// ---- PUT (edit / assign) ---------------------------------------------------
const EDITABLE = ['company', 'event_name', 'category', 'role', 'startup_friendly', 'event_type',
  'date', 'start_iso', 'end_iso', 'city', 'country', 'region', 'format', 'registration', 'url',
  'evidence', 'confidence', 'month', 'status', 'owner', 'attendees', 'participation'];

export async function onRequestPut({ request, env }) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return json({ error: 'Missing ?id=' }, 400);
  const auth = (request.headers.get('Authorization') || '');
  if (!auth.startsWith('Bearer ')) return json({ error: 'Missing Authorization' }, 401);
  const user = await verifyGoogleToken(auth.slice(7));
  if (!user) return json({ error: 'Not a verified @lyzr.ai account' }, 403);
  if (!user.isEditor) return json({ error: 'Only designated editors can edit/assign events' }, 403);
  if (!envReady(env)) return json({ error: 'GitHub env vars not configured' }, 503);

  let b;
  try { b = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  if (b.category && !CATS.includes(b.category)) return json({ error: 'Invalid category' }, 400);

  try {
    const res = await commit(env, (data) => {
      const events = data.events || [];
      const ev = events.find((e) => e.id === id);
      if (!ev) return null;
      for (const f of EDITABLE) {
        if (b[f] === undefined) continue;
        if (f === 'owner' || f === 'attendees') ev[f] = parseEmails(b[f]);
        else if (f === 'startup_friendly') ev[f] = !!b[f];
        else if (f === 'participation') ev[f] = PARTICIPATION.includes(b[f]) ? b[f] : '';
        else if (f === 'category') { ev.category = b.category; ev.hosting_bucket = BUCKET[b.category]; }
        else ev[f] = b[f];
      }
      ev.updated_by = user.email;
      ev.updated_at = new Date().toISOString();
      return ev;
    }, (r) => `events: edit "${r.event_name}" [${id}] by ${user.email}`);
    if (res === null) return json({ error: `Event ${id} not found` }, 404);
    return json({ success: true, event: res });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}
