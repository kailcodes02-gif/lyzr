"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Pencil, Plus, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LoadingRows, PageHeader } from "@/components/ui/page";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCurrentUser } from "@/lib/hooks/use-current-user";
import { useCreateRole, useRoles, useToggleRoleActive, useUpdateRoleLabel } from "@/lib/hooks/use-roles";

const ROLE_SOURCE: Record<string, string> = {
  product_owner: "Auto from Cortex project manager",
  deal_owner: "Auto from HubSpot deal owner",
  project_owner: "Assigned by an admin on the project page",
};

function RoleRow({ role, canEdit }: { role: { key: string; label: string; is_active: boolean }; canEdit: boolean }) {
  const [label, setLabel] = useState(role.label);
  const [editing, setEditing] = useState(false);
  const updateLabel = useUpdateRoleLabel();
  const toggleActive = useToggleRoleActive();

  async function save() {
    if (label.trim() && label !== role.label) {
      try {
        await updateLabel.mutateAsync({ key: role.key, label: label.trim() });
        toast.success("Role renamed");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
        setLabel(role.label);
      }
    }
    setEditing(false);
  }

  return (
    <TableRow>
      <TableCell className="pl-4">
        {editing ? (
          <Input autoFocus value={label} onChange={(e) => setLabel(e.target.value)} onBlur={save} onKeyDown={(e) => e.key === "Enter" && save()} className="h-8 max-w-xs" />
        ) : (
          <div className="flex items-center gap-2">
            <span className="font-medium">{role.label}</span>
            {canEdit && (
              <Button variant="ghost" size="icon-sm" onClick={() => setEditing(true)} aria-label="Rename role" title="Rename">
                <Pencil />
              </Button>
            )}
          </div>
        )}
        <div className="text-muted-foreground text-xs">{ROLE_SOURCE[role.key] ?? "Assigned by an admin on the project page"}</div>
      </TableCell>
      <TableCell className="text-muted-foreground font-mono text-xs">{role.key}</TableCell>
      <TableCell>
        <Badge color={role.is_active ? "emerald" : "zinc"}>{role.is_active ? "Active" : "Inactive"}</Badge>
      </TableCell>
      <TableCell className="pr-4 text-right">
        {canEdit && (
          <Button variant="outline" size="sm" onClick={() => toggleActive.mutate({ key: role.key, isActive: !role.is_active })} disabled={toggleActive.isPending}>
            {role.is_active ? "Deactivate" : "Activate"}
          </Button>
        )}
      </TableCell>
    </TableRow>
  );
}

export default function AdminRolesPage() {
  const { data: roles, isLoading } = useRoles();
  const { data: me } = useCurrentUser();
  const createRole = useCreateRole();
  const [newLabel, setNewLabel] = useState("");
  const isAdmin = me?.role === "admin";

  async function handleCreate() {
    const label = newLabel.trim();
    if (!label) return;
    const key = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    if (!key) return;
    try {
      await createRole.mutateAsync({ key, label, sortOrder: (roles?.length ?? 0) + 1 });
      setNewLabel("");
      toast.success(`Role "${label}" added`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Project Roles"
        tip="The internal owner roles that can be assigned per project. Product Owner and Deal Owner auto-populate on every sync; reassigning either from a project page overrides that permanently. Project Owner is admin-assigned only."
        description="Rename, deactivate, or add the owner roles shown on every project."
      />

      {!isAdmin && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <ShieldAlert className="size-4 shrink-0" /> You are viewing this read-only. Ask an admin to make changes.
        </div>
      )}

      {isLoading && <LoadingRows />}

      {roles && (
        <div className="bg-card max-w-3xl rounded-xl border shadow-xs">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-4">Role</TableHead>
                <TableHead>Key</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="pr-4" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {roles.map((role) => (
                <RoleRow key={role.key} role={role} canEdit={isAdmin} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {isAdmin && (
        <div className="flex max-w-3xl items-center gap-2">
          <Input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleCreate()} placeholder="New role label, e.g. Technical Lead" className="max-w-xs" />
          <Button variant="outline" onClick={handleCreate} disabled={createRole.isPending || !newLabel.trim()}>
            <Plus /> Add role
          </Button>
        </div>
      )}
    </div>
  );
}
