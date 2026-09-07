"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  ListChecks,
  ListTodo,
  RefreshCw,
  LogOut,
  Users,
  ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { useCurrentUser } from "@/lib/hooks/use-current-user";
import { Badge } from "@/components/ui/badge";

const NAV = [
  { href: "/", label: "Tracker", icon: LayoutDashboard },
  { href: "/tasks", label: "Tasks", icon: ListTodo },
  { href: "/review", label: "Needs Review", icon: ListChecks },
  { href: "/admin/sync", label: "Sync Admin", icon: RefreshCw },
  { href: "/admin/roles", label: "Project Roles", icon: ShieldCheck },
  { href: "/users", label: "Users", icon: Users },
];

export function AppSidebar() {
  const pathname = usePathname();
  const router = useRouter();

  const signOut = async () => {
    await createClient().auth.signOut();
    router.replace("/login");
  };

  return (
    <aside className="w-56 shrink-0 bg-white border-r border-zinc-200 flex flex-col">
      <div className="px-4 py-4 border-b border-zinc-200">
        <span className="text-sm font-semibold text-zinc-900">Comms Tracker</span>
      </div>
      <nav className="flex-1 px-2 py-3 space-y-1">
        {NAV.map(({ href, label, icon: Icon }) => {
          const isActive = pathname === href || (href !== "/" && pathname.startsWith(href));
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors",
                isActive
                  ? "bg-zinc-100 text-zinc-900 font-medium"
                  : "text-zinc-500 hover:text-zinc-800 hover:bg-zinc-50"
              )}
            >
              <Icon className="w-4 h-4" />
              {label}
            </Link>
          );
        })}
      </nav>
      <button
        onClick={signOut}
        className="flex items-center gap-2 px-3 py-2 m-2 rounded-md text-sm text-zinc-500 hover:text-zinc-800 hover:bg-zinc-50"
      >
        <LogOut className="w-4 h-4" />
        Sign out
      </button>
    </aside>
  );
}

export function AppHeader() {
  const { data: me } = useCurrentUser();
  return (
    <header className="h-14 shrink-0 border-b border-zinc-200 bg-white flex items-center justify-between px-6">
      <span className="text-sm text-zinc-500">Lyzr internal — @lyzr.ai only</span>
      {me && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-500">{me.email}</span>
          <Badge color={me.role === "admin" ? "violet" : "zinc"}>{me.role}</Badge>
        </div>
      )}
    </header>
  );
}
