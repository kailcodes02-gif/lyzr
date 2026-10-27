"use client";

// Profile photos for guest avatars (GET /users/{email}/photos/{size}/$value,
// User.ReadBasic.All). Cached for the session; null means "show initials"
// (no photo, an external guest, demo mode or a missing permission).
import { useMsal } from "@azure/msal-react";
import { useQuery } from "@tanstack/react-query";
import { graphFetchBlob } from "@/lib/graph";
import { isMockMode } from "@/lib/mock";
import { OTHER_PALETTE } from "./colors";

const PHOTO_SCOPES = ["User.ReadBasic.All"];

export function usePersonPhoto(email: string | undefined, size: 48 | 96 = 48) {
  const { instance } = useMsal();
  const key = email?.toLowerCase();
  return useQuery({
    queryKey: ["personPhoto", key, size],
    enabled: !!key && !isMockMode(),
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
    queryFn: async () => {
      try {
        const blob = await graphFetchBlob(instance, PHOTO_SCOPES, `/users/${encodeURIComponent(key!)}/photos/${size}x${size}/$value`);
        return blob.size && blob.type.startsWith("image/") ? URL.createObjectURL(blob) : null;
      } catch {
        return null;
      }
    },
  });
}

// A stable avatar colour per address, from the same palette as other calendars.
export function avatarColor(email: string): string {
  let h = 0;
  for (const ch of email.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return OTHER_PALETTE[h % OTHER_PALETTE.length];
}
