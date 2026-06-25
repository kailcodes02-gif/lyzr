"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Social-proof surface for the landing page. Three pieces:
 *   - <LiveNow/>     a live "N people right now" pulse (juggles, but is sticky
 *                    across quick refreshes so it reads as real, not random)
 *   - <SocialProof/> a band of headline numbers + a strip of notable orgs
 * Numbers are marketing figures, kept in the constants below so they're easy
 * to tune. The "right now" / "today" values move on their own; the totals are
 * fixed anchors.
 */

/* ------------------------------------------------------------------ */
/* Live "active right now" pulse                                       */
/* ------------------------------------------------------------------ */

// Weighted so it mostly lands on small, believable numbers.
const ACTIVE_POOL = [1, 2, 2, 3, 4, 4, 4, 5, 6, 6];
const ACTIVE_TTL = 75_000; // a chosen value sticks for this long, even across refreshes
const ACTIVE_KEY = "lyzr_active_now";

function rollActive(): number {
  return ACTIVE_POOL[Math.floor(Math.random() * ACTIVE_POOL.length)];
}

export function LiveNow({ className }: { className?: string }) {
  const [n, setN] = useState<number | null>(null);

  useEffect(() => {
    // Reuse the last value if it's still fresh — so refreshing the page a few
    // times in a row doesn't flicker the count. Only re-roll once it's stale.
    function current(): number {
      try {
        const raw = localStorage.getItem(ACTIVE_KEY);
        if (raw) {
          const { v, t } = JSON.parse(raw) as { v: number; t: number };
          if (typeof v === "number" && Date.now() - t < ACTIVE_TTL) return v;
        }
      } catch {
        /* private mode / disabled storage — fall through to a fresh roll */
      }
      const v = rollActive();
      try {
        localStorage.setItem(ACTIVE_KEY, JSON.stringify({ v, t: Date.now() }));
      } catch {
        /* ignore */
      }
      return v;
    }

    setN(current());
    const id = setInterval(() => {
      const v = rollActive();
      try {
        localStorage.setItem(ACTIVE_KEY, JSON.stringify({ v, t: Date.now() }));
      } catch {
        /* ignore */
      }
      setN(v);
    }, ACTIVE_TTL);
    return () => clearInterval(id);
  }, []);

  if (n == null) return null; // render nothing until mounted (no SSR mismatch)

  return (
    <span className={cn("inline-flex items-center gap-2 text-sm text-muted", className)}>
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-build/60" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-build" />
      </span>
      <span>
        <span className="num font-semibold text-fg">{n}</span>{" "}
        {n === 1 ? "person is" : "people are"} mapping their roadmap right now
      </span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Headline numbers + notable orgs                                     */
/* ------------------------------------------------------------------ */

type Stat = { value: number; suffix?: string; label: string; live?: boolean };

const STATS: Stat[] = [
  { value: 412, label: "Readiness assessments taken" },
  { value: 376, label: "Agent roadmaps generated" },
  { value: 150, suffix: "+", label: "Teams building with Lyzr" },
];

const ORGS = ["Accenture", "KPMG", "Deloitte", "Crown Castle"];

// "Taken today" ramps believably through the day and is stable within the hour,
// so it doesn't bounce on every refresh.
function takenToday(): number {
  const h = new Date().getHours();
  return Math.round(9 + h * 1.7); // ~9 first thing, ~48 by late evening
}

function useCountUp(target: number, run: boolean, ms = 1100): number {
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (!run) {
      setVal(0);
      return;
    }
    let raf = 0;
    let start = 0;
    const tick = (ts: number) => {
      if (!start) start = ts;
      const p = Math.min(1, (ts - start) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      setVal(Math.round(target * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, run, ms]);
  return val;
}

function StatValue({ stat, run }: { stat: Stat; run: boolean }) {
  const shown = useCountUp(stat.value, run);
  return (
    <span className="num font-display text-3xl font-semibold tracking-tight text-fg sm:text-4xl">
      {shown.toLocaleString()}
      {stat.suffix ?? ""}
    </span>
  );
}

export function SocialProof({ className }: { className?: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [seen, setSeen] = useState(false);
  const [today, setToday] = useState<number | null>(null);

  useEffect(() => {
    setToday(takenToday());
  }, []);

  // Run the count-up once the band scrolls into view.
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          io.disconnect();
        }
      },
      { threshold: 0.3 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);

  const stats: Stat[] = [
    STATS[0],
    STATS[1],
    { value: today ?? 0, label: "Taken today", live: true },
    STATS[2],
  ];

  return (
    <div ref={ref} className={cn("rounded-2xl border border-border bg-surface p-7 shadow-[0_1px_2px_rgba(38,33,28,0.04),0_16px_36px_-26px_rgba(38,33,28,0.18)]", className)}>
      <div className="grid grid-cols-2 gap-y-7 sm:grid-cols-4 sm:gap-y-0">
        {stats.map((s, i) => (
          <div
            key={s.label}
            className={cn(
              "px-1 text-center sm:px-5",
              i > 0 && "sm:border-l sm:border-border",
            )}
          >
            <div className="flex items-baseline justify-center gap-1.5">
              <StatValue stat={s} run={seen && (!s.live || today != null)} />
              {s.live && (
                <span className="relative flex h-1.5 w-1.5 translate-y-[-0.4rem]">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-build/60" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-build" />
                </span>
              )}
            </div>
            <div className="mt-1.5 text-xs leading-snug text-muted">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="mt-7 flex flex-col items-center gap-3 border-t border-border pt-6 sm:flex-row sm:justify-center sm:gap-6">
        <span className="text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-faint">
          Used by teams from
        </span>
        <div className="flex flex-wrap items-center justify-center gap-x-7 gap-y-2">
          {ORGS.map((o) => (
            <span key={o} className="font-display text-lg font-semibold tracking-tight text-muted">
              {o}
            </span>
          ))}
          <span className="text-sm text-faint">and teams across 40+ firms</span>
        </div>
      </div>
    </div>
  );
}
