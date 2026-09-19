"use client";

import { Link2, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePermissions } from "@/lib/drive/api";
import { kindOf, ownerName } from "@/lib/drive/logic";
import type { Crumb, DriveItem } from "@/lib/drive/types";
import { formatBytes, KIND_LABEL } from "@/lib/files";
import { formatDateTime } from "@/lib/format";
import { Thumbnail } from "./item-icon";

export function DetailsPanel({ item, crumbs, onClose, onShare }: { item: DriveItem | null; crumbs: Crumb[]; onClose: () => void; onShare: (item: DriveItem) => void }) {
  const perms = usePermissions(item?.id ?? null);
  return (
    <aside className="flex h-full w-[300px] shrink-0 flex-col border-l border-border bg-background" aria-label="Details">
      <div className="flex items-center gap-2 px-4 py-3">
        <h2 className="min-w-0 flex-1 truncate text-sm font-medium">{item ? item.name : "Details"}</h2>
        <Button variant="ghost" size="icon-sm" aria-label="Close details" onClick={onClose}><X /></Button>
      </div>
      {!item ? (
        <p className="px-4 text-sm text-muted-foreground">Select an item to see its details.</p>
      ) : (
        <div className="flex-1 overflow-y-auto px-4 pb-4">
          <div className="mb-4 h-40 overflow-hidden rounded-xl border border-border">
            <Thumbnail item={item} />
          </div>
          <h3 className="mb-2 text-xs font-medium text-muted-foreground">Who has access</h3>
          <div className="mb-4 flex items-center gap-2">
            {perms.isPending && <span className="text-xs text-muted-foreground">Checking...</span>}
            {perms.isError && <span className="text-xs text-muted-foreground">Could not load sharing.</span>}
            {perms.data && (
              <>
                <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs">
                  {perms.data.some((p) => p.link) ? <Link2 className="h-3 w-3" /> : <Users className="h-3 w-3" />}
                  {perms.data.length === 0 ? "Private to you" : `${perms.data.length} ${perms.data.length === 1 ? "permission" : "permissions"}`}
                </span>
                <Button variant="link" size="xs" onClick={() => onShare(item)}>Manage access</Button>
              </>
            )}
          </div>
          <h3 className="mb-2 text-xs font-medium text-muted-foreground">File details</h3>
          <dl className="grid grid-cols-[88px_1fr] gap-x-2 gap-y-2 text-xs">
            <dt className="text-muted-foreground">Type</dt><dd>{KIND_LABEL[kindOf(item)]}</dd>
            <dt className="text-muted-foreground">Size</dt><dd>{item.folder ? `${item.folder.childCount ?? 0} items` : formatBytes(item.size)}</dd>
            <dt className="text-muted-foreground">Location</dt><dd className="truncate">{crumbs.slice(0, -1).map((c) => c.name).join(" / ") || "My files"}</dd>
            <dt className="text-muted-foreground">Owner</dt><dd>{ownerName(item) || "You"}</dd>
            <dt className="text-muted-foreground">Modified</dt><dd>{formatDateTime(item.lastModifiedDateTime)}{item.lastModifiedBy?.user?.displayName ? ` by ${item.lastModifiedBy.user.displayName}` : ""}</dd>
            <dt className="text-muted-foreground">Created</dt><dd>{formatDateTime(item.createdDateTime)}</dd>
          </dl>
        </div>
      )}
    </aside>
  );
}
