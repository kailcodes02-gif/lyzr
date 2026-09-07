"use client";

import { createClient } from "@/lib/supabase/client";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

const OAUTH_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
].join(" ");

function LoginContent() {
  const searchParams = useSearchParams();
  const error = searchParams.get("error");
  const router = useRouter();

  useEffect(() => {
    createClient()
      .auth.getSession()
      .then(({ data: { session } }) => {
        if (session) router.replace("/");
      });
  }, [router]);

  const handleGoogleLogin = async () => {
    const supabase = createClient();
    // access_type=offline + prompt=consent is what makes Google return a
    // refresh token on this sign-in — captured server-side in the auth
    // callback and reused later for background Gmail search/draft calls.
    // hd nudges the account picker to lyzr.ai; the callback re-verifies
    // the domain server-side since hd alone doesn't enforce it.
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/auth/callback`,
        scopes: OAUTH_SCOPES,
        queryParams: {
          access_type: "offline",
          prompt: "consent",
          hd: "lyzr.ai",
        },
      },
    });
    if (error) {
      console.error("Login error:", error);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-6">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center pb-2">
          <h1 className="text-2xl font-semibold tracking-tight">Sales Copilot</h1>
          <p className="text-sm text-muted-foreground">
            Lyzr internal sales &amp; partnerships tool
          </p>
        </CardHeader>
        <CardContent className="space-y-4 pt-4">
          {error && (
            <div className="rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-sm text-center px-3 py-2">
              Authentication failed. Please try again with an @lyzr.ai account.
            </div>
          )}

          <Button onClick={handleGoogleLogin} className="w-full" size="lg">
            <svg width="18" height="18" viewBox="0 0 24 24">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
            </svg>
            Sign in with Google
          </Button>

          <p className="text-xs text-center text-muted-foreground">
            Restricted to @lyzr.ai accounts. Signing in grants read/compose
            access to your Gmail for context and drafting.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <LoginContent />
    </Suspense>
  );
}
