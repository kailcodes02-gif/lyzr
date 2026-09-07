"use client";

import { Suspense, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";

// PKCE landing page (static build — no server route): exchanges the ?code
// from Google/Supabase for a session, then enters the app.
//
// `?connect=drive` marks this as a Drive incremental-authorization
// round trip (see the "Connect Google Drive" button on /admin/sync) rather
// than a fresh sign-in — the session's provider_refresh_token is ONLY ever
// present on the response immediately following an OAuth redirect like this
// one (Supabase doesn't persist it for later retrieval), so it has to be
// captured and handed to the Worker right here or it's gone for good.
function CallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    const supabase = createClient();
    const connecting = searchParams.get("connect");

    const finish = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        router.replace("/login?error=auth_failed");
        return;
      }

      if (connecting === "drive") {
        if (!session.provider_refresh_token) {
          toast.error("Google didn't return a refresh token — try connecting again");
        } else {
          try {
            const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/api/oauth/google-drive/connect`, {
              method: "POST",
              headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
              body: JSON.stringify({
                refreshToken: session.provider_refresh_token,
                scopes: ["https://www.googleapis.com/auth/drive.readonly"],
              }),
            });
            if (!res.ok) throw new Error(await res.text());
            toast.success("Google Drive connected");
          } catch (err) {
            toast.error(`Failed to save Drive connection: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        router.replace("/admin/sync/");
        return;
      }

      router.replace("/");
    };
    finish();
  }, [searchParams, router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50">
      <div className="text-center space-y-3">
        <div className="animate-spin w-8 h-8 border-2 border-zinc-300 border-t-violet-500 rounded-full mx-auto" />
        <p className="text-sm text-zinc-500">Signing you in…</p>
      </div>
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-zinc-50" />}>
      <CallbackContent />
    </Suspense>
  );
}
