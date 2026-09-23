"use client";

import { X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type Ref } from "react";
import { absorbOperators, addChip, buildSearchKql, chipLabel, EMPTY_SEARCH, forgetSearch, parseSearchKql, peopleQuery, personPrefix, recentSearches, rememberSearch, type SearchChip, type SearchState } from "@/lib/mail/search";
import { usePeople, usePeopleSearch } from "@/lib/people";
import { cn } from "@/lib/utils";
import { SearchSuggestions, suggestionItems, type SuggestionItem } from "./search-suggestions";

// Names learned from picks this session, so a KQL string coming back from the
// URL can label from:<email> chips with the person's name.
const knownNames = new Map<string, string>();

// Drop-in for the plain search input: chips for people and operators, free
// text, and a Gmail-style suggestion list. `query` is the KQL from the URL;
// `onSearch` receives the KQL to run ("" clears). Enter runs the typed text
// unless a suggestion is highlighted with the arrow keys.
export function SearchBox({ query, onSearch, ref, placeholder = "Search mail", className }: { query: string; onSearch: (kql: string) => void; ref?: Ref<HTMLInputElement>; placeholder?: string; className?: string }) {
  const { people: base } = usePeople();
  const names = useMemo(() => {
    const m = new Map(knownNames);
    for (const p of base) if (p.name && p.name !== p.email) m.set(p.email.toLowerCase(), p.name);
    return m;
  }, [base]);
  const [state, setState] = useState<SearchState>(() => parseSearchKql(query, names));
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [recent, setRecent] = useState<string[]>(() => recentSearches());
  const lastQuery = useRef(query);
  const innerRef = useRef<HTMLInputElement>(null);

  // Follow the URL: a search opened from elsewhere (back button, deep link) shows as chips.
  useEffect(() => {
    if (lastQuery.current === query) return;
    lastQuery.current = query;
    setState(parseSearchKql(query, names));
  }, [query, names]);

  const pq = peopleQuery(state.text);
  const { suggestions: people, isSearching } = usePeopleSearch(pq.query, 5);
  const items = useMemo(() => suggestionItems({ text: state.text, chips: state.chips, people, recent }), [state.text, state.chips, people, recent]);
  const showList = open && (items.length > 0 || isSearching);

  const setInput = (el: HTMLInputElement | null) => {
    innerRef.current = el;
    if (typeof ref === "function") ref(el);
    else if (ref) ref.current = el;
  };

  const run = (next: SearchState) => {
    const absorbed = absorbOperators(next);
    const kql = buildSearchKql(absorbed);
    setState(absorbed);
    setOpen(false);
    setActive(-1);
    lastQuery.current = kql;
    if (kql) setRecent(rememberSearch(kql));
    onSearch(kql);
  };
  const withChip = (chip: SearchChip, text: string) => run({ chips: addChip(state.chips, chip), text });
  const removeChip = (i: number) => {
    const next = { chips: state.chips.filter((_, j) => j !== i), text: state.text };
    if (query) run(next);
    else setState(next);
  };
  const clear = () => {
    setState(EMPTY_SEARCH);
    setActive(-1);
    if (query) {
      lastQuery.current = "";
      onSearch("");
    }
    innerRef.current?.focus();
  };

  const select = (item: SuggestionItem) => {
    if (item.type === "person") {
      knownNames.set(item.person.email.toLowerCase(), item.person.name);
      const prefix = personPrefix(state.text);
      withChip({ kind: item.kind, name: item.person.name, email: item.person.email }, prefix ? prefix.before : "");
    } else if (item.type === "text") {
      run({ ...state, text: item.text });
    } else if (item.type === "recent") {
      run(parseSearchKql(item.kql, names));
    } else if (item.op.chip) {
      const words = state.text.split(/\s+/).filter(Boolean);
      if (words.length && item.op.label.startsWith(words[words.length - 1].toLowerCase())) words.pop();
      withChip(item.op.chip, words.join(" "));
    } else if (item.op.insert) {
      const words = state.text.split(/\s+/).filter(Boolean);
      if (words.length && item.op.insert.startsWith(words[words.length - 1].toLowerCase())) words.pop();
      setState({ ...state, text: [...words, item.op.insert].join(" ") });
      setActive(-1);
      setOpen(true);
      innerRef.current?.focus();
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => (items.length ? Math.min(a + 1, items.length - 1) : -1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (showList && active >= 0 && items[active]) select(items[active]);
      else run(state);
    } else if (e.key === "Escape") {
      if (showList) {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        setActive(-1);
      } else innerRef.current?.blur();
    } else if (e.key === "Backspace" && !state.text && state.chips.length) {
      e.preventDefault();
      removeChip(state.chips.length - 1);
    } else if (e.key === "Tab" && showList && active >= 0 && items[active]?.type === "operator") {
      e.preventDefault();
      select(items[active]);
    }
  };

  const hasContent = state.text || state.chips.length > 0;
  return (
    <div className={cn("relative flex min-w-0 flex-1 flex-wrap items-center gap-1", className)} onClick={() => innerRef.current?.focus()}>
      {state.chips.map((c, i) => (
        <span key={`${c.kind}:${"email" in c ? c.email : c.value}`} data-testid="search-chip" title={"email" in c ? c.email : undefined} className="flex max-w-[16rem] items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-xs">
          <span className="truncate">{chipLabel(c)}</span>
          <button type="button" aria-label={`Remove ${chipLabel(c)}`} onClick={(e) => { e.stopPropagation(); removeChip(i); }} className="rounded-full hover:bg-black/10 dark:hover:bg-white/10">
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <input
        ref={setInput}
        value={state.text}
        onChange={(e) => {
          setState({ ...state, text: e.target.value });
          setActive(-1);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={onKeyDown}
        placeholder={state.chips.length ? "" : placeholder}
        aria-label="Search mail"
        role="combobox"
        aria-expanded={showList}
        aria-controls="search-suggestions"
        aria-autocomplete="list"
        autoComplete="off"
        className="min-w-[6rem] flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
      />
      {hasContent && (
        <button type="button" aria-label="Clear search" onClick={(e) => { e.stopPropagation(); clear(); }} className="rounded-full p-1 hover:bg-black/10">
          <X className="h-4 w-4" />
        </button>
      )}
      {showList && (
        <SearchSuggestions
          items={items}
          active={active}
          isSearching={isSearching && !!pq.query}
          onSelect={select}
          onHover={setActive}
          onForgetRecent={(kql) => setRecent(forgetSearch(kql))}
        />
      )}
    </div>
  );
}
