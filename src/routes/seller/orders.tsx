import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  ChevronRight,
  Loader2,
  MapPin,
  Package,
  Phone,
  ShoppingBag,
  Truck,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Separator } from "@/components/ui/separator";

import {
  useAdvanceOrder,
  useCancelOrder,
  useMyOrders,
  type Order,
  type OrderStatus,
} from "@/lib/db";

export const Route = createFileRoute("/seller/orders")({
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

const STATUS_META: Record<OrderStatus, { label: string; className: string }> = {
  new: { label: "New", className: "bg-primary text-primary-foreground" },
  accepted: { label: "Accepted", className: "bg-accent text-accent-foreground" },
  packed: { label: "Packed", className: "bg-accent text-accent-foreground" },
  ready_for_pickup: { label: "Ready for pickup", className: "bg-accent text-accent-foreground" },
  out_for_delivery: { label: "Out for delivery", className: "bg-accent text-accent-foreground" },
  shipped: { label: "Out for delivery", className: "bg-accent text-accent-foreground" },
  delivered: { label: "Delivered", className: "bg-success text-success-foreground" },
  cancelled: { label: "Cancelled", className: "bg-destructive text-destructive-foreground" },
  returned: { label: "Returned", className: "bg-muted text-muted-foreground" },
};
const FLOW: OrderStatus[] = ["new", "accepted", "packed", "ready_for_pickup"];
const TABS: Array<{ value: OrderStatus | "all"; label: string }> = [
  { value: "all", label: "All" },
  { value: "new", label: "New" },
  { value: "accepted", label: "Accepted" },
  { value: "packed", label: "Packed" },
  { value: "ready_for_pickup", label: "Ready for pickup" },
  { value: "out_for_delivery", label: "Out for delivery" },
  { value: "delivered", label: "Delivered" },
  { value: "cancelled", label: "Cancelled" },
];

const FALLBACK_STATUS_META = { label: "Unknown", className: "bg-muted text-muted-foreground" };

function getStatusMeta(status: OrderStatus) {
  return STATUS_META[status] ?? FALLBACK_STATUS_META;
}

function OrdersPage() {
  const q = useMyOrders();
  const orders = q.data ?? [];
  const [tab, setTab] = useState<OrderStatus | "all">("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const openOrder = useMemo(() => orders.find((o) => o.id === openId) ?? null, [orders, openId]);

  const filtered = useMemo(
    () => (tab === "all" ? orders : orders.filter((o) => o.status === tab)),
    [orders, tab],
  );
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: orders.length };
    for (const o of orders) c[o.status] = (c[o.status] ?? 0) + 1;
    return c;
  }, [orders]);

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

      <Tabs value={tab} onValueChange={(v) => setTab(v as OrderStatus | "all")}>
        <TabsList className="flex flex-wrap h-auto">
          {TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value} className="gap-2">
              {t.label}
              <Badge variant="secondary" className="ml-1">
                {counts[t.value] ?? 0}
              </Badge>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {q.isLoading ? (
        <div className="py-8 text-center">
          <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <div className="grid h-14 w-14 place-items-center rounded-2xl bg-primary/10 text-primary">
              <ShoppingBag className="h-6 w-6" />
            </div>
            <div className="font-medium">No orders here yet</div>
            <p className="text-sm text-muted-foreground">
              Customer orders will appear here after checkout.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {filtered.map((o) => (
            <button
              key={o.id}
              onClick={() => setOpenId(o.id)}
              className="animate-fade-in text-left"
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

function OrderDetailSheet({ order, onClose }: { order: Order | null; onClose: () => void }) {
  const [cancelOpen, setCancelOpen] = useState(false);
  const advance = useAdvanceOrder();
  const cancel = useCancelOrder();
  const nextStatus = order ? nextStep(order.status) : null;

  return (
    <Sheet open={!!order} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        {order && (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                <span className="font-mono">{order.orderNumber}</span>
                <Badge className={getStatusMeta(order.status).className}>
                  {getStatusMeta(order.status).label}
                </Badge>
              </SheetTitle>
              <SheetDescription>
                Placed on{" "}
                {new Date(order.createdAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}
              </SheetDescription>
            </SheetHeader>

            <div className="mt-4 space-y-5">
              <section className="rounded-lg border border-border p-3">
                <div className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                  Buyer
                </div>
                <div className="font-medium">{order.buyerName}</div>
                <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                  <Phone className="h-3.5 w-3.5" /> {order.buyerPhone}
                </div>
                <div className="mt-1 flex items-start gap-2 text-sm text-muted-foreground">
                  <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    {order.buyerAddress}
                    {order.city ? `, ${order.city}, ${order.state}` : ""}
                    {order.pincode ? ` — ${order.pincode}` : ""}
                  </span>
                </div>
              </section>

              <section>
                <div className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                  Items
                </div>
                <div className="space-y-2">
                  {order.items.map((it) => (
                    <div
                      key={it.id}
                      className="flex justify-between rounded-md border border-border p-2 text-sm"
                    >
                      <div>
                        <div className="font-medium">{it.name}</div>
                        <div className="text-xs text-muted-foreground">SKU: {it.sku}</div>
                      </div>
                      <div className="text-right">
                        <div>
                          ₹{it.price.toLocaleString("en-IN")} × {it.qty}
                        </div>
                        <div className="font-medium">
                          ₹{(it.price * it.qty).toLocaleString("en-IN")}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <Separator className="my-3" />
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Subtotal</span>
                    <span>₹{order.subtotal.toLocaleString("en-IN")}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Shipping</span>
                    <span>₹{order.shipping.toLocaleString("en-IN")}</span>
                  </div>
                  <div className="flex justify-between font-semibold">
                    <span>Total ({order.paymentMode})</span>
                    <span>₹{order.total.toLocaleString("en-IN")}</span>
                  </div>
                </div>
              </section>

              {order.awb && (
                <section className="rounded-lg border border-border p-3">
                  <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
                    <Truck className="h-3.5 w-3.5" /> Shipping
                  </div>
                  <div className="text-sm">{order.courier}</div>
                  <div className="font-mono text-xs text-muted-foreground">AWB: {order.awb}</div>
                </section>
              )}

              {order.status !== "delivered" &&
                order.status !== "cancelled" &&
                order.status !== "returned" && (
                  <div className="flex flex-wrap gap-2">
                    {nextStatus && (
                      <Button
                        onClick={async () => {
                          try {
                            const result = await advance.mutateAsync({ id: order.id });
                            toast.success(
                              result.dispatched > 0
                                ? `Marked as ${result.status}. Delivery request sent.`
                                : `Marked as ${result.status}. Waiting for an eligible partner with a fresh location.`,
                            );
                          } catch (e: any) {
                            toast.error(e?.message ?? "Failed");
                          }
                        }}
                        disabled={advance.isPending}
                      >
                        <Package className="h-4 w-4" />{" "}
                        {order.status === "ready_for_pickup"
                          ? "Retry delivery request"
                          : `Mark as ${nextStatus}`}
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      onClick={() => setCancelOpen(true)}
                      disabled={advance.isPending}
                    >
                      <XCircle className="h-4 w-4" /> Cancel order
                    </Button>
                  </div>
                )}
            </div>

            <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Cancel this order?</AlertDialogTitle>
                  <AlertDialogDescription>
                    The buyer will be notified. Cancellations may impact your seller rating.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep order</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={async () => {
                      try {
                        await cancel.mutateAsync({ id: order.id, reason: "Cancelled by seller" });
                        toast.success("Order cancelled");
                        setCancelOpen(false);
                      } catch (e: any) {
                        toast.error(e?.message ?? "Failed");
                      }
                    }}
                  >
                    Cancel order
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function nextStep(status: OrderStatus): OrderStatus | null {
  if (status === "ready_for_pickup") return "ready_for_pickup";
  const idx = FLOW.indexOf(status);
  if (idx < 0 || idx >= FLOW.length - 1) return null;
  return FLOW[idx + 1];
}
