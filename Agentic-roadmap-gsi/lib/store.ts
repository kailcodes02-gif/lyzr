/**
 * Lead store + rate limiter.
 *
 * Two backends behind one async interface:
 *  - Upstash Redis  — used when UPSTASH_REDIS_REST_URL/TOKEN are set (Vercel).
 *                     Atomic sorted-set counters (no read-modify-write race),
 *                     KV for saved state. This is the production path.
 *  - File JSON      — local-dev fallback (single long-running server only).
 *
 * Limits: domain ≤ 10/day, email ≤ 2/day, email ≤ 5/7-days (rolling windows).
 */
import fs from "fs";
import path from "path";
import { Redis } from "@upstash/redis";
import type { Assessment, IntakeData } from "./types";

const DAY = 24 * 60 * 60 * 1000;
const WEEK = 7 * DAY;

export const LIMITS = { domainPerDay: 10, emailPerDay: 2, emailPerWeek: 5 };
export type LimitReason = "domain_daily" | "email_daily" | "email_weekly";

export interface LeadRecord {
  id: string;
  email: string;
  domain: string;
  createdAt: number;
  updatedAt: number;
  intake: IntakeData;
  assessment?: Assessment;
}

const redis =
  (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) ||
  (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN)
    ? Redis.fromEnv()
    : null;

const domainOf = (email: string) => email.toLowerCase().split("@")[1] ?? "";
const newId = (now: number) => "s_" + Math.random().toString(36).slice(2, 11) + now.toString(36);

/* ------------------------------------------------------------------ */
/* Redis backend                                                      */
/* ------------------------------------------------------------------ */

async function checkLimitsRedis(r: Redis, email: string): Promise<{ ok: boolean; reason?: LimitReason }> {
  const dom = domainOf(email);
  const now = Date.now();

  const domainDay = await r.zcount(`dom:${dom}`, now - DAY, now);
  if (domainDay >= LIMITS.domainPerDay) return { ok: false, reason: "domain_daily" };

  const emailDay = await r.zcount(`em:${email}`, now - DAY, now);
  if (emailDay >= LIMITS.emailPerDay) return { ok: false, reason: "email_daily" };

  const emailWeek = await r.zcount(`em:${email}`, now - WEEK, now);
  if (emailWeek >= LIMITS.emailPerWeek) return { ok: false, reason: "email_weekly" };

  return { ok: true };
}

async function createRecordRedis(
  r: Redis,
  email: string,
  intake: IntakeData,
): Promise<{ ok: boolean; reason?: LimitReason; id?: string }> {
  const check = await checkLimitsRedis(r, email);
  if (!check.ok) return check;

  const now = Date.now();
  const dom = domainOf(email);
  const id = newId(now);
  const record: LeadRecord = { id, email, domain: dom, createdAt: now, updatedAt: now, intake };

  await r.set(`rec:${id}`, record, { ex: 60 * 60 * 24 * 30 }); // 30-day TTL
  await r.zadd(`em:${email}`, { score: now, member: id });
  await r.zadd(`dom:${dom}`, { score: now, member: id });
  // self-prune the counter sets so they don't grow unbounded
  await r.zremrangebyscore(`em:${email}`, 0, now - WEEK);
  await r.zremrangebyscore(`dom:${dom}`, 0, now - WEEK);
  await r.expire(`em:${email}`, 60 * 60 * 24 * 8);
  await r.expire(`dom:${dom}`, 60 * 60 * 24 * 8);

  return { ok: true, id };
}

/* ------------------------------------------------------------------ */
/* File backend (local dev)                                           */
/* ------------------------------------------------------------------ */

const DATA_DIR = path.join(process.cwd(), ".data");
const FILE = path.join(DATA_DIR, "leads.json");

function readFile(): { records: LeadRecord[] } {
  try {
    return JSON.parse(fs.readFileSync(FILE, "utf8")) as { records: LeadRecord[] };
  } catch {
    return { records: [] };
  }
}
function writeFile(d: { records: LeadRecord[] }): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(d, null, 2));
}

function checkLimitsFile(email: string): { ok: boolean; reason?: LimitReason } {
  const dom = domainOf(email);
  const now = Date.now();
  const recs = readFile().records;
  if (recs.filter((x) => x.domain === dom && now - x.createdAt < DAY).length >= LIMITS.domainPerDay)
    return { ok: false, reason: "domain_daily" };
  if (recs.filter((x) => x.email === email && now - x.createdAt < DAY).length >= LIMITS.emailPerDay)
    return { ok: false, reason: "email_daily" };
  if (recs.filter((x) => x.email === email && now - x.createdAt < WEEK).length >= LIMITS.emailPerWeek)
    return { ok: false, reason: "email_weekly" };
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Public async API                                                   */
/* ------------------------------------------------------------------ */

export async function checkLimits(email: string): Promise<{ ok: boolean; reason?: LimitReason }> {
  const e = email.toLowerCase();
  return redis ? checkLimitsRedis(redis, e) : checkLimitsFile(e);
}

export async function createRecord(
  email: string,
  intake: IntakeData,
): Promise<{ ok: boolean; reason?: LimitReason; id?: string }> {
  const e = email.toLowerCase();
  if (redis) return createRecordRedis(redis, e, intake);

  const check = checkLimitsFile(e);
  if (!check.ok) return check;
  const now = Date.now();
  const id = newId(now);
  const d = readFile();
  d.records.push({ id, email: e, domain: domainOf(e), createdAt: now, updatedAt: now, intake });
  writeFile(d);
  return { ok: true, id };
}

export async function saveAssessment(id: string, intake: IntakeData, assessment: Assessment): Promise<void> {
  if (redis) {
    const rec = (await redis.get(`rec:${id}`)) as LeadRecord | null;
    if (!rec) return;
    rec.intake = intake;
    rec.assessment = assessment;
    rec.updatedAt = Date.now();
    await redis.set(`rec:${id}`, rec, { ex: 60 * 60 * 24 * 30 });
    return;
  }
  const d = readFile();
  const r = d.records.find((x) => x.id === id);
  if (!r) return;
  r.intake = intake;
  r.assessment = assessment;
  r.updatedAt = Date.now();
  writeFile(d);
}

export async function getRecord(id: string): Promise<LeadRecord | undefined> {
  if (redis) return ((await redis.get(`rec:${id}`)) as LeadRecord | null) ?? undefined;
  return readFile().records.find((x) => x.id === id);
}
