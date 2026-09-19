"use client";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const ROWS: [string, string][] = [
  ["t", "Go to today"],
  ["j or n", "Next period"],
  ["k or p", "Previous period"],
  ["1 or d", "Day view"],
  ["2 or w", "Week view"],
  ["3 or m", "Month view"],
  ["4 or x", "4 day view"],
  ["5 or a", "Agenda"],
  ["c", "Create event"],
  ["/", "Search"],
  ["Esc", "Close"],
  ["?", "This help"],
];

export function ShortcutsHelp({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
        </DialogHeader>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          {ROWS.map(([k, v]) => (
            <div key={k} className="contents">
              <dt>
                <kbd className="rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-xs">{k}</kbd>
              </dt>
              <dd className="text-muted-foreground">{v}</dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}
