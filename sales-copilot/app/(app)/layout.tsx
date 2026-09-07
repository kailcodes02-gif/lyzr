import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/layout/app-shell";

// Middleware already redirects unauthenticated requests to /login before
// this ever renders, so this is a defense-in-depth check plus the place to
// grab the user's identity for the sidebar footer.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return <AppShell userEmail={user.email ?? ""}>{children}</AppShell>;
}
