import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo } from "react";
import {
  AlertTriangle,
  Box,
  CheckCircle2,
  Clock3,
  IndianRupee,
  PackagePlus,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  ShoppingBag,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth";
import { type Order, type Seller, useMyOrders } from "@/lib/db";
import { listProducts, type ProductDto } from "@/lib/products.functions";
import {
  useActiveOverride,
  useMyShopHours,
  useRevertShopOverride,
  useSetShopOverride,
  useShopStatus,
} from "@/lib/shop-availability";

const ACTIVE_ORDER_STATUSES = new Set([
  "new",
  "accepted",
  "vendor_accepted",
  "preparing",
  "packed",
  "ready_for_pickup",
  "assigned",
  "delivery_partner_assigned",
  "going_to_vendor",
  "arrived_at_vendor",
  "rider_assigned",
  "rider_accepted",
  "rider_at_shop",
  "picked_up",
  "going_to_customer",
  "arrived_at_customer",
  "out_for_delivery",
  "at_customer",
  "shipped",
]);

const PIPELINE = [
  { label: "New", statuses: ["new"] },
  { label: "Accepted", statuses: ["accepted", "vendor_accepted"] },
  { label: "Preparing", statuses: ["preparing", "packed"] },
  { label: "Ready", statuses: ["ready_for_pickup"] },
  {
    label: "Delivery",
    statuses: [
      "assigned",
      "delivery_partner_assigned",
      "going_to_vendor",
      "arrived_at_vendor",
      "rider_assigned",
      "rider_accepted",
      "rider_at_shop",
      "picked_up",
      "going_to_customer",
      "arrived_at_customer",
      "out_for_delivery",
      "at_customer",
      "shipped",
    ],
  },
  { label: "Delivered", statuses: ["delivered"] },
] as const;

function startOfLocalDay(offsetDays = 0) {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + offsetDays);
  return date.getTime();
}

function formatTime(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit" }).format(
    new Date(2000, 0, 1, hour, minute),
  );
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export function SellerDashboardOverview({ seller }: { seller: Seller }) {
  const { user } = useAuth();
  const ordersQ = useMyOrders();
  const list = useServerFn(listProducts);
  const productsQ = useQuery<ProductDto[]>({
    queryKey: ["products", user?.id],
    queryFn: () => list() as Promise<ProductDto[]>,
    enabled: !!user,
  });
  const statusQ = useShopStatus(seller.id);
  const hoursQ = useMyShopHours(seller.id);
  const overrideQ = useActiveOverride(seller.id);
  const setOverride = useSetShopOverride();
  const revertOverride = useRevertShopOverride();

  const orders = ordersQ.data ?? [];
  const products = productsQ.data ?? [];
  const todayStart = startOfLocalDay();
  const tomorrowStart = startOfLocalDay(1);
  const todayOrders = orders.filter((order) => {
    const placed = new Date(order.createdAt).getTime();
    return placed >= todayStart && placed < tomorrowStart;
  });
  const todayDelivered = todayOrders.filter((order) => order.status === "delivered");
  const todaySales = todayDelivered.reduce((sum, order) => sum + order.total, 0);
  const lowStock = products.filter((product) => product.stock <= product.lowStockAt);
  const newOrders = orders.filter((order) => order.status === "new");
  const pendingOrders = orders.filter((order) => ACTIVE_ORDER_STATUSES.has(order.status));
  const averageOrderValue = todayOrders.length
    ? todayOrders.reduce((sum, order) => sum + order.total, 0) / todayOrders.length
    : 0;
  const recentOrders = orders.slice(0, 6);
  const todayHour = hoursQ.data?.find((hour) => hour.dayOfWeek === new Date().getDay());
  const summaryLoading = ordersQ.isLoading || productsQ.isLoading;
  const summaryError = ordersQ.isError || productsQ.isError;
  const ordersUnavailable = ordersQ.isLoading || ordersQ.isError;
  const productsUnavailable = productsQ.isLoading || productsQ.isError;

  const pipeline = useMemo(
    () =>
      PIPELINE.map((stage) => ({
        ...stage,
        count: orders.filter((order) =>
          (stage.statuses as readonly string[]).includes(order.status),
        ).length,
      })),
    [orders],
  );

  async function changeStoreStatus(action: "open" | "close" | "pause" | "resume") {
    try {
      if (action === "resume") {
        await revertOverride.mutateAsync(seller.id);
        toast.success("Manual pause removed. Business hours are active again.");
      } else {
        await setOverride.mutateAsync({
          sellerId: seller.id,
          kind:
            action === "open"
              ? "manual_open"
              : action === "close"
                ? "manual_closed"
                : "temporary_closed",
          reason:
            action === "pause"
              ? "Orders paused by seller"
              : action === "close"
                ? "Store closed by seller"
                : "Store opened by seller",
        });
        toast.success(
          action === "open"
            ? "Store opened"
            : action === "close"
              ? "Store closed"
              : "New orders paused",
        );
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update store status");
    }
  }

  const busy = setOverride.isPending || revertOverride.isPending;
  const paused = overrideQ.data?.kind === "temporary_closed";
  const manuallyClosed = overrideQ.data?.kind === "manual_closed";
  const isOpen = statusQ.data?.isOpen ?? false;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            {greeting()}, {seller.business.shopName || "your store"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Here’s what needs your attention today.
          </p>
        </div>
        <Badge className="w-fit bg-success text-success-foreground">Verified seller</Badge>
      </div>

      <Card className="overflow-hidden border-primary/20">
        <CardContent className="grid gap-4 p-4 lg:grid-cols-[1.25fr_1fr] lg:p-5">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <div
                className={`h-2.5 w-2.5 rounded-full ${paused ? "bg-amber-500" : isOpen ? "bg-emerald-500" : "bg-red-500"}`}
              />
              <span className="font-semibold">
                {paused ? "Orders paused" : isOpen ? "Store open" : "Store closed"}
              </span>
              {statusQ.data?.label && (
                <span className="text-sm text-muted-foreground">{statusQ.data.label}</span>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {!isOpen && (
                <Button size="sm" disabled={busy} onClick={() => void changeStoreStatus("open")}>
                  <PlayCircle className="h-4 w-4" /> Open store
                </Button>
              )}
              {isOpen && !paused && !manuallyClosed && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void changeStoreStatus("close")}
                >
                  Close store
                </Button>
              )}
              {!paused ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void changeStoreStatus("pause")}
                >
                  <PauseCircle className="h-4 w-4" /> Pause orders
                </Button>
              ) : (
                <Button size="sm" disabled={busy} onClick={() => void changeStoreStatus("resume")}>
                  <RefreshCw className="h-4 w-4" /> Resume orders
                </Button>
              )}
              <Link to="/seller/hours">
                <Button size="sm" variant="ghost">
                  Manage hours
                </Button>
              </Link>
            </div>
          </div>
          <div className="grid gap-3 text-sm">
            <Info label="Today’s hours" icon={Clock3}>
              {todayHour?.isOpen
                ? `${formatTime(todayHour.openTime)} – ${formatTime(todayHour.closeTime)}`
                : "Closed"}
            </Info>
          </div>
        </CardContent>
      </Card>

      {(summaryLoading || summaryError) && (
        <Card className={summaryError ? "border-destructive/40" : "border-primary/20"}>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
            <p className="text-muted-foreground">
              {summaryError
                ? "Some dashboard data could not be loaded. Other seller tools remain available."
                : "Loading orders and products… You can use the dashboard while they load."}
            </p>
            {summaryError && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void Promise.all([ordersQ.refetch(), productsQ.refetch()])}
              >
                <RefreshCw className="h-4 w-4" /> Retry
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Kpi
          label="Today’s sales"
          value={ordersUnavailable ? "—" : `₹${Math.round(todaySales).toLocaleString("en-IN")}`}
          icon={IndianRupee}
        />
        <Kpi
          label="Today’s orders"
          value={ordersUnavailable ? "—" : todayOrders.length}
          icon={ShoppingBag}
        />
        <Kpi
          label="New orders"
          value={ordersUnavailable ? "—" : newOrders.length}
          icon={AlertTriangle}
          urgent={newOrders.length > 0}
        />
        <Kpi
          label="Average order value"
          value={
            ordersUnavailable ? "—" : `₹${Math.round(averageOrderValue).toLocaleString("en-IN")}`
          }
          icon={IndianRupee}
        />
        <Kpi
          label="Pending orders"
          value={ordersUnavailable ? "—" : pendingOrders.length}
          icon={Clock3}
        />
        <Kpi
          label="Low-stock products"
          value={productsUnavailable ? "—" : lowStock.length}
          icon={Box}
          urgent={lowStock.length > 0}
        />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Order pipeline</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
          {pipeline.map((stage) => (
            <Link
              key={stage.label}
              to="/seller/orders"
              className="rounded-xl border p-3 transition-colors hover:border-primary/50 hover:bg-muted/40"
            >
              <div className="text-xs font-medium text-muted-foreground">{stage.label}</div>
              <div className="mt-1 text-2xl font-bold">{ordersUnavailable ? "—" : stage.count}</div>
            </Link>
          ))}
        </CardContent>
      </Card>

      {!summaryLoading && !summaryError && (newOrders.length > 0 || lowStock.length > 0) && (
        <Card className="border-amber-500/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Action required</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {newOrders.length > 0 && (
              <ActionLink
                to="/seller/orders"
                icon={ShoppingBag}
                text={`${newOrders.length} order${newOrders.length === 1 ? " is" : "s are"} waiting for acceptance`}
              />
            )}
            {lowStock.length > 0 && (
              <ActionLink
                to="/seller/inventory"
                icon={Box}
                text={`${lowStock.length} product${lowStock.length === 1 ? " is" : "s are"} low or out of stock`}
              />
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <QuickAction to="/seller/products" icon={PackagePlus} label="Add product" />
        <QuickAction to="/seller/inventory" icon={Box} label="Update stock" />
        <QuickAction to="/seller/orders" icon={ShoppingBag} label="View orders" />
        <QuickAction to="/seller/analytics" icon={CheckCircle2} label="View analytics" />
        <Button
          variant="outline"
          className="h-auto justify-start gap-3 p-4"
          onClick={() => void changeStoreStatus(paused ? "resume" : "pause")}
        >
          {paused ? (
            <PlayCircle className="h-5 w-5 text-primary" />
          ) : (
            <PauseCircle className="h-5 w-5 text-primary" />
          )}
          {paused ? "Resume orders" : "Pause orders"}
        </Button>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Recent orders</CardTitle>
          <Link to="/seller/orders" className="text-sm font-medium text-primary hover:underline">
            View all
          </Link>
        </CardHeader>
        <CardContent>
          {ordersQ.isLoading ? (
            <div className="space-y-3 py-2" aria-label="Loading recent orders">
              {[0, 1, 2].map((item) => (
                <Skeleton key={item} className="h-12 w-full" />
              ))}
            </div>
          ) : ordersQ.isError ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Recent orders are unavailable. Use Retry above to load them again.
            </p>
          ) : recentOrders.length === 0 ? (
            <div className="py-10 text-center">
              <ShoppingBag className="mx-auto h-8 w-8 text-muted-foreground/50" />
              <p className="mt-3 font-medium">No orders yet</p>
              <p className="text-sm text-muted-foreground">Customer orders will appear here.</p>
            </div>
          ) : (
            <div className="divide-y">
              {recentOrders.map((order) => (
                <RecentOrder key={order.id} order={order} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Info({
  label,
  icon: Icon,
  children,
}: {
  label: string;
  icon: typeof Clock3;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl bg-muted/50 p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="mt-1 font-semibold">{children}</div>
    </div>
  );
}

function Kpi({
  label,
  value,
  icon: Icon,
  urgent,
}: {
  label: string;
  value: string | number;
  icon: typeof Clock3;
  urgent?: boolean;
}) {
  return (
    <Card>
      <CardContent className="flex items-start justify-between p-4">
        <div>
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          <p className={`mt-1 text-2xl font-bold ${urgent ? "text-amber-600" : ""}`}>{value}</p>
        </div>
        <div
          className={`rounded-lg p-2 ${urgent ? "bg-amber-500/10 text-amber-600" : "bg-primary/10 text-primary"}`}
        >
          <Icon className="h-4 w-4" />
        </div>
      </CardContent>
    </Card>
  );
}

function ActionLink({
  to,
  icon: Icon,
  text,
}: {
  to: "/seller/orders" | "/seller/inventory";
  icon: typeof Box;
  text: string;
}) {
  return (
    <Link
      to={to}
      className="flex items-center gap-3 rounded-lg border p-3 text-sm font-medium hover:border-primary/50 hover:bg-muted/40"
    >
      <Icon className="h-4 w-4 text-amber-600" />
      <span className="flex-1">{text}</span>
      <span className="text-primary">Review</span>
    </Link>
  );
}

function QuickAction({
  to,
  icon: Icon,
  label,
}: {
  to: "/seller/products" | "/seller/inventory" | "/seller/orders" | "/seller/analytics";
  icon: typeof Box;
  label: string;
}) {
  return (
    <Link to={to}>
      <Button variant="outline" className="h-full w-full justify-start gap-3 p-4">
        <Icon className="h-5 w-5 text-primary" />
        {label}
      </Button>
    </Link>
  );
}

function RecentOrder({ order }: { order: Order }) {
  const items = order.items.reduce((sum, item) => sum + item.qty, 0);
  return (
    <Link
      to="/seller/orders"
      className="grid gap-2 py-3 text-sm transition-colors hover:bg-muted/30 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-center sm:px-2"
    >
      <div>
        <p className="font-semibold">#{order.orderNumber}</p>
        <p className="text-xs text-muted-foreground">
          {order.buyerName || "Customer"} · {items} item{items === 1 ? "" : "s"}
        </p>
      </div>
      <p className="text-xs text-muted-foreground">
        {new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(
          new Date(order.createdAt),
        )}
      </p>
      <Badge variant="outline" className="w-fit capitalize">
        {order.status.replaceAll("_", " ")}
      </Badge>
      <p className="font-semibold">₹{order.total.toLocaleString("en-IN")}</p>
    </Link>
  );
}
