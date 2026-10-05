// OpenAPI 3.1 description of the Campaign Analytics data API, built from the source list in _lib/query.js
// and served at /api/ca/v1/openapi.json. Import it into Postman, an agent builder, a GPT action or Claude.
import { SOURCES, TABLES } from '../_lib/query.js'

export function openapi(origin) {
  const paths = {}
  for (const s of SOURCES) {
    const params = Object.entries(s.params).filter(([k]) => !k.startsWith('<')).map(([name, description]) => ({ name, in: 'query', required: /required/.test(description), description, schema: { type: 'string' } }))
    params.push({ name: 'format', in: 'query', required: false, description: 'json (default) or csv (the rows as a CSV file)', schema: { type: 'string', enum: ['json', 'csv'] } })
    paths['/api/ca/v1/' + s.name] = { get: { operationId: s.name.replace(/\W+/g, '_'), summary: s.title, description: s.description + (s.name === 'table' ? '\n\nTables: ' + Object.entries(TABLES).map(([k, v]) => `${k} (${v})`).join('; ') : ''), parameters: params, responses: { 200: { description: 'The data. Always has `source`; list answers have `rows` and `row_count`.', content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } } }, 400: { description: 'Bad parameter: { error: { code, message } }' }, 401: { description: 'Missing or wrong key' } } } }
  }
  paths['/api/ca/v1'] = { get: { operationId: 'index', summary: 'List the sources, their parameters and the tables', responses: { 200: { description: 'Index' } } } }
  return {
    openapi: '3.1.0',
    info: {
      title: 'Lyzr Campaign Analytics data API', version: '1.0.0',
      description: [
        'Read everything the Campaign Analytics dashboard holds: LinkedIn and other ad platform performance, who the ads reached (demographics), penetration against the MD / MD-1 / MD-2 pools by company, region and tier, HubSpot GSI leads and the sales funnel, deals, Instantly email campaigns, PhantomBuster outreach, the action tracker, the lists and rules, and any raw ca_* table.',
        '',
        '**Auth** - send an API key as `Authorization: Bearer <key>`, `x-api-key: <key>` or `?key=<key>`. Keys are created by the owner on the Cloudflare Pages site (secret CA_API_KEYS, "label:key, label:key"). Every key is read-only. A signed-in dashboard session works too.',
        '',
        '**Conventions** - JSON out, dates are `YYYY-MM-DD`, `from` and `to` are inclusive. List answers carry `rows` and `row_count`; add `format=csv` to get the rows as a CSV file. Errors are `{ "error": { "code", "message" } }`. Numbers match the dashboard: the same aggregation code runs on both sides.',
        '',
        '**For an agent** - start with GET /api/ca/v1 (the index) to see the sources and the tables, then call the source that fits. `linkedin/windows` says which dates have data. The same sources are available as MCP tools at /api/ca/mcp.',
      ].join('\n'),
    },
    servers: [{ url: origin }],
    components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer' }, apiKey: { type: 'apiKey', in: 'header', name: 'x-api-key' } } },
    security: [{ bearer: [] }, { apiKey: [] }],
    paths,
  }
}
