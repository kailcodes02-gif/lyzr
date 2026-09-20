"use client";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { useSupportedTimeZones } from "@/lib/calendar/hooks";
import type { CalendarSettings } from "@/lib/calendar/settings";
import { defaultTimeZone } from "@/lib/calendar/time";

export const REMINDER_OPTIONS: { value: string; label: string }[] = [
  { value: "none", label: "No reminder" },
  { value: "0", label: "At time of event" },
  { value: "5", label: "5 minutes before" },
  { value: "10", label: "10 minutes before" },
  { value: "15", label: "15 minutes before" },
  { value: "30", label: "30 minutes before" },
  { value: "60", label: "1 hour before" },
  { value: "1440", label: "1 day before" },
];

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] items-center gap-3">
      <Label className="text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

export function SettingsDialog({ open, onOpenChange, settings, onChange }: { open: boolean; onOpenChange: (o: boolean) => void; settings: CalendarSettings; onChange: (p: Partial<CalendarSettings>) => void }) {
  const zones = useSupportedTimeZones();
  const browser = defaultTimeZone();
  const list = Array.from(new Set([browser, ...(zones.data ?? [])]));
  const notificationsSupported = typeof Notification !== "undefined";
  // Browsers only honour requestPermission() from a user gesture, so it runs
  // here, on the switch click, never on page load.
  const toggleDesktop = async (on: boolean) => {
    if (!on) {
      onChange({ desktopNotifications: false });
      return;
    }
    try {
      const perm = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
      if (perm === "granted") onChange({ desktopNotifications: true });
      else toast.error("Notifications are blocked for this site in your browser settings.");
    } catch {
      toast.error("This browser does not support desktop notifications.");
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Calendar settings</DialogTitle>
          <DialogDescription>Stored in this browser.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Row label="Time zone">
            <Select value={settings.timeZone ?? "__auto"} onValueChange={(v) => onChange({ timeZone: v === "__auto" || !v ? null : v })}>
              <SelectTrigger className="w-full">
                <SelectValue>{settings.timeZone ?? `Automatic (${browser})`}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__auto">Automatic ({browser})</SelectItem>
                {list.map((z) => (
                  <SelectItem key={z} value={z}>
                    {z}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Row>
          <Row label="Week starts on">
            <Select value={String(settings.weekStartsOn)} onValueChange={(v) => onChange({ weekStartsOn: Number(v) as 0 | 1 | 6 })}>
              <SelectTrigger className="w-full">
                <SelectValue>{{ 0: "Sunday", 1: "Monday", 6: "Saturday" }[settings.weekStartsOn]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">Sunday</SelectItem>
                <SelectItem value="1">Monday</SelectItem>
                <SelectItem value="6">Saturday</SelectItem>
              </SelectContent>
            </Select>
          </Row>
          <Row label="Default duration">
            <Select value={String(settings.defaultDuration)} onValueChange={(v) => onChange({ defaultDuration: Number(v) as CalendarSettings["defaultDuration"] })}>
              <SelectTrigger className="w-full">
                <SelectValue>{settings.defaultDuration} minutes</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {[15, 30, 45, 60, 90, 120].map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n} minutes
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Row>
          <Row label="Default reminder">
            <Select value={settings.defaultReminder === null ? "none" : String(settings.defaultReminder)} onValueChange={(v) => onChange({ defaultReminder: v === "none" ? null : Number(v) })}>
              <SelectTrigger className="w-full">
                <SelectValue>{REMINDER_OPTIONS.find((o) => o.value === (settings.defaultReminder === null ? "none" : String(settings.defaultReminder)))?.label}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {REMINDER_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Row>
          <Row label="Desktop alerts">
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={settings.desktopNotifications && notificationsSupported} disabled={!notificationsSupported} onCheckedChange={(v) => void toggleDesktop(v)} aria-label="Desktop notifications for reminders" />
              <span className="text-xs text-muted-foreground">{notificationsSupported ? "Reminders also as browser notifications" : "Not supported in this browser"}</span>
            </label>
          </Row>
          {zones.isError && <p className="text-xs text-muted-foreground">Could not load the Outlook time zone list; showing the browser zone only.</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
