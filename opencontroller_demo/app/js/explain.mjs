// "About this screen" cards: what each screen is for, what you can do on it, something to try,
// and where the product flow goes next. TOUR is the guided path through the core loop.
export const TOUR = [
  ['overview', '#/', 'Overview'],
  ['integrations', '#/integrations', 'Integrations'],
  ['inventory', '#/inventory', 'AI Inventory'],
  ['shadow', '#/shadow-ai?tab=list', 'Shadow AI'],
  ['approvals', '#/approvals', 'Approvals'],
  ['registry', '#/registry', 'Registry'],
  ['findings', '#/findings', 'Findings'],
  ['policies', '#/posture/policies', 'Security policies'],
  ['spend', '#/spend', 'Spend'],
  ['gateway', '#/llm-gateway', 'LLM Gateway'],
  ['guardrails', '#/guardrails', 'Guardrails'],
  ['observability', '#/observability', 'Observability'],
  ['evals', '#/evals', 'Evals'],
  ['skills', '#/skills', 'Skills'],
  ['audit', '#/settings/audit-log', 'Audit log'],
];

export const EXPLAIN = {
  overview: { title: 'Overview', what: 'The whole AI estate on one page: how much of it is governed, what needs a second look, and when each cloud was last scanned.',
    how: ['Every number is a link: click Shadow to see what nobody registered.', 'The bars under Governance split each kind into registered, awaiting approval and shadow.'],
    try: 'Click Run scan and watch the sidebar show the scan, then the Latest scan card update. The first Microsoft scan finds a new agent.' },
  integrations: { title: 'Integrations', what: 'Where discovery starts. Each row is a cloud account or tenant opencontroller reads with read-only access, and every scan it ran.',
    how: ['Verify checks the credentials still work.', 'Scans run every 5 minutes per connection; Run scan starts one now.', 'Connect walks through adding another account.'],
    try: 'Press Run scan, then open the scan to watch each source being read.' },
  inventory: { title: 'AI Inventory', what: 'Every agent and everything it uses (models, MCP servers, tools, identities, API keys), as discovered across the clouds, with where each stands in the registry.',
    how: ['Map shows accounts, products, agents and what they use. Red dots count non-compliant assets.', 'List is a filterable table of all 483 assets.'],
    try: 'Turn on Non-compliant only, then click an agent to open its page: graph, findings, ownership and configuration.' },
  asset: { title: 'An asset', what: 'Everything known about one asset: what it is linked to, where it lives, what it costs, what is wrong with it, and who answers for it.',
    how: ['Relations lists what it uses and what uses it.', 'Findings shows each failed check with the evidence and the fix.', 'Actions blocks, shares, routes it through the LLM gateway or deletes it, and each one lands in the audit log.'],
    try: 'If it is shadow, press Register and send it for approval. If it is registered, try Revoke.' },
  shadow: { title: 'Shadow AI', what: 'Discovered assets nobody registered. Registering one names an owner and a purpose and sends it to an administrator for approval.',
    how: ['Spending, and not registered puts the costly ones first.', 'Register a single row, tick several and Register selected, or register a whole connection at once.'],
    try: 'Tick two agents, press Register selected, fill in an owner and purpose. The Approvals badge in the sidebar goes up.' },
  approvals: { title: 'Approvals', what: 'Registration requests waiting for an administrator, and what was decided before.',
    how: ['Approving registers the asset: it moves into the Registry and the Overview percentage goes up.', 'Rejecting leaves it shadow, with your reason on record.'],
    try: 'Approve one request and reject the other with a reason, then open the Decided tab.' },
  registry: { title: 'Registry', what: 'The AI the organization runs on purpose: every approved agent, model, MCP server and key, each with an accountable owner and a stated purpose.',
    how: ['Table and Cards show the same assets.', 'Register external agent adds something no cloud reports, such as a partner endpoint.'],
    try: 'Switch to Cards, then register an external agent by hand.' },
  findings: { title: 'Findings', what: 'The security posture of the estate: what is exposed, misconfigured or ungoverned, and where. Evaluated after every scan.',
    how: ['Cloud, category and the heat map show where problems cluster.', 'Frameworks maps each finding to OWASP LLM, OWASP Agentic, MITRE ATLAS, NIST AI RMF, ISO/IEC 42001 and the EU AI Act.', 'Each policy opens a sheet with the fix and every asset it is open on.'],
    try: 'Open "Credentials in environment variables" to see the evidence on each agent.' },
  policies: { title: 'Security policies', what: 'The 36 detectors posture runs over the inventory, grouped by category or framework. Each one can be turned off.',
    how: ['Turning a policy off removes its findings; turning it on brings them back.', 'Some policies need setup first, and say so.'],
    try: 'Turn off "Shadow assets", then go back to Findings: the count drops by 227.' },
  spend: { title: 'Spend', what: 'What the organization spends on AI: cloud bills joined to the assets that ran them up, licences, and the model calls opencontroller sees itself.',
    how: ['Needs attention flags spend on unregistered assets, spikes and fast growth.', 'Period and provider filters recompute every section.', 'Where the bills go can be grouped by service, provider, account or resource.'],
    try: 'Switch Period to 7 days, then register lyzr-studio-prod straight from Needs attention.' },
  'spend-anthropic': { title: 'Claude spend', what: 'The Claude bill broken down by workspace, API key and person, with keys that need a look.',
    how: ['The treemap sizes each key by its share of the bill.', 'Keys to look at lists keys unused for 30 days, about to expire or never expiring.'],
    try: 'Open the API keys tab and sort out which keys nobody uses.' },
  gateway: { title: 'LLM Gateway', what: 'The gateway in front of the models agents call. Calls, cost, provider health, MCP servers and the virtual keys closest to their budget.',
    how: ['Agents call the gateway with a virtual key; each key limits providers, models and spend.', 'Logs records every call: model, caller, latency and cost.'],
    try: 'Go to Virtual Keys and make a key with a $5 a day budget. It shows up under Closest to budget.' },
  'gateway-keys': { title: 'Virtual keys', what: 'The keys agents and teams call the gateway with: which providers and models each may reach, and how much it may spend.',
    how: ['A budget is an amount per day or per month; the bar shows how much is used.'],
    try: 'Press New key, allow only Anthropic models and give it a budget.' },
  'gateway-teams': { title: 'Teams and customers', what: 'Groups of virtual keys, so spend rolls up and one budget caps a whole team or customer.', how: [], try: 'Make a team with a monthly budget.' },
  'gateway-logs': { title: 'Gateway logs', what: 'Every call that went through the gateway: who made it, to which model, how long it took and what it cost.', how: ['Filter by time window and status, or search prompts.', 'A row opens the call; prompts and answers are hidden for the Viewer role.'], try: 'Filter to Failed and open one: you will see a guardrail block a prompt injection.' },
  'gateway-ph': { title: 'Gateway console', what: 'The gateway has its own console for advanced routing, policies and access. opencontroller embeds it on pages like this one.', how: [], try: 'Use the sidebar groups to see everything the gateway covers.' },
  guardrails: { title: 'Guardrails', what: 'Checks on prompts and answers for personal data, secrets, attacks and unsafe content. A guardrail can run in the gateway, in Claude Code hooks or in your own code.',
    how: ['Each card summarizes what the guardrail does.', 'Use it anywhere shows how to wire it into Claude Code, the OpenAI or Anthropic SDKs, or the gateway.'],
    try: 'Open Customer-facing assistant and run the Injection sample in Try it.' },
  guardrail: { title: 'A guardrail', what: 'The path text takes from prompt to model to answer, every check along it, and a place to try the guardrail on sample text.',
    how: ['Switch checks on and off in the steps; the path diagram and summary update as you go.', 'Try it runs the current settings, saved or not.'],
    try: 'Pick the Personal data sample and press Run: emails and card numbers come back redacted.' },
  observability: { title: 'Observability', what: "Every agent's runs across projects: what there is, whether it is healthy, what broke and what it cost.",
    how: ['The latency grid shows each hour by response time; red squares had failures.', 'Breakdown groups calls by model, provider, agent, tool, team, user or gateway key.'],
    try: 'Change the window to Last 24 hours, then open the nordic-capital project.' },
  'obs-projects': { title: 'Projects', what: 'Traces are grouped into projects by the x-project header. Busiest first.', how: [], try: 'Filter to With errors.' },
  'obs-cost': { title: 'Cost', what: 'What traced model calls cost, how fast it is growing, and how much caching saves.', how: [], try: 'Switch Spend over time to Models.' },
  'obs-project': { title: 'A project', what: 'One project: its traces, spans, sessions, issues, cost and settings.', how: ['Traces lists every run; open one to see its details.'], try: 'Open the Traces tab and filter to failed runs.' },
  evals: { title: 'Evals', what: "Judging agents' traces with LLM-as-a-judge evaluators, test sets and monitors, so a regression shows before users notice.",
    how: ['Get started lists the seven steps from a grading model to a production monitor.', 'Evaluators, Tasks and Scores show what was judged and how it came out.'],
    try: 'Open Scores to see each verdict, or Evaluators to see the label pairs.' },
  'evals-sub': { title: 'Evals', what: 'Evaluators grade traces; tasks run them on a sample of traffic; scores are the verdicts; datasets and prompts are the test sets.', how: [], try: 'Move through the tabs in the sidebar.' },
  finetuning: { title: 'Fine-tuning', what: 'An embedded fine-tuning studio (OpenFinetuner). In the demo it shows the state you would see before the studio address is set.', how: [], try: 'Go back and look at Evals: fine-tuning starts from the traces you judged.' },
  skills: { title: 'Skills', what: "The organization's skills for coding agents: versioned, scanned with its guardrails before one goes live, then delivered to agents.",
    how: ['A version a guardrail flags goes live only when an administrator overrides it with a reason.', 'Skills in the marketplace install into Claude Code as plugins.'],
    try: 'Press New skill and include "ignore previous instructions" in it: the scan flags it.' },
  skill: { title: 'A skill', what: 'One skill: its versions, files, scan results, where it is delivered and what happened to it.', how: ['Make live picks the version agents get.', 'Delivery publishes it to a provider or hands it to agents one by one.'], try: 'Save a new version, then make it live.' },
  marketplace: { title: 'Skills marketplace', what: 'Claude Code adds this marketplace and installs each skill as a plugin, at its live version.', how: ['Only skills whose live version passed its scan are listed.'], try: 'Copy the install command.' },
  'skills-settings': { title: 'Skills settings', what: 'Which guardrails scan every skill version, and how the marketplace is served.', how: [], try: 'Untick both guardrails: versions are then not scanned at all.' },
  scan: { title: 'A scan', what: 'One discovery run: each source read, what it found, and what failed.', how: ['Sources that found nothing are hidden by default.'], try: 'Turn on Show empty sources.' },
  settings: { title: 'Settings', what: 'The organization, its roles and teams, how often each connection is scanned, the audit log and the guardrail engine.', how: [], try: 'Open Roles to see what each role may do. Use the role switch in the top bar to try them.' },
  audit: { title: 'Audit log', what: 'Every change anyone made: registrations, approvals, blocks, sharing, gateway routing, deletes, each with the reason given.',
    how: ['Your own actions in this demo are here too, at the top.'], try: 'Register or approve something, then come back.' },
};

export function explainKey(route) {
  const p = route.path;
  if (p === '/') return 'overview';
  if (p === '/spend') return 'spend';
  if (p.startsWith('/spend/')) return 'spend-anthropic';
  if (p === '/inventory') return 'inventory';
  if (p.startsWith('/inventory/')) return 'asset';
  if (p === '/shadow-ai') return 'shadow';
  if (p === '/approvals') return 'approvals';
  if (p === '/registry') return 'registry';
  if (p === '/skills') return 'skills';
  if (p === '/skills/marketplace') return 'marketplace';
  if (p === '/skills/settings') return 'skills-settings';
  if (p.startsWith('/skills/')) return 'skill';
  if (p === '/llm-gateway') return 'gateway';
  if (p === '/llm-gateway/virtual-keys') return 'gateway-keys';
  if (p === '/llm-gateway/teams') return 'gateway-teams';
  if (p === '/llm-gateway/logs') return 'gateway-logs';
  if (p.startsWith('/llm-gateway/')) return 'gateway-ph';
  if (p === '/guardrails') return 'guardrails';
  if (p.startsWith('/guardrails/')) return 'guardrail';
  if (p === '/findings') return 'findings';
  if (p === '/posture/policies') return 'policies';
  if (p === '/observability') return 'observability';
  if (p === '/observability/projects') return 'obs-projects';
  if (p === '/observability/cost') return 'obs-cost';
  if (p.startsWith('/observability/p/')) return 'obs-project';
  if (p === '/evals') return 'evals';
  if (p.startsWith('/evals/')) return 'evals-sub';
  if (p === '/fine-tuning') return 'finetuning';
  if (p === '/integrations') return 'integrations';
  if (p.startsWith('/integrations/scans/')) return 'scan';
  if (p === '/settings/audit-log') return 'audit';
  if (p.startsWith('/settings')) return 'settings';
  return 'overview';
}
