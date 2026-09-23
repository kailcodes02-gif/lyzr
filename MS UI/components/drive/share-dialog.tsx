"use client";

import { useMsal } from "@azure/msal-react";
import { Check, Copy, Link2, Trash2, Users } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createLink, invite, removePermission, usePermissions, useSettleInvalidate } from "@/lib/drive/api";
import type { DriveItem, Permission } from "@/lib/drive/types";
import { EMAIL_RE } from "@/lib/people";
import { cn } from "@/lib/utils";

function describe(p: Permission): string {
  if (p.link) return `${p.link.scope === "anonymous" ? "Anyone with the link" : p.link.scope === "organization" ? "People in Lyzr with the link" : "Specific people with the link"} can ${p.link.type === "edit" ? "edit" : "view"}`;
  const who = p.grantedToV2?.user?.displayName ?? p.grantedToV2?.user?.email ?? p.grantedToIdentitiesV2?.map((g) => g.user?.displayName ?? g.user?.email).filter(Boolean).join(", ") ?? p.invitation?.email ?? "Someone";
  return `${who}: ${p.roles?.includes("write") ? "can edit" : p.roles?.includes("owner") ? "owner" : "can view"}`;
}

function Seg<T extends string>({ value, options, onChange }: { value: T; options: { v: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex overflow-hidden rounded-full border border-border text-xs">
      {options.map((o) => (
        <button key={o.v} type="button" onClick={() => onChange(o.v)} className={cn("px-3 py-1.5", value === o.v ? "bg-[#c2e7ff] text-[#001d35] dark:bg-primary/25 dark:text-foreground" : "hover:bg-muted")}>{o.label}</button>
      ))}
    </div>
  );
}

export function ShareDialog({ item, onClose }: { item: DriveItem | null; onClose: () => void }) {
  const { instance } = useMsal();
  const settle = useSettleInvalidate();
  const perms = usePermissions(item?.id ?? null);
  const [linkType, setLinkType] = useState<"view" | "edit">("view");
  const [scope, setScope] = useState<"organization" | "users" | "anonymous">("organization");
  const [emails, setEmails] = useState("");
  const [role, setRole] = useState<"read" | "write">("read");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Server truth now and again after a moment: OneDrive provisions sharing
  // links and invitations asynchronously.
  const refresh = () => settle(["drive", "permissions", item?.id]);

  const doLink = async () => {
    if (!item) return;
    setBusy("link");
    try {
      const p = await createLink(instance, item.id, linkType, scope);
      const url = p.link?.webUrl;
      if (url) {
        try {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
          toast.success("Link copied");
        } catch {
          toast.info(url);
        }
      }
      void refresh();
    } catch (e) {
      toast.error(scope === "anonymous" ? "Your organization does not allow anonymous links" : "Could not create link", { description: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const doInvite = async () => {
    if (!item) return;
    const list = emails.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
    const bad = list.filter((e) => !EMAIL_RE.test(e));
    if (bad.length) {
      toast.error(`Not an email address: ${bad.join(", ")}`);
      return;
    }
    if (!list.length) return;
    setBusy("invite");
    try {
      const res = await invite(instance, item.id, list, role, message);
      // 207 Multi-Status: access was granted, but Microsoft could not email
      // some recipients (account verification, recipient limits, ...).
      const problems = (res?.value ?? []).filter((p) => p.error);
      if (problems.length) {
        toast.warning(`Shared, but ${problems.length === 1 ? "one invitation email" : `${problems.length} invitation emails`} could not be sent`, {
          description: problems.map((p) => `${p.invitation?.email ?? p.grantedToV2?.user?.displayName ?? "recipient"}: ${p.error?.message ?? p.error?.code ?? "failed"}`).join("; "),
        });
      } else toast.success(`Shared with ${list.length === 1 ? list[0] : `${list.length} people`}`);
      setEmails("");
      setMessage("");
      void refresh();
    } catch (e) {
      toast.error("Could not share", { description: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const doRemove = async (p: Permission) => {
    if (!item) return;
    setBusy(p.id);
    try {
      await removePermission(instance, item.id, p.id);
      void refresh();
    } catch (e) {
      toast.error("Could not remove access", { description: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={Boolean(item)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="rounded-2xl sm:max-w-lg">
        <DialogHeader><DialogTitle className="truncate pr-8 text-lg">Share &quot;{item?.name}&quot;</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3">
          <Input value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="Add people by email, separated by commas" aria-label="People to share with" className="h-11 rounded-lg" />
          {emails.trim() && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <Seg value={role} onChange={setRole} options={[{ v: "read", label: "Viewer" }, { v: "write", label: "Editor" }]} />
                <span className="text-xs text-muted-foreground">Sign-in required. Microsoft sends the invitation email.</span>
              </div>
              <Textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Message (optional)" rows={2} className="rounded-lg" />
              <div className="flex justify-end"><Button onClick={doInvite} disabled={busy === "invite"} className="rounded-full bg-[#1a73e8] text-white hover:bg-[#1765cc]">Send</Button></div>
            </div>
          )}
          <h3 className="mt-1 text-sm font-medium">People with access</h3>
          <ul className="max-h-40 divide-y divide-border overflow-y-auto rounded-lg border border-border">
            {perms.isPending && <li className="px-3 py-2 text-xs text-muted-foreground">Loading...</li>}
            {perms.isError && <li className="px-3 py-2 text-xs text-destructive">Could not load permissions.</li>}
            {perms.data?.length === 0 && <li className="px-3 py-2 text-xs text-muted-foreground">Only you have access.</li>}
            {perms.data?.map((p) => (
              <li key={p.id} className="flex items-center gap-2 px-3 py-2 text-[13px]">
                {p.link ? <Link2 className="h-4 w-4 text-muted-foreground" /> : <Users className="h-4 w-4 text-muted-foreground" />}
                <span className="min-w-0 flex-1 truncate">{describe(p)}</span>
                {p.link?.webUrl && (
                  <Button variant="ghost" size="icon-xs" aria-label="Copy link" onClick={() => navigator.clipboard.writeText(p.link!.webUrl!).then(() => toast.success("Link copied"))}><Copy /></Button>
                )}
                {!p.roles?.includes("owner") && (
                  <Button variant="ghost" size="icon-xs" aria-label="Remove access" disabled={busy === p.id} onClick={() => doRemove(p)}><Trash2 /></Button>
                )}
              </li>
            ))}
          </ul>
          <h3 className="mt-1 text-sm font-medium">General access</h3>
          <div className="flex flex-wrap items-center gap-2">
            <Seg value={scope} onChange={setScope} options={[{ v: "organization", label: "Lyzr" }, { v: "users", label: "Specific people" }, { v: "anonymous", label: "Anyone" }]} />
            <Seg value={linkType} onChange={setLinkType} options={[{ v: "view", label: "Viewer" }, { v: "edit", label: "Editor" }]} />
          </div>
          {scope === "anonymous" && <p className="text-xs text-muted-foreground">Anonymous links only work if the tenant sharing policy allows them.</p>}
          <div className="flex justify-between pt-1">
            <Button variant="outline" onClick={doLink} disabled={busy === "link"} className="gap-2 rounded-full">
              {copied ? <Check className="h-4 w-4 text-success" /> : <Link2 className="h-4 w-4" />}
              {copied ? "Copied" : "Copy link"}
            </Button>
            <Button onClick={onClose} className="rounded-full bg-[#1a73e8] text-white hover:bg-[#1765cc]">Done</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
