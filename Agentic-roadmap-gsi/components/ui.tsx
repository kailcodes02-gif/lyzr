"use client";

import * as React from "react";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Info tooltip — small (i) icon, opens on hover or click             */
/* ------------------------------------------------------------------ */

export function InfoTip({ text, className }: { text: string; className?: string }) {
  const [open, setOpen] = React.useState(false);
  return (
    <span className={cn("relative inline-flex align-middle", className)}>
      <button
        type="button"
        aria-label="More information"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        className="grid h-4 w-4 place-items-center rounded-full text-faint transition-colors hover:text-accent"
      >
        <Info className="h-3.5 w-3.5" />
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute left-1/2 top-full z-40 mt-2 w-60 -translate-x-1/2 rounded-xl border border-border-strong bg-surface p-3 text-left text-[0.72rem] font-normal normal-case leading-relaxed tracking-normal text-muted shadow-xl"
        >
          {text}
        </span>
      )}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Logo                                                               */
/* ------------------------------------------------------------------ */

export function Logo({ className }: { className?: string }) {
  // Official Lyzr wordmark (from lyzr.ai), self-hosted in /public.
  return (
    <span className={cn("inline-flex items-center", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/lyzr-logo.png" alt="Lyzr" className="h-7 w-auto" width={441} height={170} />
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Button — dark pill primary (Lyzr style)                            */
/* ------------------------------------------------------------------ */

type Variant = "primary" | "secondary" | "outline" | "ghost";
type Size = "sm" | "md" | "lg";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-ink text-white font-semibold hover:bg-[#3a322c] shadow-[0_10px_24px_-14px_rgba(38,33,28,0.6)]",
  secondary: "bg-surface text-fg border border-border-strong hover:border-accent/50 hover:text-accent",
  outline: "border border-border-strong text-fg hover:border-accent/60 hover:text-accent",
  ghost: "text-muted hover:text-fg hover:bg-surface-2",
};
const SIZES: Record<Size, string> = {
  sm: "h-9 px-4 text-sm",
  md: "h-11 px-5 text-sm",
  lg: "h-12 px-6 text-[0.95rem]",
};

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return (
    <button
      className={cn(
        "inline-flex select-none items-center justify-center gap-2 rounded-full transition-all duration-150 disabled:pointer-events-none disabled:opacity-40",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Card                                                               */
/* ------------------------------------------------------------------ */

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-border bg-surface shadow-[0_1px_2px_rgba(38,33,28,0.04),0_16px_36px_-26px_rgba(38,33,28,0.18)]",
        className,
      )}
      {...props}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Eyebrow / section label                                            */
/* ------------------------------------------------------------------ */

export function Eyebrow({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <span className={cn("text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-accent", className)}>
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Selectable chip / tile                                             */
/* ------------------------------------------------------------------ */

export function Chip({
  selected,
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean }) {
  return (
    <button
      type="button"
      className={cn(
        "cursor-pointer rounded-xl border px-4 py-3 text-left text-sm transition-all duration-150",
        selected
          ? "border-accent bg-accent/10 text-fg ring-1 ring-accent/30 shadow-[0_4px_14px_-8px_rgba(201,106,90,0.7)]"
          : "border-border-strong bg-surface text-muted hover:-translate-y-px hover:border-accent/50 hover:bg-surface-2 hover:text-fg hover:shadow-sm",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Progress bar                                                       */
/* ------------------------------------------------------------------ */

export function Bar({
  value,
  className,
  color = "var(--color-accent)",
}: {
  value: number;
  className?: string;
  color?: string;
}) {
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-surface-2", className)}>
      <div
        className="h-full rounded-full transition-[width] duration-500"
        style={{ width: `${Math.max(0, Math.min(100, value))}%`, backgroundColor: color }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Circular readiness ring                                            */
/* ------------------------------------------------------------------ */

export function Ring({
  value,
  size = 64,
  stroke = 6,
  color = "var(--color-accent)",
  className,
}: {
  value: number;
  size?: number;
  stroke?: number;
  color?: string;
  className?: string;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const off = c * (1 - Math.max(0, Math.min(100, value)) / 100);
  return (
    <div className={cn("relative grid place-items-center", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-surface-2)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={off}
          style={{ transition: "stroke-dashoffset 0.6s cubic-bezier(0.22,1,0.36,1)" }}
        />
      </svg>
      <span className="num absolute text-sm font-semibold text-fg">{Math.round(value)}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Pill badge                                                         */
/* ------------------------------------------------------------------ */

export function Pill({
  className,
  children,
  tone = "muted",
}: {
  className?: string;
  children: React.ReactNode;
  tone?: "muted" | "build" | "fix" | "hold" | "critical" | "accent";
}) {
  const tones: Record<string, string> = {
    muted: "border-border-strong text-muted",
    accent: "border-accent/40 text-accent bg-accent/10",
    build: "border-build/40 text-build bg-build/10",
    fix: "border-fix/40 text-fix bg-fix/10",
    hold: "border-hold/40 text-hold bg-hold/10",
    critical: "border-critical/40 text-critical bg-critical/10",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[0.7rem] font-medium",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
