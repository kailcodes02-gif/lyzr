"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, ListPlus, ArrowRight } from "lucide-react";
import { useAccounts } from "@/lib/hooks/use-data";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InfoTip } from "@/components/ui/info-tip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, ErrorNote, LoadingRows, PageHeader, StatTile } from "@/components/ui/page";
import { CreateTaskModal } from "@/components/tasks/create-task-modal";
import { GOING_DARK_THRESHOLD_DAYS, daysSince } from "@/lib/going-dark";
import { GoingDarkPill } from "@/components/ui/going-dark-pill";

function pocLabel(names: string[]) {
  if (names.length === 0) return <span className="text-muted-foreground">—</span>;
  if (names.length <= 2) return names.join(", ");
  return `${names.slice(0, 2).join(", ")} +${names.length - 2}`;
}

export default function TrackerHomePage() {
  const { data: accounts, isLoading, error } = useAccounts();
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [onlyDark, setOnlyDark] = useState(false);
  const [taskModalAccount, setTaskModalAccount] = useState<string | null>(null);

  const stats = useMemo(() => {
    if (!accounts) return null;
    const customers = accounts.filter((a) => a.is_customer);
    return {
      customers: customers.length,
      goingDark: customers.filter((a) => a.goingDarkBucket > 0).length,
      total: accounts.length,
      never: accounts.filter((a) => !a.last_contact_at).length,
    };
  }, [accounts]);

  const filtered = useMemo(() => {
    if (!accounts) return [];
    const q = search.trim().toLowerCase();
    return accounts.filter((a) => {
      if (onlyDark && a.goingDarkBucket === 0) return false;
      if (!q) return true;
      return (
        a.canonical_name.toLowerCase().includes(q) ||
        a.primary_domain?.toLowerCase().includes(q) ||
        a.productOwners.some((o) => o.full_name?.toLowerCase().includes(q)) ||
        a.dealOwners.some((o) => o.full_name?.toLowerCase().includes(q)) ||
        a.product_engaged.some((p) => p.toLowerCase().includes(q))
      );
    });
  }, [accounts, search, onlyDark]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tracker"
        tip="One row per Cortex-engaged account, reconciled with HubSpot (customer and deal status) and every synced email source. Sorted worst-first: the longest silence floats to the top."
        description={
          <>
            <Badge color="violet">Cortex</Badge> who is engaged · <Badge color="orange">HubSpot</Badge> who is a customer ·{" "}
            <Badge color="cyan">Instantly</Badge> <Badge color="red">Gmail</Badge> <Badge color="blue">Outlook</Badge> what has been sent.
          </>
        }
      />

      {stats && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile label="Customers tracked" value={stats.customers} tip="Accounts with HubSpot lifecycle = customer, or a closed-won deal." />
          <StatTile
            label={`Going dark (>${GOING_DARK_THRESHOLD_DAYS}d)`}
            value={stats.goingDark}
            tone={stats.goingDark > 0 ? "danger" : "success"}
            tip={`Customers with no matched email on any project in the last ${GOING_DARK_THRESHOLD_DAYS} days, or never contacted. Worst project wins.`}
          />
          <StatTile label="All accounts" value={stats.total} hint="customers and prospects" />
          <StatTile label="Never contacted" value={stats.never} tone={stats.never > 0 ? "danger" : "default"} />
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-sm">
          <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search accounts, owners, products…" className="pl-9" />
        </div>
        <Button variant={onlyDark ? "default" : "outline"} size="sm" onClick={() => setOnlyDark((v) => !v)}>
          {onlyDark ? "Showing going dark only" : "Only going dark"}
        </Button>
      </div>

      {isLoading && <LoadingRows rows={6} />}
      {error && <ErrorNote error={error} />}

      {accounts && accounts.length === 0 && (
        <EmptyState title="No accounts synced yet" description="Run a refresh from Data & Sync to pull accounts from Cortex." action={<Button onClick={() => router.push("/admin/sync")}>Go to Data & Sync</Button>} />
      )}

      {filtered.length > 0 && (
        <div className="bg-card rounded-xl border shadow-xs">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-4">Account</TableHead>
                <TableHead>Product</TableHead>
                <TableHead>
                  <span className="inline-flex items-center gap-1">Product Owner <InfoTip>Cortex project manager.</InfoTip></span>
                </TableHead>
                <TableHead>
                  <span className="inline-flex items-center gap-1">Deal Owner <InfoTip>HubSpot sales rep on this account&apos;s deals.</InfoTip></span>
                </TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last contact</TableHead>
                <TableHead className="pr-4 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((a) => (
                <TableRow key={a.id} onClick={() => router.push(`/accounts?id=${a.id}`)} className="cursor-pointer">
                  <TableCell className="pl-4">
                    <div className="font-medium">{a.canonical_name}</div>
                    {a.primary_domain && <div className="text-muted-foreground text-xs">{a.primary_domain}</div>}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {a.product_engaged.slice(0, 2).map((p) => (
                        <Badge key={p}>{p}</Badge>
                      ))}
                      {a.product_engaged.length > 2 && <Badge>+{a.product_engaged.length - 2}</Badge>}
                      {a.product_engaged.length === 0 && <span className="text-muted-foreground">—</span>}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{pocLabel(a.productOwners.map((o) => o.full_name ?? o.email ?? "").filter(Boolean))}</TableCell>
                  <TableCell className="text-muted-foreground">{pocLabel(a.dealOwners.map((o) => o.full_name ?? o.email ?? "").filter(Boolean))}</TableCell>
                  <TableCell>
                    <Badge color={a.is_customer ? "emerald" : "zinc"}>{a.is_customer ? "Customer" : a.status}</Badge>
                  </TableCell>
                  <TableCell>
                    <GoingDarkPill bucket={a.goingDarkBucket} days={daysSince(a.last_contact_at)} />
                  </TableCell>
                  <TableCell className="pr-4">
                    <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                      <Button variant="ghost" size="icon-sm" title="Create a send-update task" aria-label="Create task" onClick={() => setTaskModalAccount(a.id)}>
                        <ListPlus />
                      </Button>
                      <Button variant="ghost" size="icon-sm" title="Open account" aria-label="Open account" onClick={() => router.push(`/accounts?id=${a.id}`)}>
                        <ArrowRight />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {accounts && accounts.length > 0 && filtered.length === 0 && (
        <EmptyState title={onlyDark && !search ? "Nothing is going dark" : `No accounts match "${search}"`} />
      )}

      <CreateTaskModal open={taskModalAccount !== null} onClose={() => setTaskModalAccount(null)} defaultAccountId={taskModalAccount ?? undefined} />
    </div>
  );
}
