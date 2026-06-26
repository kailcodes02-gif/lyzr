"use client";

import { useEffect } from "react";
import { captureUTM, trackScreen } from "@/lib/activity";

/** Captures first-touch UTM and marks the landing page as visited. Renders nothing. */
export function LandingTracker() {
  useEffect(() => {
    captureUTM();
    trackScreen("landing");
  }, []);
  return null;
}
