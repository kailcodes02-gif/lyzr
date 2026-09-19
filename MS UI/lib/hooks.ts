"use client";

import { useMsal } from "@azure/msal-react";
import { useQuery } from "@tanstack/react-query";
import { graphFetch } from "./graph";

export type Me = { displayName?: string; mail?: string | null; userPrincipalName?: string; jobTitle?: string | null };

export function useMe() {
  const { instance, accounts } = useMsal();
  return useQuery({
    queryKey: ["me", accounts[0]?.homeAccountId],
    enabled: accounts.length > 0,
    staleTime: 5 * 60_000,
    queryFn: () => graphFetch<Me>(instance, ["User.Read"], "/me?$select=displayName,mail,userPrincipalName,jobTitle"),
  });
}
