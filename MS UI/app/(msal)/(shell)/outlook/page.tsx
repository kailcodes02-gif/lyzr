"use client";

import { Suspense } from "react";
import { MailApp } from "@/components/mail/mail-app";

export default function OutlookPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading Outlook</div>}>
      <MailApp />
    </Suspense>
  );
}
