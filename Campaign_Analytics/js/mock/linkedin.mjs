// Demo data for the LinkedIn ads channel. Generated deterministically (seeded PRNG) from the
// monthly, program, ad set, day-by-day and demographics figures in the GSI GTM Review report
// (April to September 24, 2026). Nothing here is hardcoded row by row; rows are built at import time.
//
// export linkedinMock = { uploads:[...], perf:[daily ad rows], demo:[{ upload, rows }] }

function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const rnd = mulberry32(20260924);
const jitter = (k = 0.25) => 1 - k + rnd() * 2 * k;

// ---- report figures ----
const MONTHS = ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'];
const DIM = [30, 31, 30, 31, 31, 24]; // data stops on Sep 24
const MON = {
  spend: [511.24, 820.6, 698.47, 2456.56, 3341.15, 4470.34], impr: [886, 258, 6533, 68127, 51310, 312312], clicks: [27, 28, 53, 520, 580, 2826],
  leads: [2, 5, 0, 8, 16, 97], reach: [876, 253, 6230, 66349, 45746, 292911], sends: [208, 435, 19, 409, 0, 710], opens: [71, 189, 7, 186, 0, 440],
  video: [0, 0, 0, 0, 4884, 59370], forms: [4, 6, 0, 12, 53, 219], eng: [140, 295, 66, 1562, 2187, 11182],
};
const STAGE = {
  spend: { ToFu: [283.04, 106.89, 698.47, 821.52, 1601.67, 1380.06], MoFu: [0, 0, 0, 1183.96, 1739.48, 2437.52], BoFu: [228.2, 713.71, 0, 451.08, 0, 652.76] },
  leads: { ToFu: [0, 0, 0, 0, 0, 0], MoFu: [0, 0, 0, 8, 16, 93], BoFu: [2, 5, 0, 0, 0, 4] },
  impr: { ToFu: [886, 258, 6533, 59789, 33829, 237675], MoFu: [0, 0, 0, 8338, 17481, 70794], BoFu: [0, 0, 0, 0, 0, 3843] },
};
const SEPT = {
  spend: [174.03, 353.1, 325.99, 261.34, 146.22, 117.14, 175.16, 206.32, 195.74, 104.93, 126.85, 59.97, 73.65, 62.99, 395.5, 381.39, 376.37, 217.25, 127.78, 114.02, 132.9, 150.92, 125.89, 64.89],
  leads: [5, 6, 9, 8, 3, 12, 7, 4, 5, 7, 3, 1, 1, 2, 1, 6, 4, 3, 4, 2, 3, 0, 1, 0],
  impr: [1946, 17576, 36294, 32153, 17426, 13481, 24147, 25440, 20819, 14563, 10162, 6217, 6098, 8510, 11858, 15020, 12880, 8485, 6235, 5315, 6027, 5448, 4305, 1907],
};
const PB = (name, w) => ({ name, w, format: 'Document ad' });
const PLAYBOOKS = [PB('Agentic AI Roadmap: the 90-day plan for GSI practice leads', 91), PB('Enterprise AI Playbook: from pilots to production', 18), PB('Agents to Production: what breaks and how to fix it', 8)];
const VERTICAL = [PB('Banking and Compliance Playbook: agents inside the control plane', 1), PB('Fundraising Playbook: AI diligence for deal teams', 1), PB('HR Playbook: agents for talent operations', 1)];
const PERSONA = [{ name: 'You are renting intelligence. Every model you use today is borrowed (Siva)', w: 5, format: 'Video ad' }, { name: 'McKinsey now makes 25% of client fees from outcome-based contracts (Anju)', w: 3, format: 'Single image ad' }, { name: 'Agents need a control plane, not a chat window (Ani)', w: 2, format: 'Video ad' }];
const MSG = who => [{ name: `${who}: Quick question about your agentic AI practice`, w: 1, format: 'Conversation ad' }];
// Ad sets (LinkedIn campaigns) grouped into programs (campaign groups). months = indices into MONTHS, start = optional first day.
const CAMPAIGNS = [
  { prog: 'LinkedIn Ads-GSI & SI|Playbook Lead Gen', obj: 'Lead generation', stage: 'MoFu', name: "Native Targeting(Heatmap)|GSI|Playbooks-2 Sept'26", months: [5], start: '2026-09-02', spend: 638.97, leads: 56, impr: 26863, ads: PLAYBOOKS },
  { prog: 'LinkedIn Ads-GSI & SI|Playbook Lead Gen', obj: 'Lead generation', stage: 'MoFu', name: "Playbooks|GSI&SI|Seniorities|Lead Gen- 14 Aug'26", months: [4, 5], start: '2026-08-14', spend: 1352.67, leads: 27, impr: 11929, ads: PLAYBOOKS },
  { prog: 'LinkedIn Ads-GSI & SI|Playbook Lead Gen', obj: 'Lead generation', stage: 'MoFu', name: "Retargeting Aud|GSI&SI|Playbooks - 21 July'26", months: [3, 4, 5], start: '2026-07-21', spend: 1811.48, leads: 17, impr: 32799, ads: PLAYBOOKS },
  { prog: 'LinkedIn Ads-GSI & SI|Playbook Lead Gen', obj: 'Lead generation', stage: 'MoFu', name: "Native Targeting|SI|Playbooks-16 Sept'26", months: [5], start: '2026-09-16', spend: 1032.9, leads: 14, impr: 20613, ads: PLAYBOOKS.slice(0, 2) },
  { prog: 'LinkedIn Ads-GSI & SI|Playbook Lead Gen', obj: 'Lead generation', stage: 'MoFu', name: 'Custom Aud|GSI&SI|Playbooks|Lead Gen- 1/09/26', months: [5], start: '2026-09-01', spend: 82.51, leads: 3, impr: 1197, ads: PLAYBOOKS.slice(0, 1) },
  { prog: 'LinkedIn Ads-GSI & SI|Playbook Lead Gen', obj: 'Lead generation', stage: 'MoFu', name: "HR Playbooks|GSI&SI|Seniorities|Lead Gen - 21 July'26", months: [3], start: '2026-07-21', spend: 60.27, leads: 0, impr: 534, ads: [VERTICAL[2]] },
  { prog: 'LinkedIn Ads-GSI & SI|Playbook Lead Gen', obj: 'Lead generation', stage: 'MoFu', name: "All Playbooks|GSI&SI|Lead Gen - 18 June'26", months: [3], start: '2026-07-01', spend: 154.96, leads: 0, impr: 924, ads: [VERTICAL[1], PLAYBOOKS[2]] },
  { prog: 'LinkedIn Ads-GSI & SI|Playbook Lead Gen', obj: 'Lead generation', stage: 'MoFu', name: "Banking Playbooks|GSI&SI|Seniorities|Lead Gen - 21 July'26", months: [3], start: '2026-07-21', spend: 60.95, leads: 0, impr: 496, ads: [VERTICAL[0]] },
  { prog: 'LinkedIn Ads-GSI & SI|Workshop|Lead Gen', obj: 'Lead generation', stage: 'MoFu', name: "Workshop|GSI&SI|L&D|Lead Gen - 12 Aug'26", months: [4], start: '2026-08-12', spend: 86.06, leads: 0, impr: 427, video: 90, ads: [{ name: 'Agentic AI workshop for delivery leaders (2 hours, hands on)', w: 1, format: 'Video ad' }] },
  { prog: 'GSI & SI Lead Gen|Conversion', obj: 'Lead generation', stage: 'BoFu', name: 'WP|Accenture|Anju|India|Lead Gen|GSI&SI - Apr 27, 2026', months: [0, 1], start: '2026-04-27', spend: 941.91, leads: 7, impr: 0, sends: 643, opens: 260, ads: MSG('Anju') },
  { prog: 'GSI & SI Lead Gen|Conversion', obj: 'Lead generation', stage: 'BoFu', name: "ANI|Priority Acc|GSI/SI- 3 July'26", months: [3], start: '2026-07-03', spend: 288.92, leads: 0, impr: 0, sends: 290, opens: 132, ads: MSG('Ani') },
  { prog: 'GSI & SI Lead Gen|Conversion', obj: 'Lead generation', stage: 'BoFu', name: "Jessica|Priority Acc|GSI/SI- 9 July'26", months: [3], start: '2026-07-09', spend: 152.08, leads: 0, impr: 0, sends: 119, opens: 54, ads: MSG('Jessica') },
  { prog: 'GSI & SI Lead Gen|Conversion', obj: 'Lead generation', stage: 'BoFu', name: "GSI&SI|ANI|Conversation Ads|Lead Gen- 26 Aug'26", months: [5], start: '2026-09-01', spend: 323.62, leads: 2, impr: 0, sends: 420, opens: 262, ads: MSG('Ani') },
  { prog: 'GSI & SI Lead Gen|Conversion', obj: 'Lead generation', stage: 'BoFu', name: "GSI&SI|ANI|Conversation Ads|Lead Gen- 4 Sept'26", months: [5], start: '2026-09-04', spend: 137.77, leads: 1, impr: 0, sends: 180, opens: 110, ads: MSG('Ani') },
  { prog: 'GSI & SI Lead Gen|Conversion', obj: 'Lead generation', stage: 'BoFu', name: "GSI&SI|ANI|Conversation Ads|NativeLead Gen- 2 Sept'26", months: [5], start: '2026-09-02', spend: 90.58, leads: 0, impr: 0, sends: 110, opens: 68, ads: MSG('Ani') },
  { prog: 'GSI & SI Lead Gen|Book a Demo', obj: 'Lead generation', stage: 'BoFu', name: 'GSI&SI|Book a demo|Lead generation - Sep 18, 2026', months: [5], start: '2026-09-18', spend: 100.79, leads: 1, impr: 3843, ads: [{ name: 'Book a 30 minute demo of Lyzr Agent Studio', w: 1, format: 'Single image ad' }] },
  { prog: 'LinkedIn Ads-GSI & SI|brand Awareness Campaign', obj: 'Brand awareness', stage: 'ToFu', name: "Brand Awareness|GSI&SI|Named Accounts|Ghost Ads - 12 June'26", months: [2, 3], start: '2026-06-12', spend: 1149, leads: 0, impr: 63706, ads: PERSONA.slice(1) },
  { prog: 'LinkedIn Ads-GSI & SI|brand Awareness Campaign', obj: 'Brand awareness', stage: 'ToFu', name: "Brand Awareness|GSI&SI|Persona Video|Siva|Anju|Ani - 5 Aug'26", months: [4, 5], start: '2026-08-05', spend: 1500, leads: 0, impr: 100000, video: 64164, ads: PERSONA },
  { prog: 'LinkedIn Ads-GSI & SI|brand Awareness Campaign', obj: 'Brand awareness', stage: 'ToFu', name: "Brand Awareness|GSI|Native Targeting(Heatmap)|India - 1 Sept'26", months: [5], start: '2026-09-01', spend: 920, leads: 0, impr: 163305, ads: PERSONA.slice(0, 2) },
  { prog: 'Middle East Awareness - Brand Awareness - 12/06/2026', obj: 'Brand awareness', stage: 'ToFu', name: 'Middle East|UAE Govt|Al Rajhi|GSI ME - Awareness - 10 Aug\'26', months: [4, 5], start: '2026-08-10', spend: 450.3, leads: 0, impr: 7097, ads: [{ name: 'Sovereign AI agents for Gulf enterprises (Arabic and English)', w: 1, format: 'Single image ad' }] },
  { prog: 'Lyzr Personas Post Amplification|Engagement', obj: 'Engagement', stage: 'ToFu', name: "Anju Control Plane|Post Engagement - Apr'26", months: [0, 1], start: '2026-04-03', spend: 390, leads: 0, impr: 1144, ads: [{ name: 'Thought leader post: the agent control plane (Anju)', w: 1, format: 'Thought leader ad' }] },
  { prog: 'Nvidia & AWS Post Amplification', obj: 'Engagement', stage: 'ToFu', name: "Nvidia|AWS|Partnership Posts|Engagement - 8 July'26", months: [3, 4], start: '2026-07-08', spend: 195.21, leads: 0, impr: 1628, ads: [{ name: 'Thought leader post: Lyzr on NVIDIA and AWS (Siva)', w: 1, format: 'Thought leader ad' }] },
  { prog: 'GSI & SI Lead Gen| Website visits', obj: 'Website visits', stage: 'ToFu', name: "Assessment|Survey|Target Accounts|Website visits - 18 June'26", months: [2, 3], start: '2026-06-18', spend: 286.74, leads: 0, impr: 2090, sends: 19, opens: 7, ads: [{ name: 'Take the 5 minute agentic readiness assessment', w: 1, format: 'Single image ad' }] },
];

// ---- helpers ----
const monthDays = mi => { const y = 2026, m = +MONTHS[mi].slice(5); return Array.from({ length: DIM[mi] }, (_, i) => `${y}-${String(m).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`); };
const dow = iso => new Date(iso + 'T00:00:00Z').getUTCDay();
// Rows are stored sparse: numeric zeros are dropped except the core metrics (readers treat a missing metric as 0).
const KEEP = new Set(['impressions', 'clicks', 'spend', 'leads']);
const sparse = row => { for (const k of Object.keys(row)) if (row[k] === 0 && !KEEP.has(k)) delete row[k]; return row; };
// Largest-remainder rounding of an array of non-negative reals to integers with the same (rounded) total.
function roundKeep(arr, total = null) {
  const T = total == null ? Math.round(arr.reduce((a, b) => a + b, 0)) : total;
  const fl = arr.map(v => Math.floor(v)); let rem = T - fl.reduce((a, b) => a + b, 0);
  const order = arr.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0]);
  for (let k = 0; rem > 0 && k < order.length; k++, rem--) fl[order[k][1]]++;
  return fl;
}
// Iterative proportional fitting: matrix [campaign][month] with row targets (campaign totals) and column targets (stage-month totals).
function ipf(rowT, colT, active, iters = 12) {
  const R = rowT.length, C = colT.length;
  let m = rowT.map((r, i) => colT.map((c, j) => active[i][j] ? Math.max(1e-6, r * c) : 0));
  for (let it = 0; it < iters; it++) {
    for (let i = 0; i < R; i++) { const s = m[i].reduce((a, b) => a + b, 0); if (s > 0 && rowT[i] > 0) m[i] = m[i].map(v => v * rowT[i] / s); }
    for (let j = 0; j < C; j++) { let s = 0; for (let i = 0; i < R; i++) s += m[i][j]; for (let i = 0; i < R; i++) m[i][j] = s > 0 ? m[i][j] * colT[j] / s : 0; }
  }
  return m;
}

// ---- build performance rows ----
function buildPerf() {
  const rows = [];
  const stageIdx = { ToFu: [], MoFu: [], BoFu: [] };
  CAMPAIGNS.forEach((c, i) => stageIdx[c.stage].push(i));
  const alloc = { spend: [], impr: [], leads: [] };
  for (const st of ['ToFu', 'MoFu', 'BoFu']) {
    const idx = stageIdx[st];
    const active = idx.map(i => MONTHS.map((_, mi) => CAMPAIGNS[i].months.includes(mi) ? 1 : 0));
    for (const k of ['spend', 'impr', 'leads']) {
      const rowT = idx.map(i => CAMPAIGNS[i][k] || 0);
      const m = ipf(rowT, STAGE[k][st], active);
      idx.forEach((ci, r) => { alloc[k][ci] = m[r]; });
    }
  }
  // leads: integers per stage-month
  for (const st of ['ToFu', 'MoFu', 'BoFu']) for (let mi = 0; mi < 6; mi++) { const idx = stageIdx[st]; const vals = idx.map(ci => alloc.leads[ci][mi]); const r = roundKeep(vals, STAGE.leads[st][mi]); idx.forEach((ci, k) => { alloc.leads[ci][mi] = r[k]; }); }
  // sends/opens/video/forms per campaign-month (by month totals)
  const monthShare = (key, mi, filter) => { const idx = CAMPAIGNS.map((c, i) => i).filter(i => CAMPAIGNS[i].months.includes(mi) && filter(CAMPAIGNS[i])); const w = idx.map(i => CAMPAIGNS[i][key] || 0); const s = w.reduce((a, b) => a + b, 0); return { idx, w: w.map(x => s ? x / s : 1 / (idx.length || 1)) }; };
  let adCounter = 1000;
  const adIds = new Map();
  CAMPAIGNS.forEach((c, ci) => {
    c.id = String(200000 + ci * 37);
    c.ads.forEach(a => { const k = c.id + a.name; if (!adIds.has(k)) adIds.set(k, String(adCounter += 13)); });
  });
  for (let mi = 0; mi < 6; mi++) {
    const days = monthDays(mi);
    const ctrMonth = MON.clicks[mi] / Math.max(1, MON.impr[mi]);
    const sendsShare = monthShare('sends', mi, c => c.sends), videoShare = monthShare('video', mi, c => c.video);
    const perCamp = [];
    CAMPAIGNS.forEach((c, ci) => {
      if (!c.months.includes(mi)) return;
      const spend = alloc.spend[ci][mi], impr = alloc.impr[ci][mi], leads = alloc.leads[ci][mi];
      const si = sendsShare.idx.indexOf(ci), vi = videoShare.idx.indexOf(ci);
      const sends = si >= 0 ? MON.sends[mi] * sendsShare.w[si] : 0, opens = si >= 0 ? MON.opens[mi] * sendsShare.w[si] : 0;
      const video = vi >= 0 ? MON.video[mi] * videoShare.w[vi] : 0;
      perCamp.push({ ci, spend, impr, leads, sends, opens, video });
    });
    // forms: lead-objective campaigns, proportional to leads (+ a little for spend)
    const fw = perCamp.map(p => CAMPAIGNS[p.ci].obj === 'Lead generation' ? p.leads * 2 + p.spend / 200 : 0); const fs = fw.reduce((a, b) => a + b, 0);
    perCamp.forEach((p, k) => { p.forms = fs ? MON.forms[mi] * fw[k] / fs : 0; });
    // clicks: impressions x campaign CTR profile, scaled to month total
    const cw = perCamp.map(p => p.impr * (CAMPAIGNS[p.ci].stage === 'ToFu' ? 1.1 : 0.55) * (CAMPAIGNS[p.ci].obj === 'Engagement' ? 6 : 1)); const cs = cw.reduce((a, b) => a + b, 0);
    perCamp.forEach((p, k) => { p.clicks = cs ? MON.clicks[mi] * cw[k] / cs : 0; });
    const es = perCamp.reduce((a, p) => a + p.impr + p.opens * 3, 0);
    perCamp.forEach(p => { p.eng = es ? MON.eng[mi] * (p.impr + p.opens * 3) / es : 0; });
    for (const p of perCamp) {
      const c = CAMPAIGNS[p.ci];
      const activeDays = days.filter(d => (!c.start || d >= c.start));
      if (!activeDays.length) continue;
      // day weights: September follows the report's day-by-day shape, other months a weekday pattern
      const wt = key => activeDays.map(d => { const di = +d.slice(8) - 1; const base = mi === 5 ? (SEPT[key][di] || 1) / (SEPT[key].reduce((a, b) => a + b, 0) / 24) : (dow(d) === 0 || dow(d) === 6 ? 0.55 : 1); return base * jitter(0.35); });
      const norm = w => { const s = w.reduce((a, b) => a + b, 0); return w.map(x => s ? x / s : 0); };
      const wS = norm(wt('spend')), wI = norm(wt('impr')), wL = norm(wt('leads'));
      const dayLeads = roundKeep(wL.map(w => w * p.leads), p.leads);
      // One ad per campaign per day, rotated so each ad gets its weight share of days (keeps the data small).
      const adW = norm(c.ads.map(a => a.w)); const cum = adW.map((w, i) => adW.slice(0, i + 1).reduce((a, b) => a + b, 0));
      activeDays.forEach((d, di) => {
        const pick = (di * 0.6180339887 + 0.17) % 1; const ai = Math.max(0, cum.findIndex(x => pick < x));
        const a = c.ads[ai], spend = p.spend * wS[di], impr = p.impr * wI[di];
        const leads = dayLeads[di];
        const sends = Math.round(p.sends * wS[di]), opens = Math.round(p.opens * wS[di]);
        if (spend < 0.01 && impr < 1 && !sends && !leads) return;
        const row = {
          day: d, campaign_group: c.prog, campaign: c.name, campaign_id: c.id, ad_id: adIds.get(c.id + a.name), ad_name: a.name, objective: c.obj, format: a.format,
          impressions: Math.round(impr), clicks: Math.round(p.clicks * wI[di] * jitter(0.3)) + (sends && rnd() < opens * 0.015 ? 1 : 0), spend: Math.round(spend * 100) / 100,
          reach: Math.round(impr * (0.9 + 0.06 * rnd())), leads, lead_forms_opened: Math.round(p.forms * wL[di] + (leads ? leads * 0.9 : 0)),
          video_views: Math.round(p.video * wI[di]), sends, opens, engagements: Math.round(p.eng * wI[di] + opens * 0.6),
          reactions: Math.round(impr * 0.0025 * jitter(0.5)), comments: rnd() < 0.05 ? 1 : 0, shares: rnd() < 0.04 ? 1 : 0, follows: rnd() < 0.08 ? 1 : 0,
          viral_impressions: Math.round(impr * 0.01 * jitter(0.6)), conversions: leads ? Math.round(leads * 0.3) : 0,
        };
        if (row.lead_forms_opened < row.leads) row.lead_forms_opened = row.leads;
        rows.push(sparse(row));
      });
    }
  }
  rows.sort((a, b) => a.day < b.day ? -1 : a.day > b.day ? 1 : a.campaign.localeCompare(b.campaign));
  return rows;
}

// ---- demographics ----
const ACC = {
  rows: ['Accenture', 'EY', 'Deloitte', 'KPMG', 'PwC', 'McKinsey & Company', 'Boston Consulting Group (BCG)', 'Bain & Company', 'Tata Consultancy Services', 'Infosys', 'Wipro', 'HCLTech', 'Tech Mahindra', 'Cognizant', 'LTIMindtree', 'Capgemini', 'Genpact', 'DXC Technology', 'Persistent Systems', 'NTT DATA', 'Fujitsu', 'Virtusa', 'CGI', 'EPAM Systems', 'Publicis Sapient', 'UST', 'Thoughtworks'],
  Impressions: [[2021, 23, 9220, 11438, 6478, 32996], [0, 36, 230, 11172, 8605, 39296], [0, 37, 140, 9164, 8309, 33102], [0, 12, 5684, 3206, 3770, 8007], [0, 0, 200, 4705, 4602, 9758], [0, 0, 0, 1355, 3246, 2948], [0, 0, 0, 1425, 3081, 5178], [0, 0, 0, 1311, 1431, 2998], [0, 13, 1806, 2093, 810, 1629], [0, 0, 287, 1481, 1592, 17334], [0, 0, 465, 2747, 1378, 16358], [0, 0, 664, 4892, 2124, 24071], [0, 0, 210, 1102, 722, 9564], [0, 12, 1241, 0, 0, 16458], [0, 0, 1028, 1443, 586, 6201], [0, 9, 0, 0, 0, 12661], [0, 0, 0, 3263, 932, 19621], [0, 0, 0, 466, 0, 4240], [0, 0, 0, 0, 0, 4261], [0, 0, 0, 0, 0, 1657], [0, 0, 918, 0, 0, 0], [0, 0, 233, 0, 0, 2345], [0, 0, 182, 0, 0, 0], [0, 0, 0, 702, 298, 2859], [0, 0, 0, 0, 0, 2185], [0, 0, 0, 0, 0, 1797], [0, 0, 0, 1343, 0, 0]],
  Clicks: [[28, 0, 56, 167, 47, 349], [0, 0, 0, 28, 69, 362], [0, 0, 0, 37, 75, 290], [0, 0, 34, 4, 33, 67], [0, 0, 0, 12, 33, 74], [0, 0, 0, 12, 73, 35], [0, 0, 0, 7, 53, 51], [0, 0, 0, 4, 26, 28], [0, 0, 12, 36, 6, 31], [0, 0, 0, 13, 21, 143], [0, 0, 0, 32, 14, 154], [0, 0, 0, 60, 20, 192], [0, 0, 0, 12, 6, 87], [0, 0, 11, 0, 0, 156], [0, 0, 4, 16, 3, 51], [0, 0, 0, 0, 0, 111], [0, 0, 0, 16, 12, 175], [0, 0, 0, 9, 0, 34], [0, 0, 0, 0, 0, 46], [0, 0, 0, 0, 0, 13], [0, 0, 16, 0, 0, 0], [0, 0, 0, 0, 0, 23], [0, 0, 0, 0, 0, 0], [0, 0, 0, 7, 0, 23], [0, 0, 0, 0, 0, 33], [0, 0, 0, 0, 0, 16], [0, 0, 0, 8, 0, 0]],
  Sends: [[619, 526, 237, 59, 28, 209], [0, 0, 0, 0, 15, 29], [0, 0, 3, 0, 6, 26], [0, 0, 86, 0, 10, 9], [0, 0, 0, 0, 3, 18], [0, 0, 0, 250, 5, 33], [0, 0, 0, 0, 0, 21], [0, 0, 0, 0, 0, 5], [0, 0, 75, 0, 5, 72], [0, 0, 0, 29, 0, 43], [0, 0, 0, 0, 8, 49], [0, 0, 0, 0, 11, 79], [0, 0, 0, 0, 7, 22], [0, 0, 0, 0, 0, 21], [0, 0, 0, 0, 0, 7], [0, 0, 0, 0, 0, 16], [0, 0, 0, 0, 0, 14], [0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0], [0, 0, 17, 0, 0, 0], [0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 8], [0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0]],
  Opens: [[201, 229, 92, 27, 15, 114], [0, 0, 0, 0, 9, 29], [0, 0, 0, 0, 4, 16], [0, 0, 34, 0, 8, 4], [0, 0, 0, 0, 0, 11], [0, 0, 0, 112, 0, 23], [0, 0, 0, 0, 0, 11], [0, 0, 0, 0, 0, 3], [0, 0, 29, 0, 0, 30], [0, 0, 0, 17, 4, 36], [0, 0, 0, 0, 4, 28], [0, 0, 0, 0, 10, 49], [0, 0, 0, 0, 0, 14], [0, 0, 0, 0, 0, 12], [0, 0, 0, 0, 0, 5], [0, 0, 0, 0, 0, 13], [0, 0, 0, 0, 0, 10], [0, 0, 0, 0, 0, 3], [0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0], [0, 0, 9, 0, 0, 0], [0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 3], [0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0]],
};
// Page-name variants so alias matching is exercised in demo mode.
const PAGE_ALIAS = { KPMG: ['KPMG', 'KPMG US', 'KPMG India'], Accenture: ['Accenture', 'Accenture in India', 'Accenture Strategy & Consulting'] };
const SEN = { rows: ['Entry', 'Senior', 'Manager', 'Director', 'VP', 'CXO', 'Partner', 'Owner'], vals: [[0, 145, 2864, 364, 682, 485], [0, 657, 6216, 25955, 15610, 170420], [46, 910, 18099, 40987, 20107, 97778], [398, 1941, 34330, 23866, 14373, 34862], [2008, 760, 6712, 6665, 8510, 13523], [41, 1036, 2500, 586, 846, 768], [196, 611, 2845, 3302, 13514, 22820], [27, 692, 1875, 719, 1041, 797]] };
const GEO = { rows: ['India', 'United States', 'United Kingdom', 'Saudi Arabia', 'United Arab Emirates', 'Australia', 'Singapore', 'Japan', 'Canada', 'Europe (ex-UK)', 'Other Middle East', 'SEA (MY, PH)'], vals: [[0, 0, 24055, 56621, 14075, 252161], [2014, 2460, 694, 12886, 34676, 8319], [0, 2290, 877, 2395, 3887, 10962], [0, 0, 19661, 609, 2255, 2687], [0, 0, 12305, 1160, 2690, 7004], [0, 0, 1165, 1250, 0, 5323], [0, 0, 0, 381, 42, 1354], [0, 0, 603, 759, 49, 11], [0, 0, 205, 0, 0, 0], [0, 0, 843, 3326, 28, 0], [0, 0, 0, 0, 791, 1581], [0, 0, 122, 194, 0, 49]] };
const GEO_SPLIT = { 'Europe (ex-UK)': [['Germany', 0.5], ['France', 0.3], ['Netherlands', 0.2]], 'Other Middle East': [['Qatar', 0.6], ['Oman', 0.4]], 'SEA (MY, PH)': [['Malaysia', 0.5], ['Philippines', 0.5]] };
// Titles from seed/band_titles.json plus Director (split) and non-ICP titles.
const TITLES = {
  MD: [['Partner', 5], ['Managing Director', 4], ['Managing Partner', 1.5], ['Senior Vice President', 2], ['Founder', 1.5], ['Board Member', 0.4]],
  MD1: [['Vice President', 5], ['Associate Director', 4], ['Senior Director', 2.5], ['Principal', 2.5], ['Assistant Vice President', 2], ['Associate Partner', 1]],
  MD2: [['Senior Manager', 6], ['Engagement Manager', 2], ['General Manager', 1.5], ['Delivery Manager', 2], ['Delivery Head', 1], ['Technical Manager', 1.2], ['Manager Management Consulting', 1]],
  DIR: [['Director', 6]],
  OTHER: [['Senior Consultant', 6], ['Consultant', 5], ['Manager', 5], ['Senior Software Engineer', 4], ['Software Engineer', 3], ['Senior Analyst', 3], ['Business Analyst', 2.5], ['Project Manager', 3], ['Data Scientist', 2], ['Solution Architect', 2.5], ['Associate', 2]],
};
const FUNCS = [['Consulting', 22], ['Information Technology', 20], ['Engineering', 14], ['Business Development', 9], ['Operations', 8], ['Program and Project Management', 7], ['Finance', 5], ['Sales', 4], ['Marketing', 3], ['Human Resources', 3], ['Research', 2], ['Product Management', 3]];
const CITIES = { India: [['Bengaluru', 30], ['Mumbai Metropolitan Region', 18], ['Delhi NCR', 17], ['Hyderabad', 12], ['Pune', 10], ['Chennai', 8], ['Kolkata', 5]], 'United States': [['New York City Metropolitan Area', 35], ['San Francisco Bay Area', 20], ['Dallas-Fort Worth Metroplex', 15], ['Greater Chicago Area', 15], ['Washington DC-Baltimore Area', 15]], 'United Kingdom': [['London Area', 100]], 'Saudi Arabia': [['Riyadh', 100]], 'United Arab Emirates': [['Dubai', 80], ['Abu Dhabi', 20]], Australia: [['Sydney', 60], ['Melbourne', 40]], Singapore: [['Singapore', 100]], Japan: [['Tokyo', 100]], Canada: [['Greater Toronto Area', 100]] };
const SIZES = [['10,001+ employees', 78], ['5,001-10,000 employees', 6], ['1,001-5,000 employees', 8], ['501-1,000 employees', 2], ['201-500 employees', 3], ['51-200 employees', 2], ['11-50 employees', 1]];

function buildDemo(perf) {
  const windows = [];
  MONTHS.forEach((mk, mi) => {
    const last = DIM[mi];
    const w1 = { mi, start: mk + '-01', end: mk + '-14' }, w2 = { mi, start: mk + '-15', end: mk + '-' + String(last).padStart(2, '0') };
    // share of the month's impressions falling in each window, from the generated perf rows
    const imp = d => perf.filter(r => r.day >= d.start && r.day <= d.end).reduce((a, r) => a + r.impressions + r.sends * 3, 0);
    const a = imp(w1), b = imp(w2); const s = a + b || 1;
    w1.share = a / s; w2.share = b / s; if (!a && !b) { w1.share = 0.5; w2.share = 0.5; }
    windows.push(w1, w2);
  });
  const out = []; let wi = 0;
  for (const w of windows) {
    const mi = w.mi, f = w.share, ctr = MON.clicks[mi] / Math.max(1, MON.impr[mi]);
    const rows = [];
    // LinkedIn hides tiny segments, so rows under 8 impressions are dropped.
    const push = (segment, value, impressions, clicks, extra = {}) => { impressions = Math.round(impressions); if (impressions < 8 && !(extra.sends > 0)) return; rows.push(sparse({ segment, value, campaign: '', impressions, clicks: Math.round(clicks), ...extra })); };
    // Company
    ACC.rows.forEach((name, i) => {
      const imp = ACC.Impressions[i][mi] * f * jitter(0.08), clk = ACC.Clicks[i][mi] * f * jitter(0.1);
      const sends = Math.round(ACC.Sends[i][mi] * f * jitter(0.08)), opens = Math.min(sends, Math.round(ACC.Opens[i][mi] * f * jitter(0.08)));
      const page = PAGE_ALIAS[name] ? PAGE_ALIAS[name][wi % PAGE_ALIAS[name].length] : name;
      const leads = mi >= 3 && imp > 3000 ? Math.round(imp / 6000 * jitter(0.5)) : 0;
      push('Company', page, imp, clk, { sends, opens, leads });
    });
    push('Company', 'IBM', 600 * f * (mi >= 3 ? 1 : 0), 4 * f); push('Company', 'Microsoft', 420 * f * (mi >= 3 ? 1 : 0), 3 * f); push('Company', 'Freelance', 900 * f * (mi >= 4 ? 1 : 0), 9 * f);
    // Job seniority
    SEN.rows.forEach((r, i) => push('Job Seniority', r, SEN.vals[i][mi] * f * jitter(0.05), SEN.vals[i][mi] * f * ctr * (r === 'Entry' || r === 'Senior' ? 1.15 : 0.9) * jitter(0.15)));
    // Country (aggregates split to real countries)
    GEO.rows.forEach((r, i) => { const v = GEO.vals[i][mi] * f; const parts = GEO_SPLIT[r] || [[r, 1]]; for (const [ct, p] of parts) push('Country', ct, v * p * jitter(0.05), v * p * ctr * jitter(0.15)); });
    // Job title: band mix follows the month's seniority mix
    const senCol = SEN.rows.map((_, i) => SEN.vals[i][mi]); const senTot = senCol.reduce((a, b) => a + b, 0) || 1;
    const sh = k => senCol[SEN.rows.indexOf(k)] / senTot;
    const bandW = { MD: sh('CXO') + sh('Partner') + sh('Owner') + sh('VP') * 0.35, MD1: sh('VP') * 0.65 + sh('Director') * 0.45, DIR: sh('Director') * 0.55, MD2: sh('Manager') * 0.55, OTHER: sh('Manager') * 0.45 + sh('Senior') + sh('Entry') };
    const titleTot = MON.impr[mi] * f * 0.92;
    for (const [band, list] of Object.entries(TITLES)) { const ws = list.reduce((a, [, w]) => a + w, 0); for (const [t, w] of list) { const v = titleTot * bandW[band] * w / ws * jitter(0.12); push('Job Title', t, v, v * ctr * (band === 'OTHER' ? 1.1 : 0.85) * jitter(0.2)); } }
    // Job function
    { const ws = FUNCS.reduce((a, [, w]) => a + w, 0); for (const [fn, w] of FUNCS) { const v = MON.impr[mi] * f * 0.95 * w / ws * jitter(0.15); push('Job Function', fn, v, v * ctr * jitter(0.2)); } }
    // Location: cities within each country's share
    GEO.rows.forEach((r, i) => { const cities = CITIES[r]; if (!cities) return; const v = GEO.vals[i][mi] * f; const ws = cities.reduce((a, [, w]) => a + w, 0); for (const [city, w] of cities) push('Location', city, v * w / ws * jitter(0.1), v * w / ws * ctr * jitter(0.2)); });
    // Company size
    { const ws = SIZES.reduce((a, [, w]) => a + w, 0); for (const [sz, w] of SIZES) { const v = MON.impr[mi] * f * 0.97 * w / ws * jitter(0.1); push('Company Size', sz, v, v * ctr * jitter(0.15)); } }
    // Drop tiny windows entirely (April and May have almost nothing)
    if (rows.reduce((a, r) => a + r.impressions, 0) < 40 && !rows.some(r => r.sends > 0)) { wi++; continue; }
    const upload = { id: 'demo-' + w.start, channel: 'linkedin', kind: 'demographics', file_name: `demographics_${w.start}_${w.end}.csv`, uploaded_by: 'kailash@lyzr.ai', uploaded_at: w.end + 'T09:30:00+05:30', period_start: w.start, period_end: w.end, row_count: rows.length };
    out.push({ upload, rows });
    wi++;
  }
  return out;
}

const perf = buildPerf();
const demo = buildDemo(perf);
const perfUploads = MONTHS.map((mk, mi) => { const rows = perf.filter(r => r.day.startsWith(mk)); const days = rows.map(r => r.day).sort(); return { id: 'perf-' + mk, channel: 'linkedin', kind: 'performance', file_name: `ads_performance_${mk}.csv`, uploaded_by: 'kailash@lyzr.ai', uploaded_at: days[days.length - 1] + 'T10:05:00+05:30', period_start: days[0], period_end: days[days.length - 1], row_count: rows.length }; });
const uploads = [...perfUploads, ...demo.map(d => d.upload)].sort((a, b) => a.uploaded_at < b.uploaded_at ? 1 : -1);

export const linkedinMock = { uploads, perf, demo };
export default linkedinMock;
