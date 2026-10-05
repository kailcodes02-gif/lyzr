// One chart palette for every view. Series colours are vivid and mutually distinct on white,
// led by the brand pair (navy, orange) and chosen so neighbours stay apart under the common
// colour-vision deficiencies (no red/green pair sits next to each other, lightness alternates).
// Heat-map ramps (js/heatmap.mjs) and CSS keep their own greys; this file is only for series,
// bands, buckets and bubbles. Pure module, no DOM, safe under `node --test`.

export const NAVY = '#043E77';
export const ORANGE = '#FE4B1E';
export const TEAL = '#0E9F9F';
export const VIOLET = '#7A3FE4';
export const GREEN = '#1FA64A';
export const AMBER = '#E5A100';
export const MAGENTA = '#D6267A';
export const SKY = '#2F8FE0';
export const BROWN = '#8C5A2B';
export const BLACK = '#1F2022';

/** Ten series colours, in the order a multi-series chart should hand them out. */
export const SERIES = [NAVY, ORANGE, TEAL, VIOLET, GREEN, AMBER, MAGENTA, SKY, BROWN, BLACK];

/** Colour for the i-th series; wraps past the tenth. */
export const seriesColor = i => SERIES[((i % SERIES.length) + SERIES.length) % SERIES.length];

/** '#RRGGBB' (or '#RGB') plus an alpha 0..1 -> 'rgba(r, g, b, a)'. Non-hex input is returned as-is. */
export function withAlpha(hex, a) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return hex;
  let h = m[1]; if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const n = parseInt(h, 16);
  const alpha = Math.max(0, Math.min(1, Number(a)));
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${isFinite(alpha) ? alpha : 1})`;
}

// Neutral greys for the "other / unknown / lost" members of a set, so they sit back.
const GREY_SOFT = '#B8B4AD', GREY_FAINT = '#E3E1DE', GREY_LOST = '#CFCCC7', STONE = '#A8A298';

/** Seniority bands on the leads pages. */
export const BAND_COLORS = { MD: NAVY, 'MD-1': ORANGE, 'MD-2': TEAL, Other: GREY_SOFT, Unknown: GREY_FAINT };

/** Partner tiers on the pipeline and GSI pages. */
export const TIER_COLORS = { GSI: NAVY, 'Big Four': ORANGE, MBB: VIOLET, SI: TEAL, Other: STONE, 'Tier 1': NAVY, 'Tier 2': TEAL };

/** Pipeline buckets (re-exported by js/lib/pipeline-agg.mjs). */
export const BUCKET_COLORS = { conversation: NAVY, demo: ORANGE, won: GREEN, lost: GREY_LOST };

/** LinkedIn lead types. */
export const LEAD_TYPE_COLORS = { mql: NAVY, conversation: ORANGE, playbook: TEAL, other: GREY_SOFT };

/** Team members keep a stable colour across every chart; anyone else takes the next free series colour. */
export const PERSON_COLORS = { Ani: NAVY, Anju: ORANGE, Siva: TEAL };
const RESERVED = new Set(Object.values(PERSON_COLORS));
const FREE_SERIES = SERIES.filter(c => !RESERVED.has(c));
export function personColor(name, i = 0) {
  const key = String(name || '').trim();
  const hit = Object.keys(PERSON_COLORS).find(k => k.toLowerCase() === key.toLowerCase());
  if (hit) return PERSON_COLORS[hit];
  const n = Number(i) || 0;
  return FREE_SERIES[((n % FREE_SERIES.length) + FREE_SERIES.length) % FREE_SERIES.length];
}
