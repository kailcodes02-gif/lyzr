"use client";

import { useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export type ShortcutHandlers = Partial<{
  next: () => void;
  prev: () => void;
  open: () => void;
  back: () => void;
  archive: () => void;
  trash: () => void;
  reply: () => void;
  replyAll: () => void;
  forward: () => void;
  compose: () => void;
  star: () => void;
  markRead: () => void;
  markUnread: () => void;
  select: () => void;
  search: () => void;
  help: () => void;
  escape: () => void;
}>;

export function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  return !!el.closest("[data-editor], [contenteditable='true'], [role='dialog'] input");
}

// Maps a keydown event to a handler name (Gmail bindings). Exported for tests.
export function shortcutFor(e: { key: string; shiftKey: boolean; metaKey: boolean; ctrlKey: boolean; altKey: boolean }): keyof ShortcutHandlers | null {
  if (e.metaKey || e.ctrlKey || e.altKey) return null;
  if (e.key === "Escape") return "escape";
  if (e.shiftKey) {
    if (e.key === "I") return "markRead";
    if (e.key === "U") return "markUnread";
    if (e.key === "#") return "trash";
    if (e.key === "?") return "help";
    return null;
  }
  switch (e.key) {
    case "j": return "next";
    case "k": return "prev";
    case "o":
    case "Enter": return "open";
    case "u": return "back";
    case "e": return "archive";
    case "#": return "trash";
    case "r": return "reply";
    case "a": return "replyAll";
    case "f": return "forward";
    case "c": return "compose";
    case "s": return "star";
    case "x": return "select";
    case "/": return "search";
    case "?": return "help";
    default: return null;
  }
}

export function useMailShortcuts(handlers: ShortcutHandlers, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" && isTypingTarget(e.target)) return;
      if (e.key === "Escape" && isTypingTarget(e.target)) return;
      const name = shortcutFor(e);
      if (!name) return;
      const fn = handlers[name];
      if (!fn) return;
      e.preventDefault();
      fn();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handlers, enabled]);
}

const ROWS: [string, string][] = [
  ["c", "Compose"],
  ["/", "Search"],
  ["j / k", "Next / previous conversation"],
  ["o or Enter", "Open conversation"],
  ["u", "Back to list"],
  ["e", "Archive"],
  ["#", "Delete"],
  ["s", "Star or unstar"],
  ["x", "Select conversation"],
  ["r / a / f", "Reply / reply all / forward"],
  ["Shift + i / Shift + u", "Mark as read / unread"],
  ["Esc", "Close reading pane or compose"],
  ["?", "This help"],
];

export function ShortcutHelp({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
        </DialogHeader>
        <table className="w-full text-sm">
          <tbody>
            {ROWS.map(([k, v]) => (
              <tr key={k} className="border-b border-border last:border-0">
                <td className="py-1.5 pr-4 font-mono text-xs text-muted-foreground">{k}</td>
                <td className="py-1.5">{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </DialogContent>
    </Dialog>
  );
}
