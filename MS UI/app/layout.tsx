import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lyzr MS UI",
  description: "Outlook, OneDrive and Calendar in a Gmail / Google Drive style",
};

// Root layout carries NO auth provider on purpose: the MSAL v5 redirect
// bridge page (app/redirect) must render without MsalProvider. Everything
// else lives under app/(msal), whose layout adds the providers.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
