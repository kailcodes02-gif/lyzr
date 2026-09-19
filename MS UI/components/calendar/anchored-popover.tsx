"use client";

import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { cn } from "@/lib/utils";

export type Anchor = Element | { x: number; y: number } | null;

function toAnchor(a: Anchor) {
  if (!a) return null;
  if (a instanceof Element) return a;
  const { x, y } = a;
  return { getBoundingClientRect: () => ({ x, y, top: y, left: x, right: x, bottom: y, width: 0, height: 0, toJSON: () => ({}) }) as DOMRect };
}

// A popover positioned next to an arbitrary element or a screen point
// (the drag selection or the clicked event chip).
export function AnchoredPopover({
  open,
  onOpenChange,
  anchor,
  className,
  children,
  side = "right",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchor: Anchor;
  className?: string;
  children: React.ReactNode;
  side?: "left" | "right" | "top" | "bottom";
}) {
  return (
    <PopoverPrimitive.Root open={open} onOpenChange={(o) => onOpenChange(o)}>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Positioner anchor={toAnchor(anchor)} side={side} sideOffset={8} align="start" collisionPadding={12} className="isolate z-50">
          <PopoverPrimitive.Popup
            className={cn(
              "z-50 w-[26rem] max-w-[calc(100vw-2rem)] origin-(--transform-origin) rounded-xl bg-popover p-0 text-sm text-popover-foreground shadow-xl ring-1 ring-foreground/10 outline-hidden duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
              className,
            )}
          >
            {children}
          </PopoverPrimitive.Popup>
        </PopoverPrimitive.Positioner>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
