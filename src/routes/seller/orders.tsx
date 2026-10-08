import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  ChevronRight,
  Filter,
  Loader2,
  Search,
  ShoppingBag,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { useMyOrders } from "@/modules/seller/services/orders";
import { type Order } from "@/shared/core/seller";
import {
  PIPELINE_STAGES,
  CANCELLED_STATUSES,
  type PipelineStageKey,
  orderMatchesStage,
  calculateOrdersPageTabCounts,
  getPipelineEmptyState,
  normalizePipelineStage,
} from "@/lib/order-pipeline";
import {
  OrderDetailSheet,
  getStatusMeta,
  STATUS_META,
  VendorLiveLocationControl,
} from "@/components/order-detail-sheet";

// Re-export for any modules relying on these symbols
export {
  STATUS_META,
  getStatusMeta,
  VendorLiveLocationControl,
  OrderDetailSheet,
};

interface OrdersSearch {
  status?: string;
}

export const Route = createFileRoute("/seller/orders")({
  validateSearch: (search: Record<string, unknown>): OrdersSearch => ({
    status: typeof search.status === "string" ? search.status : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Orders — Seller Hub" },
      { name: "description", content: "Track and fulfill customer orders." },
      { property: "og:title", content: "Orders — Seller Hub" },
      { property: "og:description", content: "Track and fulfill customer orders." },
    ],
  }),
  component: OrdersPage,
});

const TABS = [
  { value: "all", label: "All" },
  { value: "new", label: "New" },
  { value: "accepted", label: "Accepted" },
  { value: "preparing", label: "Preparing" },
  { value: "ready", label: "Ready" },
  { value: "delivery", label: "Delivery" },
  { value: "delivered", label: "Delivered" },
  { value: "cancelled", label: "Cancelled" },
] as const;

function OrdersPage() {
  const q = useMyOrders();
  const orders = q.data ?? [];
  const searchParams = Route.useSearch?.() ?? {};

  const [tab, setTab] = useState<string>(() => {
    if (searchParams.status) {
      const normalized = normalizePipelineStage(searchParams.status);
      if (normalized) return normalized;
      if (searchParams.status.toLowerCase() === "cancelled") return "cancelled";
    }
    if (typeof window !== "undefined") {
      const urlParam = new URLSearchParams(window.location.search).get("status");
      if (urlParam) {
        const normalized = normalizePipelineStage(urlParam);
        if (normalized) return normalized;
        if (urlParam.toLowerCase() === "cancelled") return "cancelled";
      }
    }
    return "all";
  });

  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<"newest" | "oldest" | "total_high" | "total_low">("newest");
  const [openId, setOpenId] = useState<string | null>(null);
  const openOrder = useMemo(() => orders.find((o) => o.id === openId) ?? null, [orders, openId]);

  // Compute counts strictly from full orders array to ensure all tab counts remain accurate when filtered
  const counts = useMemo(() => calculateOrdersPageTabCounts(orders), [orders]);

  const handleTabChange = (nextTab: string) => {
    setTab(nextTab);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (nextTab === "all") {
        url.searchParams.delete("status");
      } else {
        url.searchParams.set("status", nextTab);
      }
      window.history.replaceState({}, "", url.toString());
    }
  };

  const filtered = useMemo(() => {
    let list = orders;

    // 1. Pipeline stage / tab filtering
    if (tab === "all") {
      list = orders;
    } else if (tab === "cancelled") {
      list = orders.filter((o) =>
        (CANCELLED_STATUSES as readonly string[]).includes(o.status),
      );
    } else {
      const stageKey = tab as PipelineStageKey;
      list = orders.filter((o) => orderMatchesStage(o.status, stageKey));
    }

    // 2. Search query filter
    const query = searchQuery.trim().toLowerCase();
    if (query) {
      list = list.filter((o) => {
        const orderNum = (o.orderNumber || "").toLowerCase();
        const buyer = (o.buyerName || "").toLowerCase();
        const phone = (o.buyerPhone || "").toLowerCase();
        const city = (o.city || "").toLowerCase();
        return (
          orderNum.includes(query) ||
          buyer.includes(query) ||
          phone.includes(query) ||
          city.includes(query)
        );
      });
    }

    // 3. Sorting
    return [...list].sort((a, b) => {
      const dateA = new Date(a.createdAt).getTime();
      const dateB = new Date(b.createdAt).getTime();
      if (sortBy === "newest") return dateB - dateA;
      if (sortBy === "oldest") return dateA - dateB;
      if (sortBy === "total_high") return b.total - a.total;
      if (sortBy === "total_low") return a.total - b.total;
      return 0;
    });
  }, [orders, tab, searchQuery, sortBy]);

  const activeStageConfig = useMemo(
    () => PIPELINE_STAGES.find((s) => s.key === tab),
    [tab],
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Orders</h1>
          <p className="text-sm text-muted-foreground">
            {orders.length} total orders • Accept, pack and ship right from here.
          </p>
        </div>
      </div>

      {/* Status Pipeline Filter Tabs */}
      <Tabs value={tab} onValueChange={handleTabChange}>
        <TabsList className="flex flex-wrap h-auto gap-1 p-1 bg-muted/60">
          {TABS.map((t) => {
            const count = counts[t.value] ?? 0;
            return (
              <TabsTrigger key={t.value} value={t.value} className="gap-2">
                {t.label}
                <Badge
                  variant={tab === t.value ? "default" : "secondary"}
                  className="ml-1 text-xs"
                >
                  {count}
                </Badge>
              </TabsTrigger>
            );
          })}
        </TabsList>
      </Tabs>

      {/* Search and Sort Toolbar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by order #, buyer, phone, city..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 pr-9"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Select
            value={sortBy}
            onValueChange={(v) =>
              setSortBy(v as "newest" | "oldest" | "total_high" | "total_low")
            }
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Sort orders" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">Newest first</SelectItem>
              <SelectItem value="oldest">Oldest first</SelectItem>
              <SelectItem value="total_high">Amount: High to Low</SelectItem>
              <SelectItem value="total_low">Amount: Low to High</SelectItem>
            </SelectContent>
          </Select>

          {(tab !== "all" || searchQuery) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                handleTabChange("all");
                setSearchQuery("");
              }}
              className="text-xs text-muted-foreground"
            >
              Reset filters
            </Button>
          )}
        </div>
      </div>

      {/* Orders List / Empty States */}
      {q.isLoading ? (
        <div className="py-12 text-center">
          <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
          <p className="mt-2 text-sm text-muted-foreground">Loading orders…</p>
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <div className="grid h-14 w-14 place-items-center rounded-2xl bg-primary/10 text-primary">
              <ShoppingBag className="h-6 w-6" />
            </div>
            {tab !== "all" ? (
              <>
                <div className="font-semibold text-base">
                  {tab === "cancelled"
                    ? "No Cancelled Orders"
                    : getPipelineEmptyState(tab as PipelineStageKey).title}
                </div>
                <p className="text-sm text-muted-foreground max-w-sm">
                  {tab === "cancelled"
                    ? "There are currently no cancelled or returned orders."
                    : getPipelineEmptyState(tab as PipelineStageKey).description}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2 text-xs"
                  onClick={() => handleTabChange("all")}
                >
                  View all orders
                </Button>
              </>
            ) : searchQuery ? (
              <>
                <div className="font-medium">No orders matching "{searchQuery}"</div>
                <p className="text-sm text-muted-foreground">
                  Try checking the order number or search with different keywords.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2 text-xs"
                  onClick={() => setSearchQuery("")}
                >
                  Clear search query
                </Button>
              </>
            ) : (
              <>
                <div className="font-medium">No orders here yet</div>
                <p className="text-sm text-muted-foreground">
                  Customer orders will appear here after checkout.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {filtered.map((o) => (
            <button
              key={o.id}
              onClick={() => setOpenId(o.id)}
              className="animate-fade-in text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-xl"
            >
              <Card className="transition hover:border-primary/50 hover:shadow-sm">
                <CardContent className="flex flex-wrap items-center gap-4 py-4">
                  <div className="flex-1 min-w-[180px]">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-semibold">{o.orderNumber}</span>
                      <Badge className={getStatusMeta(o.status).className}>
                        {getStatusMeta(o.status).label}
                      </Badge>
                    </div>
                    <div className="mt-1 text-sm text-muted-foreground">
                      {o.buyerName}
                      {o.city ? ` • ${o.city}` : ""}
                      {o.state ? `, ${o.state}` : ""}
                    </div>
                  </div>
                  <div className="text-sm">
                    <div className="font-medium">
                      {o.items.length} item{o.items.length > 1 ? "s" : ""}
                    </div>
                    <div className="text-muted-foreground">{o.paymentMode}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold">₹{o.total.toLocaleString("en-IN")}</div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(o.createdAt).toLocaleDateString("en-IN", {
                        timeZone: "Asia/Kolkata",
                      })}
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </CardContent>
              </Card>
            </button>
          ))}
        </div>
      )}

      <OrderDetailSheet order={openOrder} onClose={() => setOpenId(null)} />
    </div>
  );
}
