"use client";

import { Suspense } from "react";
import { CalendarApp } from "@/components/calendar/calendar-app";

export default function CalendarPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading calendar...</div>}>
      <CalendarApp />
    </Suspense>
  );
}
