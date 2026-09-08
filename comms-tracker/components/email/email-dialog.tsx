"use client";

import Link from "next/link";
import { Modal } from "@/components/ui/modal";
import { Badge, SourceBadge } from "@/components/ui/badge";
import { ErrorNote, Skeleton } from "@/components/ui/page";
import { useEmailDetail } from "@/lib/hooks/use-email";

// Full view of one email, opened by double-clicking any email row. Shows
// the whole stored body when a source provides it (HubSpot, Instantly,
// Gmail, Outlook after migration 011) and falls back to the snippet
// otherwise, saying so.
export function EmailDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { data, isLoading, error } = useEmailDetail(id);
  const open = Boolean(id);

  return (
    <Modal open={open} onClose={onClose} title={data?.subject ?? (isLoading ? "Loading…" : "(no subject)")} wide>
      {isLoading && (
        <div className="space-y-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-40 w-full" />
        </div>
      )}
      {error && <ErrorNote error={error} />}
      {data && (
        <div className="space-y-4 text-sm">
          <div className="text-muted-foreground grid gap-1 text-xs sm:grid-cols-[80px_1fr]">
            <span className="font-medium">From</span>
            <span className="text-foreground">{data.sender_email ?? "—"}</span>
            <span className="font-medium">To</span>
            <span className="text-foreground">
              {data.recipient_email}
              {data.person && (
                <>
                  {" "}
                  <span className="text-muted-foreground">({data.person.full_name ?? data.person.email})</span>
                </>
              )}
            </span>
            <span className="font-medium">Date</span>
            <span className="text-foreground">{new Date(data.sent_at).toLocaleString()}</span>
            <span className="font-medium">Context</span>
            <span className="flex flex-wrap items-center gap-1.5">
              <SourceBadge source={data.source_system} />
              <Badge>{data.direction}</Badge>
              {data.origin === "sent_via_app" && <Badge color={data.confirmed_at ? "emerald" : "amber"}>{data.confirmed_at ? "confirmed sent" : "opened in compose, not yet confirmed"}</Badge>}
              {data.match_status !== "matched" && <Badge color="amber">{data.match_status}</Badge>}
              {data.account && (
                <Link href={`/accounts?id=${data.account.id}`} className="hover:underline">
                  <Badge color="violet">{data.account.canonical_name}</Badge>
                </Link>
              )}
              {data.project && (
                <Link href={`/projects?id=${data.project.id}`} className="hover:underline">
                  <Badge color="blue">{data.project.name}</Badge>
                </Link>
              )}
            </span>
          </div>

          {data.ai_summary && (
            <div className="bg-muted/60 rounded-lg px-3 py-2 text-xs">
              <span className="font-medium">Summary: </span>
              {data.ai_summary}
            </div>
          )}

          <div className="max-h-[55vh] overflow-y-auto rounded-lg border p-4">
            <pre className="font-sans text-sm leading-relaxed whitespace-pre-wrap break-words">{data.body_text ?? data.snippet ?? "(empty)"}</pre>
          </div>
          {!data.body_text && (
            <p className="text-muted-foreground text-xs">
              Only a preview is stored for this email. The full text is captured on the next refresh of its source.
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}
