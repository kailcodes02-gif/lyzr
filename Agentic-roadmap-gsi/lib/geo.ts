/**
 * Lightweight market detection + labor-cost basis for the "money saved" estimate.
 * Country is detected client-side (browser IP geo via Cloudflare's trace endpoint,
 * with an email-domain TLD fallback) and stored on the intake. The region
 * multiplier scales a US-baseline fully-loaded labor cost to the user's market.
 * Figures are an illustrative cost-of-labor index, not a quote.
 */

/** Fully-loaded annual cost of one knowledge worker at the US baseline (USD). */
export const BASELINE_LOADED = 130_000;

/** Default multiplier when the country is unknown but detected. */
const DEFAULT_MULT = 0.6;

/** Cost-of-labor index, US = 1.0. ISO-3166 alpha-2 keys. */
export const REGION_MULT: Record<string, number> = {
  US: 1.0, CA: 0.85,
  GB: 0.9, IE: 0.85, DE: 0.92, FR: 0.88, NL: 0.9, BE: 0.88, CH: 1.05, AT: 0.9,
  SE: 0.9, NO: 0.95, DK: 0.92, FI: 0.88, ES: 0.6, IT: 0.62, PT: 0.5, PL: 0.4, CZ: 0.42, RO: 0.35, GR: 0.5,
  AU: 0.9, NZ: 0.8,
  AE: 0.7, SA: 0.6, QA: 0.72, KW: 0.65, IL: 0.85, TR: 0.35,
  SG: 0.85, HK: 0.85, JP: 0.85, KR: 0.75, TW: 0.6, CN: 0.5,
  IN: 0.32, PK: 0.25, BD: 0.22, LK: 0.25, NP: 0.22,
  PH: 0.3, ID: 0.3, VN: 0.28, TH: 0.35, MY: 0.42,
  BR: 0.4, MX: 0.4, AR: 0.35, CL: 0.45, CO: 0.35, PE: 0.32,
  ZA: 0.45, NG: 0.3, KE: 0.3, EG: 0.3, MA: 0.3, GH: 0.28,
};

const COUNTRY_NAME: Record<string, string> = {
  US: "United States", CA: "Canada", GB: "United Kingdom", IE: "Ireland", DE: "Germany",
  FR: "France", NL: "Netherlands", BE: "Belgium", CH: "Switzerland", AT: "Austria", SE: "Sweden",
  NO: "Norway", DK: "Denmark", FI: "Finland", ES: "Spain", IT: "Italy", PT: "Portugal", PL: "Poland",
  CZ: "Czechia", RO: "Romania", GR: "Greece", AU: "Australia", NZ: "New Zealand", AE: "the UAE",
  SA: "Saudi Arabia", QA: "Qatar", KW: "Kuwait", IL: "Israel", TR: "Türkiye", SG: "Singapore",
  HK: "Hong Kong", JP: "Japan", KR: "South Korea", TW: "Taiwan", CN: "China", IN: "India",
  PK: "Pakistan", BD: "Bangladesh", LK: "Sri Lanka", NP: "Nepal", PH: "the Philippines",
  ID: "Indonesia", VN: "Vietnam", TH: "Thailand", MY: "Malaysia", BR: "Brazil", MX: "Mexico",
  AR: "Argentina", CL: "Chile", CO: "Colombia", PE: "Peru", ZA: "South Africa", NG: "Nigeria",
  KE: "Kenya", EG: "Egypt", MA: "Morocco", GH: "Ghana",
};

/** Multi-part country TLD suffixes → country code. */
const TLD2: Record<string, string> = {
  "co.uk": "GB", "org.uk": "GB", "ac.uk": "GB", "com.au": "AU", "net.au": "AU", "co.nz": "NZ",
  "com.br": "BR", "co.za": "ZA", "co.in": "IN", "co.jp": "JP", "com.sg": "SG", "com.my": "MY",
  "co.id": "ID", "com.mx": "MX", "com.ph": "PH", "co.kr": "KR", "com.hk": "HK", "com.tr": "TR",
};
/** Single country-code TLDs → country code. (generic .com/.io/.ai/.co → no signal) */
const TLD1: Record<string, string> = {
  us: "US", ca: "CA", uk: "GB", ie: "IE", de: "DE", fr: "FR", nl: "NL", be: "BE", ch: "CH", at: "AT",
  se: "SE", no: "NO", dk: "DK", fi: "FI", es: "ES", it: "IT", pt: "PT", pl: "PL", cz: "CZ", ro: "RO",
  gr: "GR", au: "AU", nz: "NZ", ae: "AE", sa: "SA", qa: "QA", il: "IL", tr: "TR", sg: "SG", hk: "HK",
  jp: "JP", kr: "KR", tw: "TW", cn: "CN", in: "IN", pk: "PK", bd: "BD", lk: "LK", ph: "PH", id: "ID",
  vn: "VN", th: "TH", my: "MY", br: "BR", mx: "MX", ar: "AR", cl: "CL", co: "CO", za: "ZA", ng: "NG",
  ke: "KE", eg: "EG", ma: "MA",
};

export interface Market {
  country: string;
  countryName: string;
  mult: number;
}

export function marketFor(country: string): Market {
  const cc = country.toUpperCase();
  return { country: cc, countryName: COUNTRY_NAME[cc] ?? cc, mult: REGION_MULT[cc] ?? DEFAULT_MULT };
}

/** Multiplier helper for scoring — 1.0 (US baseline) when no market is known. */
export function marketMult(market?: { mult: number }): number {
  return market?.mult ?? 1.0;
}

function countryFromDomain(domain: string): string | null {
  const parts = domain.toLowerCase().replace(/[^a-z.]/g, "").split(".");
  if (parts.length >= 2) {
    const two = parts.slice(-2).join(".");
    if (TLD2[two]) return TLD2[two];
  }
  const one = parts.slice(-1)[0];
  // ".co" alone is ambiguous (Colombia vs generic) — treat as no signal.
  if (one === "co") return null;
  return TLD1[one] ?? null;
}

/**
 * Best-effort market detection (client-only). Tries IP geo, then email TLD.
 * Returns null if nothing can be inferred (caller defaults to US baseline).
 */
export async function detectMarket(email: string): Promise<Market | null> {
  try {
    const r = await fetch("https://www.cloudflare.com/cdn-cgi/trace", { cache: "no-store" });
    const text = await r.text();
    const loc = /(?:^|\n)loc=([A-Za-z]{2})/.exec(text)?.[1];
    if (loc && loc.toUpperCase() !== "XX") return marketFor(loc);
  } catch {
    /* fall through to email TLD */
  }
  const domain = email.split("@")[1] ?? "";
  const cc = countryFromDomain(domain);
  return cc ? marketFor(cc) : null;
}
