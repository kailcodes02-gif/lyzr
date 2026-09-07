"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Plus, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InfoTip } from "@/components/ui/info-tip";
import { useCurrentUser } from "@/lib/hooks/use-current-user";
import { useCreateRole, useRoles, useToggleRoleActive, useUpdateRoleLabel } from "@/lib/hooks/use-roles";

function RoleRow({ role }: { role: { key: string; label: string; is_active: boolean } }) {
  const [label, setLabel] = useState(role.label);
  const [editing, setEditing] = useState(false);
  const updateLabel = useUpdateRoleLabel();
  const toggleActive = useToggleRoleActive();

  async function save() {
    if (label.trim() && label !== role.label) {
      try {
        await updateLabel.mutateAsync({ key: role.key, label: label.trim() });
        toast.success("Role updated");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
        setLabel(role.label);
      }
    }
    setEditing(false);
  }

  return (
    <div className="p-3 flex items-center justify-between gap-3 text-sm">
      {editing ? (
        <Input
          autoFocus
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => e.key === "Enter" && save()}
          className="max-w-xs"
        />
      ) : (
        <button onClick={() => setEditing(true)} className="font-medium text-zinc-900 hover:underline text-left">
          {role.label}
        </button>
      )}
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-xs text-zinc-400">{role.key}</span>
        <Badge color={role.is_active ? "emerald" : "zinc"}>{role.is_active ? "Active" : "Inactive"}</Badge>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => toggleActive.mutate({ key: role.key, isActive: !role.is_active })}
          disabled={toggleActive.isPending}
        >
          {role.is_active ? "Deactivate" : "Activate"}
        </Button>
      </div>
    </div>
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
    const key = label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
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
    <div className="max-w-2xl">
      <h1 className="text-xl font-semibold text-zinc-900 flex items-center gap-1.5">
        Project Roles
        <InfoTip>
          The internal owner roles assignable per project (Product Owner, Deal Owner, Project Owner by default).
          Product Owner auto-populates from Cortex&apos;s project manager and Deal Owner from HubSpot&apos;s deal
          owner on every sync — reassigning either from a project&apos;s page overrides that permanently, until
          cleared. Project Owner has no automatic source; it&apos;s admin-assigned only.
        </InfoTip>
      </h1>
      <p className="mt-1 text-sm text-zinc-500">
        {isAdmin ? "Rename or deactivate a role, or add a new one." : "Only admins can edit roles."}
      </p>

      {!isAdmin && (
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <ShieldAlert className="w-4 h-4 shrink-0" />
          You&apos;re viewing this read-only — ask an admin to make changes.
        </div>
      )}

      {isLoading && <div className="mt-6 text-sm text-zinc-400">Loading…</div>}

      {roles && (
        <div className="mt-4 rounded-lg border border-zinc-200 bg-white divide-y divide-zinc-100">
          {roles.map((role) => (
            <RoleRow key={role.key} role={role} />
          ))}
        </div>
      )}

      {isAdmin && (
        <div className="mt-4 flex items-center gap-2">
          <Input
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            placeholder="New role label, e.g. Technical Lead"
            className="max-w-xs"
          />
          <Button variant="secondary" size="sm" onClick={handleCreate} disabled={createRole.isPending || !newLabel.trim()}>
            <Plus className="w-3.5 h-3.5" /> Add role
          </Button>
        </div>
      )}
    </div>
  );
}
