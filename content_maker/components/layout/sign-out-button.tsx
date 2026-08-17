"use client";

import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

export function SignOutButton() {
  const router = useRouter();

  return (
    <button
      onClick={async () => {
        await createClient().auth.signOut();
        router.replace("/login");
      }}
      className="text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
    >
      Sign out
    </button>
  );
}
