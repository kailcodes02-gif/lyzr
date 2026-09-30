// Ad platforms that have a place in the sidebar but are not connected yet. One page for all
// of them: the platform comes from ctx.routeDef (js/app.mjs ROUTES).
export const noRange = true;

const PLATFORMS = {
  'ads/google': { name: 'Google Ads', short: 'GA', export: 'Google Ads › Campaigns › Download (segment by day, ad level), or a Google Ads API connection (developer token + OAuth)', api: 'Google Ads API' },
  'ads/meta': { name: 'Meta (Facebook and Instagram)', short: 'ME', export: 'Ads Manager › Reports › Export (breakdown by day, ad level)', api: 'Meta Marketing API' },
  'ads/taboola': { name: 'Taboola', short: 'TB', export: 'Backstage › Reports › Campaign summary › Export (by day)', api: 'Taboola Backstage API' },
  'ads/chatgpt': { name: 'ChatGPT ads', short: 'AI', export: 'the ChatGPT ads report export, by day', api: 'the OpenAI ads reporting API, when available' },
  'ads/x': { name: 'X (Twitter)', short: 'X', export: 'X Ads › Analytics › Export (by day, ad level)', api: 'X Ads API' },
  'ads/bing': { name: 'Microsoft Bing ads', short: 'MS', export: 'Microsoft Advertising › Reports › Campaign or Ad performance (by day), CSV', api: 'Microsoft Advertising API' },
};

export async function render(el, ctx) {
  const { esc } = ctx.fmt;
  const def = ctx.routeDef || {};
  const p = PLATFORMS[def.route] || { name: def.title || 'This platform', short: '··', export: 'an export by day and ad', api: 'its reporting API' };
  el.innerHTML = `<div class="seghead">Ads · ${esc(def.title || p.name)}</div><h1>${esc(p.name)}</h1>
  <div class="intro">Not connected yet. This page will work like LinkedIn: spend, impressions, clicks and leads by day and ad, week-on-week and month-on-month trends, where the ads land, and a Claude read-out, on the same Overview as every other channel.</div>
  <div class="grid g2" style="margin-top:16px">
    <div class="card soonbox"><div class="icotile">${esc(p.short)}</div><div><div class="ui-label">Option 1 · uploads</div><h3 style="margin-top:6px">Drop exports here, like LinkedIn</h3><p class="muted" style="font-size:13.5px">Export ${esc(p.export)}. Send one sample file and the upload box on this page will read it and fill the charts.</p></div></div>
    <div class="card soonbox"><div class="icotile">API</div><div><div class="ui-label">Option 2 · daily pull</div><h3 style="margin-top:6px">Pull it automatically every morning</h3><p class="muted" style="font-size:13.5px">Through the ${esc(p.api)}, in the same 07:00 IST pull as Instantly and HubSpot. Needs access credentials for the ad account, stored as a secret on the site, never in the code.</p></div></div>
  </div>
  <p class="muted" style="font-size:13px;margin-top:16px">To connect it, send a sample export (or the API access) to the dashboard owner.</p>`;
}
