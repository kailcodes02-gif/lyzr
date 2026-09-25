// Lyzr Marketing Tracker: the internal assistant.
// Cloudflare Pages Function. Deliberately tiny: it answers exactly two kinds
// of request — "create a task" (returns a form prefill, the client creates it)
// and "find a task" (returns the matching task id + a one-line answer).
// Anything else gets a polite refusal. Runs on the cheapest model.
//
// POST { message, context: { today, channels:[{id,name,vertical,parent}],
//        users:[{email,name}], tasks:[{id,title,status,channel,vertical,due,owners}] } }
// -> { intent: 'create_task', task: {...} }
//  | { intent: 'find_task', task_id, answer }
//  | { intent: 'clarify', question }
//  | { intent: 'refuse', answer }

const SUPABASE_URL = 'https://xyefbslbihjdczlzjatu.supabase.co'
const MODEL = 'claude-haiku-4-5-20251001'

async function requireUser(request, env) {
  const auth = request.headers.get('Authorization') || ''
  if (!auth.startsWith('Bearer ')) return null
  const res = await fetch(`${env.SUPABASE_URL || SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: auth, apikey: env.SUPABASE_ANON_KEY || '' },
  })
  if (!res.ok) return null
  const user = await res.json()
  return user?.email ? user : null
}

const TOOLS = [
  {
    name: 'create_task',
    description: 'The user wants a new task created. Fill what they said; leave unknown fields out. channel_id must be one of the given channel ids. owner_emails must be from the given users (match names loosely).',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        channel_id: { type: 'string' },
        due_date: { type: 'string', description: 'YYYY-MM-DD, resolved from phrases like tomorrow / Friday / next week using today' },
        priority: { type: 'string', enum: ['P0', 'P1', 'P2', 'P3', 'P4'] },
        owner_emails: { type: 'array', items: { type: 'string' } },
        missing: { type: 'array', items: { type: 'string' }, description: 'Mandatory fields you could not fill: title, channel_id, owner_emails' },
      },
      required: ['title'],
    },
  },
  {
    name: 'find_task',
    description: 'The user asks about an existing task: its status, owner, due date, or where it is. Pick the best matching task id from the list.',
    input_schema: {
      type: 'object',
      properties: {
        task_id: { type: 'string' },
        answer: { type: 'string', description: 'One sentence: status, owner and due date in plain words.' },
        alternatives: { type: 'array', items: { type: 'string' }, description: 'Other plausible task ids, up to 3' },
      },
      required: ['task_id', 'answer'],
    },
  },
  {
    name: 'clarify',
    description: 'You cannot tell which of the two things the user wants, or the task they mean is ambiguous. Ask one short question.',
    input_schema: { type: 'object', properties: { question: { type: 'string' } }, required: ['question'] },
  },
  {
    name: 'refuse',
    description: 'The request is neither creating a task nor finding a task.',
    input_schema: { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'] },
  },
]

function system(ctx) {
  const lines = []
  lines.push('You are the assistant inside the Lyzr Marketing Tracker. You do exactly two things: create a task, or find a task and report its status. Nothing else: no summaries, no analysis, no chit-chat. Always call exactly one tool.')
  lines.push(`Today is ${ctx.today}. Dates are YYYY-MM-DD. The week starts on Monday.`)
  lines.push('Channels (id | vertical › channel):')
  for (const c of ctx.channels || []) lines.push(`${c.id} | ${c.vertical} › ${c.parent ? c.parent + ' › ' : ''}${c.name}`)
  lines.push('People (email | name):')
  for (const u of ctx.users || []) lines.push(`${u.email} | ${u.name || ''}`)
  lines.push('Tasks (id | status | vertical › channel | due | owners | title):')
  for (const t of ctx.tasks || []) lines.push(`${t.id} | ${t.status} | ${t.vertical} › ${t.channel} | ${t.due || '-'} | ${(t.owners || []).join(',') || '-'} | ${t.title}`)
  return lines.join('\n')
}

export async function onRequestPost({ request, env }) {
  const user = await requireUser(request, env)
  if (!user) return json({ error: 'Sign in to the tracker first' }, 401)
  if (!env.ANTHROPIC_API_KEY) return json({ error: 'Assistant is not configured (ANTHROPIC_API_KEY missing)' }, 500)

  let body
  try { body = await request.json() } catch { return json({ error: 'Bad JSON' }, 400) }
  const message = String(body?.message || '').slice(0, 2000).trim()
  if (!message) return json({ error: 'Say what you need' }, 400)
  const ctx = body?.context || {}
  ctx.today = ctx.today || new Date().toISOString().slice(0, 10)
  // Keep the prompt bounded.
  ctx.channels = (ctx.channels || []).slice(0, 400)
  ctx.users = (ctx.users || []).slice(0, 200)
  ctx.tasks = (ctx.tasks || []).slice(0, 600)

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 400,
      system: system(ctx),
      tools: TOOLS,
      tool_choice: { type: 'any' },
      messages: [{ role: 'user', content: `${user.email} says: ${message}` }],
    }),
  })
  if (!res.ok) return json({ error: `Model error ${res.status}: ${(await res.text()).slice(0, 200)}` }, 502)
  const data = await res.json()
  const call = (data.content || []).find(b => b.type === 'tool_use')
  if (!call) return json({ intent: 'refuse', answer: 'I can only create a task or find one.' })
  const input = call.input || {}
  switch (call.name) {
    case 'create_task': {
      const validChannel = ctx.channels.some(c => c.id === input.channel_id)
      const owners = (input.owner_emails || []).filter(e => ctx.users.some(u => u.email === e))
      return json({ intent: 'create_task', task: { ...input, channel_id: validChannel ? input.channel_id : null, owner_emails: owners } })
    }
    case 'find_task': {
      const ok = ctx.tasks.some(t => t.id === input.task_id)
      if (!ok) return json({ intent: 'clarify', question: 'I could not find that task. Which channel or a few words from its title?' })
      return json({ intent: 'find_task', task_id: input.task_id, answer: input.answer, alternatives: (input.alternatives || []).filter(id => ctx.tasks.some(t => t.id === id)).slice(0, 3) })
    }
    case 'clarify': return json({ intent: 'clarify', question: input.question })
    default: return json({ intent: 'refuse', answer: input.answer || 'I can only create a task or find one.' })
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } })
}
