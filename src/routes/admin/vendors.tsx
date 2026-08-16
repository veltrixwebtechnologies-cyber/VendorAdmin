import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ChevronRight, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAllSellers, type Seller, type SellerStatus } from "@/lib/db";

export const Route = createFileRoute("/admin/vendors")({
  head: () => ({ meta: [{ title: "Vendors — Admin" }, { name: "robots", content: "noindex" }] }),
  component: AdminVendors,
});

const FILTERS: Array<{ key: "all" | SellerStatus; label: string }> = [
  { key: "all", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "more_info", label: "Info requested" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
  { key: "draft", label: "Draft" },
];

function statusVariant(s: SellerStatus): "default" | "outline" | "secondary" | "destructive" {
  if (s === "approved") return "default";
  if (s === "rejected") return "destructive";
  if (s === "pending" || s === "more_info") return "secondary";
  return "outline";
}

function AdminVendors() {
  const q = useAllSellers();
  const sellers = q.data ?? [];
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const perPage = 10;

  const rows = useMemo(() => {
    let r: Seller[] = filter === "all" ? sellers : sellers.filter((s) => s.status === filter);
    if (search.trim()) {
      const s = search.toLowerCase();
      r = r.filter((v) =>
        (v.business.shopName + " " + v.business.ownerName + " " + v.account.email)
          .toLowerCase()
          .includes(s),
      );
    }
    return r;
  }, [sellers, filter, search]);
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / perPage));
  const p = Math.min(page, pages);
  const paged = rows.slice((p - 1) * perPage, p * perPage);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: sellers.length };
    for (const f of FILTERS)
      if (f.key !== "all") c[f.key] = sellers.filter((x) => x.status === f.key).length;
    return c;
  }, [sellers]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-black tracking-tight sm:text-3xl">Vendors</h1>
        <p className="text-sm text-muted-foreground">
          Manage vendor applications, approvals, and shops.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <Button
            key={f.key}
            size="sm"
            variant={filter === f.key ? "default" : "outline"}
            onClick={() => {
              setFilter(f.key);
              setPage(1);
            }}
            className="rounded-full"
          >
            {f.label} <span className="ml-1 text-[11px] opacity-70">({counts[f.key] ?? 0})</span>
          </Button>
        ))}
        <div className="relative ml-auto w-full sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search shop, owner, email"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="pl-8 h-9"
          />
        </div>
      </div>

      {q.isLoading ? (
        <div className="grid gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      ) : paged.length === 0 ? (
        <Card>
          <CardContent className="grid place-items-center py-16 text-sm text-muted-foreground">
            No vendors match this filter.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2 stagger">
          {paged.map((v) => (
            <Card key={v.id} className="hover-lift">
              <CardContent className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 p-3 sm:p-4">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 font-bold text-primary">
                    {(v.business.shopName || "S").slice(0, 1).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-semibold">
                        {v.business.shopName || "Unnamed shop"}
                      </span>
                      <Badge variant={statusVariant(v.status)} className="text-[10px] capitalize">
                        {v.status.replace("_", " ")}
                      </Badge>
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {v.business.ownerName || "—"} · {v.account.email} ·{" "}
                      {v.submittedAt
                        ? `Submitted ${new Date(v.submittedAt).toLocaleDateString()}`
                        : "Not submitted"}
                    </div>
                  </div>
                </div>
                <Link to="/admin/$sellerId" params={{ sellerId: v.id }}>
                  <Button size="sm" variant="outline" className="gap-1">
                    Review <ChevronRight className="h-4 w-4" />
                  </Button>
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {total > perPage && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            Showing {(p - 1) * perPage + 1}-{Math.min(p * perPage, total)} of {total}
          </span>
          <div className="flex gap-1">
            <Button size="sm" variant="outline" disabled={p <= 1} onClick={() => setPage(p - 1)}>
              Previous
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={p >= pages}
              onClick={() => setPage(p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
