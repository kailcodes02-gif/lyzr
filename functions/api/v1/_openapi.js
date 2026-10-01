// OpenAPI 3.1 description of /api/v1 — served at /api/v1/openapi.json.
// Import it into Postman, an agent builder or a GPT action.

const ref = name => ({ $ref: `#/components/schemas/${name}` })
const ok = (schema, description = 'OK') => ({ description, content: { 'application/json': { schema: { type: 'object', properties: { data: schema } } } } })
const listOf = s => ({ type: 'array', items: s })
const q = (name, description, schema = { type: 'string' }) => ({ name, in: 'query', required: false, description, schema })
const idParam = { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' }, description: 'Task id' }
const scopeParams = [
  q('vertical', 'Vertical slug, name or id (e.g. gsi). Omit for every vertical — the Lyzr board.'),
  q('channel', 'Channel id; includes its sub-channels.'),
]
const body = (schema, required = true) => ({ required, content: { 'application/json': { schema } } })
const noContent = { 204: { description: 'Done — no body' } }

export const OPENAPI = {
  openapi: '3.1.0',
  info: {
    title: 'Lyzr Marketing Tracker API',
    version: '1.0.0',
    description: [
      'Read and change everything in the Lyzr Marketing Tracker: tasks, sub-tasks, owners, comments, checklists, dependencies, channels, verticals, domains, people, campaigns, weekly and summary numbers, and History. There is one board; verticals are tags on tasks (`vertical` filters by tag), and channels are shared.',
      '',
      '**Auth** — `Authorization: Bearer lzt_…`. Admins create keys in Workspace settings › Integrations. A key acts as the admin who created it, with exactly their permissions; every change is logged in History under their name. **Read** keys can only GET; **write** keys can also POST, PATCH and DELETE — except deleting a task, which needs a key with “Can delete tasks” (otherwise 403 `delete_not_allowed`; set status `cancelled` instead). Keys can expire.',
      '',
      '**Limits** — 60 requests a minute per key; beyond that you get 429 `rate_limited` with a `Retry-After` header (seconds). Every accepted request is logged for admins.',
      '',
      '**Conventions** — JSON in and out. Success is `{ "data": … }`; errors are `{ "error": { "code", "message" } }`. Dates are `YYYY-MM-DD`. Priority is `critical | high | medium | low | backlog` (P0–P4 also accepted). Status is `not_started | in_progress | live | blocked | done | cancelled`.',
    ].join('\n'),
  },
  security: [{ apiKey: [] }],
  components: {
    securitySchemes: { apiKey: { type: 'http', scheme: 'bearer', description: 'An lzt_… API key' } },
    schemas: {
      Error: { type: 'object', properties: { error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' } } } } },
      Owner: { type: 'object', properties: { email: { type: 'string' }, name: { type: ['string', 'null'] }, role: { enum: ['primary', 'secondary', 'tertiary', 'other'] }, signed_in: { type: 'boolean' } } },
      Task: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' }, title: { type: 'string' }, description: { type: ['string', 'null'] },
          status: { enum: ['not_started', 'in_progress', 'live', 'blocked', 'done', 'cancelled'] },
          priority: { enum: ['critical', 'high', 'medium', 'low', 'backlog'] }, priority_code: { enum: ['P0', 'P1', 'P2', 'P3', 'P4'] },
          due_date: { type: ['string', 'null'], format: 'date' }, overdue: { type: 'boolean' },
          vertical: { type: ['object', 'null'], properties: { id: { type: 'string' }, slug: { type: 'string' }, name: { type: 'string' } } },
          channel: { type: ['object', 'null'], description: 'null when the task has no channel', properties: { id: { type: 'string' }, name: { type: 'string' }, parent: { type: ['object', 'null'] } } },
          owners: listOf(ref('Owner')), parent_task_id: { type: ['string', 'null'] }, campaign_id: { type: ['string', 'null'] },
          budget: { type: ['number', 'null'] }, plan: { type: 'object', description: 'Plan fields (how often, importance tier, target…)' },
          results: { type: 'object', description: 'Results fields (result achieved, money spent, proof link…)' },
          blocked_reason: { type: ['string', 'null'] }, created_at: { type: 'string' }, updated_at: { type: 'string' },
          went_live_at: { type: ['string', 'null'] }, completed_at: { type: ['string', 'null'] }, url: { type: ['string', 'null'] },
        },
      },
      TaskDetail: {
        allOf: [ref('Task'), { type: 'object', properties: {
          subtasks: listOf(ref('Task')),
          checklist: listOf({ type: 'object', properties: { id: { type: 'string' }, text: { type: 'string' }, done: { type: 'boolean' } } }),
          comments: listOf({ type: 'object', properties: { id: { type: 'string' }, text: { type: 'string' }, author: { type: 'string' }, created_at: { type: 'string' } } }),
          depends_on: listOf({ type: 'object' }), blocks: listOf({ type: 'object' }), history: listOf({ type: 'object' }),
        } }],
      },
      NewTask: {
        type: 'object', required: ['title'],
        properties: {
          title: { type: 'string' }, description: { type: 'string' },
          vertical: { type: 'string', description: 'The task’s vertical tag (slug, name or id). Omitted: the parent’s tags, else Lyzr (= not vertical-specific).' },
          verticals: { type: 'array', items: { type: 'string' }, description: 'Several vertical tags — the task shows in each of those views.' },
          channel_id: { type: 'string', description: 'Any channel — channels are shared across verticals. Omit for “No channel”.' },
          parent_task_id: { type: 'string', description: 'Makes it a sub-task (inherits the parent’s channel).' },
          owners: { description: 'Emails, first is the main owner; or { email, role } objects. Default: the key’s owner.', type: 'array', items: { oneOf: [{ type: 'string' }, { type: 'object', properties: { email: { type: 'string' }, role: { type: 'string' } } }] } },
          due_date: { type: 'string', format: 'date' }, priority: { type: 'string' }, campaign_id: { type: 'string' },
          budget: { type: 'number' }, plan: { type: 'object' },
        },
      },
      TaskPatch: {
        type: 'object',
        properties: {
          title: { type: 'string' }, description: { type: 'string' }, status: { type: 'string' }, priority: { type: 'string' },
          due_date: { type: ['string', 'null'] }, channel_id: { type: 'string' }, campaign_id: { type: ['string', 'null'] },
          budget: { type: ['number', 'null'] }, blocked_reason: { type: ['string', 'null'] },
          plan: { type: 'object', description: 'Merged into the existing plan fields' }, results: { type: 'object', description: 'Merged into the existing results fields' },
          verticals: { type: 'array', items: { type: 'string' }, description: 'Replaces the task’s vertical tags' },
        },
      },
    },
    responses: {
      Error: { description: 'Error', content: { 'application/json': { schema: ref('Error') } } },
    },
  },
  paths: {
    '/me': { get: { summary: 'Who this key acts as, its scope, delete permission and expiry', tags: ['Account'], responses: { 200: ok({ type: 'object', properties: { email: { type: 'string' }, name: { type: ['string', 'null'] }, role: { type: 'string' }, key_scope: { enum: ['read', 'write'] }, can_delete_tasks: { type: 'boolean' }, key_expires_at: { type: ['string', 'null'], format: 'date-time' } } }) } } },
    '/summary': { get: { summary: 'The All Tasks tiles: total, done, not done, live, blocked, overdue, critical', tags: ['Dashboards'], parameters: scopeParams, responses: { 200: ok({ type: 'object' }) } } },
    '/weekly': { get: { summary: 'Weekly review: planned, done, not done, overdue carried in', tags: ['Dashboards'], parameters: [...scopeParams, q('from', 'Start date (default: this Monday)'), q('to', 'End date (default: this Sunday)')], responses: { 200: ok({ type: 'object' }) } } },
    '/history': { get: { summary: 'Every logged change, newest first (includes deleted tasks)', tags: ['Dashboards'], parameters: [...scopeParams, q('task', 'Only this task'), q('since', 'ISO timestamp'), q('limit', 'Max 500 (default 50)')], responses: { 200: ok(listOf({ type: 'object' })) } } },
    '/verticals': { get: { summary: 'Verticals (Lyzr is the primary one)', tags: ['Structure'], responses: { 200: ok(listOf({ type: 'object' })) } } },
    '/channels': { get: { summary: 'Channels and sub-channels with their owners', tags: ['Structure'], parameters: [q('vertical', 'Vertical slug, name or id')], responses: { 200: ok(listOf({ type: 'object' })) } } },
    '/domains': { get: { summary: 'Domains with owners and the channels they cover', tags: ['Structure'], responses: { 200: ok(listOf({ type: 'object' })) } } },
    '/people': { get: { summary: 'Everyone and their roles', tags: ['Structure'], responses: { 200: ok(listOf({ type: 'object' })) } } },
    '/campaigns': { get: { summary: 'Campaigns, launches and thunderclaps with progress', tags: ['Structure'], responses: { 200: ok(listOf({ type: 'object' })) } } },
    '/tasks': {
      get: {
        summary: 'List tasks', tags: ['Tasks'],
        parameters: [
          ...scopeParams,
          q('status', 'Comma-separated statuses'), q('priority', 'Comma-separated priorities'), q('owner', 'Owner email'),
          q('due_from', 'YYYY-MM-DD'), q('due_to', 'YYYY-MM-DD'), q('overdue', 'true = open and past due'),
          q('q', 'Text in the title'), q('campaign', 'Campaign id'), q('parent', 'Sub-tasks of this task'),
          q('top_level', 'false = include sub-tasks (default true)'), q('include_cancelled', 'true to include cancelled'),
          q('sort', 'due_date (default) | created_at | updated_at | priority'), q('limit', '1–500 (default 100)'), q('offset', 'For paging'),
        ],
        responses: { 200: { description: 'OK', content: { 'application/json': { schema: { type: 'object', properties: { data: listOf(ref('Task')), total: { type: 'integer' }, limit: { type: 'integer' }, offset: { type: 'integer' } } } } } } },
      },
      post: { summary: 'Create a task', tags: ['Tasks'], requestBody: body(ref('NewTask')), responses: { 201: ok(ref('TaskDetail'), 'Created'), 400: { $ref: '#/components/responses/Error' } } },
    },
    '/tasks/{id}': {
      parameters: [idParam],
      get: { summary: 'One task with sub-tasks, checklist, comments, dependencies and history', tags: ['Tasks'], responses: { 200: ok(ref('TaskDetail')), 404: { $ref: '#/components/responses/Error' } } },
      patch: { summary: 'Update a task (marking done is refused while it depends on unfinished tasks, unless ?force=true)', tags: ['Tasks'], parameters: [q('force', 'true to close despite open dependencies')], requestBody: body(ref('TaskPatch')), responses: { 200: ok(ref('TaskDetail')), 409: { $ref: '#/components/responses/Error' } } },
      delete: { summary: 'Delete a task (and its sub-tasks); History keeps a record. Needs a key with “Can delete tasks”.', tags: ['Tasks'], responses: { ...noContent, 403: { $ref: '#/components/responses/Error' } } },
    },
    '/tasks/{id}/subtasks': { parameters: [idParam], post: { summary: 'Add a sub-task', tags: ['Tasks'], requestBody: body(ref('NewTask')), responses: { 201: ok(ref('TaskDetail'), 'Created') } } },
    '/tasks/{id}/comments': { parameters: [idParam], post: { summary: 'Comment on a task', tags: ['Tasks'], requestBody: body({ type: 'object', required: ['text'], properties: { text: { type: 'string' } } }), responses: { 201: ok({ type: 'object' }, 'Created') } } },
    '/tasks/{id}/checklist': { parameters: [idParam], post: { summary: 'Add a checklist item', tags: ['Tasks'], requestBody: body({ type: 'object', required: ['text'], properties: { text: { type: 'string' }, done: { type: 'boolean' } } }), responses: { 201: ok({ type: 'object' }, 'Created') } } },
    '/tasks/{id}/checklist/{itemId}': {
      parameters: [idParam, { name: 'itemId', in: 'path', required: true, schema: { type: 'string' } }],
      patch: { summary: 'Tick / untick or rename a checklist item', tags: ['Tasks'], requestBody: body({ type: 'object', properties: { done: { type: 'boolean' }, text: { type: 'string' } } }), responses: { 200: ok({ type: 'object' }) } },
      delete: { summary: 'Remove a checklist item', tags: ['Tasks'], responses: noContent },
    },
    '/tasks/{id}/owners': { parameters: [idParam], post: { summary: 'Add an owner (people not signed in yet are attached on first sign-in)', tags: ['Tasks'], requestBody: body({ type: 'object', required: ['email'], properties: { email: { type: 'string' }, role: { enum: ['primary', 'secondary', 'tertiary', 'other'] } } }), responses: { 201: ok(listOf(ref('Owner')), 'Created') } } },
    '/tasks/{id}/owners/{email}': { parameters: [idParam, { name: 'email', in: 'path', required: true, schema: { type: 'string' } }], delete: { summary: 'Remove an owner', tags: ['Tasks'], responses: noContent } },
    '/tasks/{id}/dependencies': { parameters: [idParam], post: { summary: 'Link: this task depends on another', tags: ['Tasks'], requestBody: body({ type: 'object', required: ['depends_on_task_id'], properties: { depends_on_task_id: { type: 'string' } } }), responses: { 201: ok(listOf({ type: 'object' }), 'Created') } } },
    '/tasks/{id}/dependencies/{dependsOnId}': { parameters: [idParam, { name: 'dependsOnId', in: 'path', required: true, schema: { type: 'string' } }], delete: { summary: 'Remove a link', tags: ['Tasks'], responses: noContent } },
  },
}
