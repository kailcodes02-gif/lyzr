"use client";

import { X } from "lucide-react";
import { useRef, useState } from "react";
import { EMAIL_RE, usePeopleSearch, type Person } from "@/lib/people";
import { cn } from "@/lib/utils";

export type Recipient = { name: string; email: string };

function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

// Gmail-style chip input with autocomplete from recent people, /me/people,
// the directory (/users) and contacts, each source optional.
// Enter, Tab, comma or blur turns typed text into a chip when it is an email.
export function PeoplePicker({
  value,
  onChange,
  placeholder,
  className,
  autoFocus,
}: {
  value: Recipient[];
  onChange: (next: Recipient[]) => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
}) {
  const [text, setText] = useState("");
  const { suggestions: found, isSearching } = usePeopleSearch(text);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const chosen = new Set(value.map((v) => v.email.toLowerCase()));
  const suggestions = found.filter((p) => !chosen.has(p.email.toLowerCase()));

  const add = (p: Person | Recipient) => {
    if (chosen.has(p.email.toLowerCase())) return;
    onChange([...value, { name: p.name, email: p.email }]);
    setText("");
    setOpen(false);
  };
  const commitText = () => {
    const t = text.trim().replace(/[,;]$/, "");
    if (!t) return false;
    if (suggestions[active] && open) {
      add(suggestions[active]);
      return true;
    }
    if (EMAIL_RE.test(t)) {
      add({ name: t, email: t });
      return true;
    }
    return false;
  };
  const remove = (email: string) => onChange(value.filter((v) => v.email !== email));

  return (
    <div className={cn("relative flex min-h-9 flex-wrap items-center gap-1 border-b border-border py-1", className)} onClick={() => inputRef.current?.focus()}>
      {value.map((v) => (
        <span key={v.email} title={v.email} className="flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-xs">
          <span className="max-w-[16rem] truncate">{v.name || v.email}</span>
          <button type="button" aria-label={`Remove ${v.email}`} onClick={() => remove(v.email)} className="rounded-full hover:bg-black/10 dark:hover:bg-white/10">
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        autoFocus={autoFocus}
        value={text}
        placeholder={value.length ? "" : placeholder}
        onChange={(e) => {
          setText(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          setTimeout(() => setOpen(false), 120);
          commitText();
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, suggestions.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter" || e.key === "Tab" || e.key === "," || e.key === ";") {
            if (commitText()) e.preventDefault();
            else if (e.key === "," || e.key === ";") e.preventDefault();
          } else if (e.key === "Backspace" && !text && value.length) {
            remove(value[value.length - 1].email);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        className="min-w-[8rem] flex-1 bg-transparent py-1 text-sm outline-none placeholder:text-muted-foreground"
      />
      {open && text && suggestions.length > 0 && (
        <ul role="listbox" className="absolute left-0 top-full z-30 mt-1 w-full max-w-md overflow-hidden rounded-lg border border-border bg-popover py-1 shadow-lg">
          {suggestions.map((p, i) => (
            <li
              key={p.email}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                add(p);
              }}
              onMouseEnter={() => setActive(i)}
              className={cn("flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm", i === active && "bg-accent")}
            >
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[11px] font-medium text-primary" aria-hidden>
                {initialsOf(p.name)}
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="truncate">{p.name}</span>
                <span className="truncate text-xs text-muted-foreground" data-testid="person-secondary">
                  {p.title ? `${p.title} · ${p.email}` : p.email}
                </span>
              </span>
            </li>
          ))}
          {isSearching && <li className="px-3 py-1 text-[11px] text-muted-foreground">Searching…</li>}
        </ul>
      )}
    </div>
  );
}
