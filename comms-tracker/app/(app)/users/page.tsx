"use client";

import { toast } from "sonner";
import { ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LoadingRows, PageHeader } from "@/components/ui/page";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
    <div className="space-y-6">
      <PageHeader
        title="Users"
        tip="Everyone who has signed in with an @lyzr.ai account. Admins can manage roles, delete any task, and reassign project owner roles."
        description={isAdmin ? "You are an admin. You can promote or demote other users." : "Only admins can change roles."}
      />

      {isLoading && <LoadingRows />}

      {users && (
        <div className="bg-card max-w-3xl rounded-xl border shadow-xs">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-4">User</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead className="pr-4 text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="pl-4">
                    <div className="font-medium">{u.display_name ?? u.email}</div>
                    <div className="text-muted-foreground text-xs">{u.email}</div>
                  </TableCell>
                  <TableCell>
                    <Badge color={u.role === "admin" ? "violet" : "zinc"}>
                      {u.role === "admin" && <ShieldCheck />} {u.role}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">{new Date(u.created_at).toLocaleDateString()}</TableCell>
                  <TableCell className="pr-4 text-right">
                    {isAdmin && u.id !== me?.id && (
                      <Button variant="outline" size="sm" onClick={() => toggleAdmin(u.id, u.role)} disabled={setRole.isPending}>
                        {u.role === "admin" ? "Remove admin" : "Make admin"}
                      </Button>
                    )}
                    {u.id === me?.id && <span className="text-muted-foreground text-xs">you</span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
