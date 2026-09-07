"use client";

import { toast } from "sonner";
import { ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/ui/info-tip";
import { useCurrentUser } from "@/lib/hooks/use-current-user";
import { useSetUserRole, useUsers } from "@/lib/hooks/use-users";

export default function UsersPage() {
  const { data: users, isLoading } = useUsers();
  const { data: me } = useCurrentUser();
  const setRole = useSetUserRole();
  const isAdmin = me?.role === "admin";

  async function toggleAdmin(userId: string, currentRole: "admin" | "member") {
    const nextRole = currentRole === "admin" ? "member" : "admin";
    try {
      await setRole.mutateAsync({ userId, role: nextRole });
      toast.success(`Role updated to ${nextRole}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-semibold text-zinc-900 flex items-center gap-1.5">
        Users
        <InfoTip>
          Everyone who has signed in with an @lyzr.ai account. Admins can delete any task and manage roles; regular
          users can create tasks and check off items assigned to them, but can&apos;t delete tasks they didn&apos;t
          create.
        </InfoTip>
      </h1>
      <p className="mt-1 text-sm text-zinc-500">
        {isAdmin ? "You're an admin — you can promote/demote other users." : "Only admins can change roles."}
      </p>

      {isLoading && <div className="mt-6 text-sm text-zinc-400">Loading…</div>}

      {users && (
        <div className="mt-4 rounded-lg border border-zinc-200 bg-white divide-y divide-zinc-100">
          {users.map((u) => (
            <div key={u.id} className="p-3 flex items-center justify-between gap-3 text-sm">
              <div>
                <div className="font-medium text-zinc-900">{u.display_name ?? u.email}</div>
                <div className="text-xs text-zinc-500">{u.email}</div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Badge color={u.role === "admin" ? "violet" : "zinc"}>
                  {u.role === "admin" && <ShieldCheck className="w-3 h-3" />}
                  {u.role}
                </Badge>
                {isAdmin && u.id !== me?.id && (
                  <Button variant="ghost" size="sm" onClick={() => toggleAdmin(u.id, u.role)} disabled={setRole.isPending}>
                    {u.role === "admin" ? "Remove admin" : "Make admin"}
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
