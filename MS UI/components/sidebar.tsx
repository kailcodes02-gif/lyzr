"use client";

import { useMsal } from "@azure/msal-react";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarDays, HardDrive, LogOut, Mail } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { BASE_PATH } from "@/lib/config";
import { useMe } from "@/lib/hooks";
import { initials } from "@/lib/format";
import { clearDriveIndexes, clearLocalUserState } from "@/lib/local-state";
import { isMockMode, setMockMode } from "@/lib/mock";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/outlook/", label: "Outlook", icon: Mail },
  { href: "/onedrive/", label: "OneDrive", icon: HardDrive },
  { href: "/calendar/", label: "Calendar", icon: CalendarDays },
];

// Narrow app-switcher rail (like Google's left edge). Each app renders its
// own wider panel (folders, drive navigation, mini calendar) next to it.
export function Sidebar() {
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const { instance } = useMsal();
  const me = useMe();
  const account = instance.getActiveAccount() ?? instance.getAllAccounts()[0];
  const name = me.data?.displayName ?? account?.name ?? "";
  const email = me.data?.mail ?? me.data?.userPrincipalName ?? account?.username ?? "";
  const mock = isMockMode();

  const signOut = async () => {
    if (mock) {
      // Leaving the demo: drop every cached mock result (React Query keeps
      // folders, messages, categories for minutes) and the demo drive index,
      // then do a full page load so nothing survives in memory. If a real
      // account is signed in, /login would otherwise bounce straight to the
      // mailbox and render demo rows whose ids real Graph rejects.
      await setMockMode(false);
      queryClient.clear();
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- a full load is the point: client-side routing would keep the mock cache
      window.location.assign(`${BASE_PATH}/login/`);
      return;
    }
    // Shared device: forget this account's local state before MSAL clears
    // its own cache.
    clearLocalUserState();
    await clearDriveIndexes(account?.homeAccountId);
    queryClient.clear();
    void instance.logoutRedirect({ account: account ?? undefined });
  };

  return (
    <aside className="flex h-screen w-[72px] shrink-0 flex-col items-center border-r border-border bg-sidebar py-3">
      <div className="mb-4 flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-sm font-semibold text-primary-foreground" title="Lyzr MS UI">
        L
      </div>
      <nav className="flex flex-col items-center gap-1">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href);
          return (
            <Tooltip key={href}>
              <TooltipTrigger
                render={
                  <Link
                    href={href}
                    aria-label={label}
                    className={cn(
                      "flex h-12 w-14 flex-col items-center justify-center gap-0.5 rounded-2xl text-[10px] text-muted-foreground transition-colors hover:bg-black/5 dark:hover:bg-white/10",
                      active && "bg-accent text-foreground"
                    )}
                  />
                }
              >
                <Icon className="h-5 w-5" />
                {label}
              </TooltipTrigger>
              <TooltipContent side="right">{label}</TooltipContent>
            </Tooltip>
          );
        })}
      </nav>
      <div className="mt-auto flex flex-col items-center gap-2">
        {mock && <span className="rounded-full bg-accent px-1.5 py-0.5 text-[9px] font-medium">Demo</span>}
        <Tooltip>
          <TooltipTrigger
            render={<div className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary text-xs font-medium" />}
          >
            {initials(name) || "?"}
          </TooltipTrigger>
          <TooltipContent side="right">
            <div className="font-medium">{name || "Signed in"}</div>
            <div className="text-muted-foreground">{email}</div>
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={<button onClick={() => void signOut()} aria-label="Sign out" className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-black/5 dark:hover:bg-white/10" />}
          >
            <LogOut className="h-4 w-4" />
          </TooltipTrigger>
          <TooltipContent side="right">Sign out</TooltipContent>
        </Tooltip>
      </div>
    </aside>
  );
}
