"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Mail, Share2, HelpCircle, Upload } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { SignOutButton } from "@/components/layout/sign-out-button";

const NAV = [
  { href: "/", label: "Home", icon: Home },
  { href: "/email", label: "Email", icon: Mail },
  { href: "/linkedin", label: "LinkedIn", icon: Share2 },
  { href: "/faq", label: "FAQ", icon: HelpCircle },
  { href: "/knowledge", label: "Knowledge", icon: Upload },
];

export function AppShell({
  userEmail,
  children,
}: {
  userEmail: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <Link href="/" className="flex items-center gap-2 px-2 py-1.5 font-heading font-semibold">
            <span className="flex items-center justify-center size-6 rounded-md bg-brand-terracotta text-white text-xs shrink-0">
              S
            </span>
            <span className="group-data-[collapsible=icon]:hidden">Sales Copilot</span>
          </Link>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {NAV.map((item) => {
                  const isActive = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        render={<Link href={item.href} />}
                        isActive={isActive}
                        tooltip={item.label}
                      >
                        <item.icon />
                        <span>{item.label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <div className="flex items-center justify-between gap-2 px-2 py-1.5 group-data-[collapsible=icon]:hidden">
            <span className="text-xs text-muted-foreground truncate">{userEmail}</span>
            <SignOutButton />
          </div>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <header className="flex items-center gap-2 border-b border-border px-4 py-3">
          <SidebarTrigger />
          <span className="font-heading font-semibold sm:hidden">Sales Copilot</span>
        </header>
        <main className="max-w-4xl w-full mx-auto px-6 py-10">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
