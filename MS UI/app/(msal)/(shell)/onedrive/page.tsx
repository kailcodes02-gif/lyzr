"use client";

import { Suspense } from "react";
import { DriveApp } from "@/components/drive/drive-app";

// Static export: URL state lives in query params, read with useSearchParams,
// which must sit under a Suspense boundary.
export default function OneDrivePage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-muted-foreground">Loading OneDrive...</div>}>
      <DriveApp />
    </Suspense>
  );
}
