"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, ListPlus } from "lucide-react";
import { useAccounts } from "@/lib/hooks/use-data";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { InfoTip } from "@/components/ui/info-tip";
import { CreateTaskModal } from "@/components/tasks/create-task-modal";
import { GOING_DARK_THRESHOLD_DAYS, daysSince, goingDarkClassName, goingDarkLabel } from "@/lib/going-dark";

function StatTile({ label, value, color, tip }: { label: string; value: number | string; color?: string; tip?: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white px-4 py-3">
      <div className="text-xs text-zinc-500 flex items-center gap-1">
        {label}
        {tip && <InfoTip>{tip}</InfoTip>}
      </div>
      <div className={cn("text-xl font-semibold", color ?? "text-zinc-900")}>{value}</div>
    </div>
  );
}

function pocLabel(names: string[]) {
  if (names.length === 0) return "—";
  if (names.length <= 2) return names.join(", ");
  return `${names.slice(0, 2).join(", ")} +${names.length - 2}`;
}

export default function TrackerHomePage() {
  const { data: accounts, isLoading, error } = useAccounts();
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [taskModalAccount, setTaskModalAccount] = useState<string | null>(null);

  const stats = useMemo(() => {
    if (!accounts) return null;
    const customers = accounts.filter((a) => a.is_customer);
    const goingDark = customers.filter((a) => a.goingDarkBucket > 0);
    return { total: customers.length, goingDark: goingDark.length };
  }, [accounts]);

  const filtered = useMemo(() => {
    if (!accounts) return [];
    const q = search.trim().toLowerCase();
    if (!q) return accounts;
    return accounts.filter(
      (a) =>
        a.canonical_name.toLowerCase().includes(q) ||
        a.primary_domain?.toLowerCase().includes(q) ||
        a.productOwners.some((o) => o.full_name?.toLowerCase().includes(q)) ||
        a.dealOwners.some((o) => o.full_name?.toLowerCase().includes(q)) ||
        a.product_engaged.some((p) => p.toLowerCase().includes(q))
    );
  }, [accounts, search]);

  return (
    <div className="max-w-6xl">
      <div className="flex items-center gap-1.5">
        <h1 className="text-xl font-semibold text-zinc-900">Account Tracker</h1>
        <InfoTip>
          One row per Cortex-engaged account, reconciled with HubSpot (customer/deal status) and Instantly (what&apos;s
          actually been sent). Sorted by longest-since-last-contact first — the worst offenders float to the top.
        </InfoTip>
      </div>
      <p className="mt-1 text-sm text-zinc-500">
        <Badge color="violet">Cortex</Badge> who&apos;s engaged · <Badge color="orange">HubSpot</Badge> who&apos;s a
        customer · <Badge color="cyan">Instantly</Badge> what&apos;s been sent.
      </p>

      {stats && (
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatTile label="Customers tracked" value={stats.total} tip="Accounts with HubSpot lifecycle=customer, or a closed-won deal." />
          <StatTile
            label={`Going dark (>${GOING_DARK_THRESHOLD_DAYS}d)`}
            value={stats.goingDark}
            color={stats.goingDark > 0 ? "text-red-600" : undefined}
            tip={`Customers with no matched email on any project in the last ${GOING_DARK_THRESHOLD_DAYS} days, or never contacted at all — worst project wins.`}
          />
          <StatTile label="Total accounts" value={accounts?.length ?? 0} tip="All Cortex-engaged accounts, customer or not." />
          <StatTile label="Never contacted" value={accounts?.filter((a) => !a.last_contact_at).length ?? 0} />
        </div>
      )}

      <div className="mt-4 relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search accounts, owners, products…"
          className="pl-9"
        />
      </div>

      {isLoading && <div className="mt-6 text-sm text-zinc-400">Loading…</div>}
      {error && <div className="mt-6 text-sm text-red-600">{(error as Error).message}</div>}

      {accounts && accounts.length === 0 && (
        <div className="mt-6 rounded-lg border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-400">
          No accounts synced yet. Sync Admin → Refresh all.
        </div>
      )}

      {filtered.length > 0 && (
        <div className="mt-4 overflow-x-auto rounded-lg border border-zinc-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500">
                <th className="px-4 py-2 font-medium">Account</th>
                <th className="px-4 py-2 font-medium">Product</th>
                <th className="px-4 py-2 font-medium">
                  <span className="inline-flex items-center gap-1">
                    Product Owner <InfoTip>Cortex project manager.</InfoTip>
                  </span>
                </th>
                <th className="px-4 py-2 font-medium">
                  <span className="inline-flex items-center gap-1">
                    Deal Owner <InfoTip>HubSpot sales rep assigned to this account&apos;s deal(s).</InfoTip>
                  </span>
                </th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Last contact</th>
                <th className="px-4 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((a) => {
                const d = daysSince(a.last_contact_at);
                return (
                  <tr
                    key={a.id}
                    onDoubleClick={() => router.push(`/accounts?id=${a.id}`)}
                    title="Double-click to open"
                    className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50 cursor-pointer"
                  >
                    <td className="px-4 py-2.5" onClick={() => router.push(`/accounts?id=${a.id}`)}>
                      <span className="font-medium text-zinc-900 hover:underline">{a.canonical_name}</span>
                      {a.primary_domain && <div className="text-xs text-zinc-400">{a.primary_domain}</div>}
                    </td>
                    <td className="px-4 py-2.5 text-zinc-600">
                      <div className="flex flex-wrap gap-1">
                        {a.product_engaged.slice(0, 2).map((p) => (
                          <Badge key={p} color="zinc">
                            {p}
                          </Badge>
                        ))}
                        {a.product_engaged.length === 0 && "—"}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-zinc-600">{pocLabel(a.productOwners.map((o) => o.full_name ?? o.email ?? "").filter(Boolean))}</td>
                    <td className="px-4 py-2.5 text-zinc-600">{pocLabel(a.dealOwners.map((o) => o.full_name ?? o.email ?? "").filter(Boolean))}</td>
                    <td className="px-4 py-2.5">
                      <Badge color={a.is_customer ? "emerald" : "zinc"}>{a.is_customer ? "Customer" : a.status}</Badge>
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
                          goingDarkClassName(a.goingDarkBucket)
                        )}
                      >
                        {goingDarkLabel(d)}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setTaskModalAccount(a.id);
                        }}
                        title="Create a send-update-email task for this account"
                        className="inline-flex items-center justify-center w-7 h-7 rounded-full text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100"
                      >
                        <ListPlus className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {accounts && accounts.length > 0 && filtered.length === 0 && (
        <div className="mt-4 rounded-lg border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-400">
          No accounts match &quot;{search}&quot;.
        </div>
      )}

      <CreateTaskModal
        open={taskModalAccount !== null}
        onClose={() => setTaskModalAccount(null)}
        defaultAccountId={taskModalAccount ?? undefined}
      />
    </div>
  );
}
