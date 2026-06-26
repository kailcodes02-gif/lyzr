/**
 * First-party usage tracking — no external analytics.
 *
 * The whole accumulated picture lives in one localStorage blob per browser, so
 * "screens visited" / "blueprints seen" are LIFETIME + de-duplicated (a screen is
 * recorded once, not on every visit). UTM is captured first-touch on the landing
 * page. Once a session exists we POST the full blob to /api/track, which merges it
 * into that signup's record. Idempotent — we always send the complete set.
 */
import type { Activity } from "./types";

const KEY = "agentic_activity";
const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"];
const CLICK_IDS = ["gclid", "fbclid", "li_fat_id", "ref"];

function read(): Activity {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Activity;
  } catch {
    /* ignore */
  }
  const now = Date.now();
  return { screens: [], blueprints: [], utm: {}, firstSeen: now, lastSeen: now };
}

function write(a: Activity) {
  try {
    localStorage.setItem(KEY, JSON.stringify(a));
  } catch {
    /* ignore */
  }
}

/** First-touch UTM + referrer from the current URL (only sets once). */
export function captureUTM() {
  if (typeof window === "undefined") return;
  const a = read();
  if (Object.keys(a.utm).length > 0) return; // already captured the first touch
  const p = new URLSearchParams(window.location.search);
  const utm: Record<string, string> = {};
  for (const k of [...UTM_KEYS, ...CLICK_IDS]) {
    const v = p.get(k);
    if (v) utm[k] = v.slice(0, 120);
  }
  const ref = document.referrer ? document.referrer.slice(0, 200) : undefined;
  if (Object.keys(utm).length || ref) {
    a.utm = utm;
    if (ref) a.referrer = ref;
    a.lastSeen = Date.now();
    write(a);
  }
}

/** Record a screen/tab as visited (deduped, lifetime). */
export function trackScreen(name: string) {
  if (typeof window === "undefined" || !name) return;
  const a = read();
  if (!a.screens.includes(name)) a.screens.push(name);
  a.lastSeen = Date.now();
  write(a);
}

/** Record that the blueprint was opened for a given agent/use case. */
export function trackBlueprint(agentName: string) {
  if (typeof window === "undefined" || !agentName) return;
  const a = read();
  if (!a.blueprints.includes(agentName)) a.blueprints.push(agentName);
  if (!a.screens.includes("blueprint")) a.screens.push("blueprint");
  a.lastSeen = Date.now();
  write(a);
}

/** Push the full accumulated activity to the backend for this session. */
export function syncActivity(sessionId: string | null | undefined) {
  if (typeof window === "undefined" || !sessionId) return;
  try {
    fetch("/api/track", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId, activity: read() }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* ignore */
  }
}
