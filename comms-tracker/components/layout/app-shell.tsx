"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LayoutDashboard, ListChecks, ListTodo, RefreshCw, LogOut, Users, ShieldCheck, Radar } from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { useCurrentUser } from "@/lib/hooks/use-current-user";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

// Two groups: day-to-day work, then admin/setup. Every entry carries a
// one-line purpose so the sidebar itself explains what each tab is for.
const NAV_GROUPS = [
  {
    label: "Workspace",
    items: [
      { href: "/", label: "Tracker", icon: LayoutDashboard, hint: "Accounts and who is going dark" },
      { href: "/tasks", label: "Tasks", icon: ListTodo, hint: "Send-update checklists" },
      { href: "/review", label: "Needs Review", icon: ListChecks, hint: "Records that could not be matched" },
    ],
  },
  {
    label: "Admin",
    items: [
      { href: "/admin/sync", label: "Data & Sync", icon: RefreshCw, hint: "Sources, mailboxes, knowledge" },
      { href: "/admin/roles", label: "Project Roles", icon: ShieldCheck, hint: "Owner roles per project" },
      { href: "/users", label: "Users", icon: Users, hint: "Who can sign in, who is admin" },
    ],
  },
];

const PAGE_TITLES: Array<[string, string]> = [
  ["/admin/sync", "Data & Sync"],
  ["/admin/roles", "Project Roles"],
  ["/accounts", "Account"],
  ["/projects", "Project"],
  ["/tasks", "Tasks"],
  ["/review", "Needs Review"],
  ["/users", "Users"],
  ["/", "Tracker"],
];

function initials(email: string | undefined) {
  if (!email) return "?";
  const name = email.split("@")[0];
  const parts = name.split(/[._-]/).filter(Boolean);
  return (parts.length >= 2 ? parts[0][0] + parts[1][0] : name.slice(0, 2)).toUpperCase();
}

export function AppSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { data: me } = useCurrentUser();

  const signOut = async () => {
    await createClient().auth.signOut();
    router.replace("/login");
  };

  return (
    <aside className="bg-sidebar text-sidebar-foreground border-sidebar-border flex w-60 shrink-0 flex-col border-r">
      <div className="flex h-14 items-center gap-2 px-4 border-b border-sidebar-border">
        <div className="bg-sidebar-primary text-sidebar-primary-foreground flex size-7 items-center justify-center rounded-md">
          <Radar className="size-4" />
        </div>
        <div className="leading-tight">
          <div className="text-sm font-semibold">Comms Tracker</div>
          <div className="text-muted-foreground text-[11px]">Lyzr internal</div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-4">
        {NAV_GROUPS.map((group) => (
          <div key={group.label}>
            <div className="text-muted-foreground px-2 pb-1 text-[11px] font-medium uppercase tracking-wide">{group.label}</div>
            <div className="space-y-0.5">
              {group.items.map(({ href, label, icon: Icon, hint }) => {
                const isActive = pathname === href || (href !== "/" && pathname.startsWith(href));
                return (
                  <Link
                    key={href}
                    href={href}
                    title={hint}
                    className={cn(
                      "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                      isActive
                        ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                        : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground"
                    )}
                  >
                    <Icon className="size-4" />
                    {label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-sidebar-border border-t p-2">
        <div className="flex items-center gap-2 rounded-md px-2 py-1.5">
          <div className="bg-muted text-foreground flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold">
            {initials(me?.email)}
          </div>
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-xs font-medium">{me?.email ?? "…"}</div>
            <div className="text-muted-foreground text-[11px] capitalize">{me?.role ?? ""}</div>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={signOut} title="Sign out" aria-label="Sign out">
            <LogOut />
          </Button>
        </div>
      </div>
    </aside>
  );
}

export function AppHeader() {
  const pathname = usePathname();
  const { data: me } = useCurrentUser();
  const title = PAGE_TITLES.find(([prefix]) => (prefix === "/" ? pathname === "/" : pathname.startsWith(prefix)))?.[1] ?? "";
  return (
    <header className="bg-background flex h-14 shrink-0 items-center justify-between border-b px-6">
      <div className="text-muted-foreground flex items-center gap-2 text-sm">
        <span>Comms Tracker</span>
        <span className="text-border">/</span>
        <span className="text-foreground font-medium">{title}</span>
      </div>
      {me && <Badge color={me.role === "admin" ? "violet" : "zinc"}>{me.role}</Badge>}
    </header>
  );
}
