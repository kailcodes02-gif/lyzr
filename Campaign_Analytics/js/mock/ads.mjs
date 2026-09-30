// Demo data for the ad platforms other than LinkedIn. Google Ads and Meta get a small
// deterministic daily history (July to September 2026) so the per-platform pages show
// something in sample mode; the other platforms stay empty so the "not connected" state
// is visible too. Same row shape as ca_li_perf, with `platform`.
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

const CAMPAIGNS = {
  google: [
    { id: 'g-search-agentic', name: 'Search · agentic AI platform (GSI)', group: 'Lyzr GSI', spend: 95, ctr: 0.041, cpc: 4.2, lead: 0.04 },
    { id: 'g-search-brand', name: 'Search · Lyzr brand', group: 'Lyzr GSI', spend: 22, ctr: 0.12, cpc: 1.1, lead: 0.06 },
    { id: 'g-display-playbook', name: 'Display · Enterprise AI Playbook', group: 'Lyzr GSI', spend: 40, ctr: 0.006, cpc: 0.9, lead: 0.005 },
  ],
  meta: [
    { id: 'm-playbook', name: 'Agentic AI Roadmap playbook · decision makers', group: 'Lyzr GSI', spend: 60, ctr: 0.011, cpc: 1.6, lead: 0.012 },
    { id: 'm-retarget', name: 'Retargeting · site visitors', group: 'Lyzr GSI', spend: 25, ctr: 0.018, cpc: 1.2, lead: 0.02 },
  ],
};
const START = { google: '2026-07-14', meta: '2026-08-04' };
const END = '2026-09-24';

function build() {
  const perf = [], uploads = [];
  for (const [platform, camps] of Object.entries(CAMPAIGNS)) {
    const rnd = mulberry32(platform === 'google' ? 7 : 11);
    const jitter = (k = 0.3) => 1 - k + rnd() * 2 * k;
    for (let d = new Date(START[platform] + 'T00:00:00Z'); d <= new Date(END + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)) {
      const day = d.toISOString().slice(0, 10);
      const weekend = [0, 6].includes(d.getUTCDay()) ? 0.45 : 1;
      const ramp = 0.6 + 0.4 * Math.min(1, (d - new Date(START[platform] + 'T00:00:00Z')) / (30 * 864e5));
      for (const c of camps) {
        const spend = c.spend * weekend * ramp * jitter();
        const clicks = Math.round(spend / (c.cpc * jitter(0.2)));
        const impressions = Math.round(clicks / Math.max(0.001, c.ctr * jitter(0.2)));
        const leads = Math.round(clicks * c.lead * jitter(0.6));
        perf.push({ platform, day, campaign_id: c.id, ad_id: c.id + '|a1', campaign_group: c.group, campaign: c.name, ad_name: c.name, objective: platform === 'google' ? (c.id.includes('search') ? 'Search' : 'Display') : 'Leads', format: platform === 'google' ? (c.id.includes('search') ? 'Responsive search ad' : 'Responsive display ad') : 'Single image', impressions, clicks, spend: Math.round(spend * 100) / 100, reach: Math.round(impressions / 2.2), leads, video_views: 0, engagements: clicks, conversions: leads });
      }
    }
    uploads.push({ id: 'u-' + platform, channel: 'linkedin', platform, kind: 'performance', file_name: `${platform}-campaigns-daily-to-${END}.csv`, uploaded_by: 'demo@lyzr.com', uploaded_at: '2026-09-25T04:12:00Z', period_start: START[platform], period_end: END, row_count: perf.filter(r => r.platform === platform).length, notes: null });
  }
  return { perf, uploads };
}

export const adsMock = build();
