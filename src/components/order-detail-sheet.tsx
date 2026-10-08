import { useEffect, useRef, useState } from "react";
import { Loader2, MapPin, Package, Phone, Truck } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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
  useCancelOrder,
  useVendorAcceptOrder,
  useVendorMarkReady,
  useVendorRejectOrder,
  useVendorStopLiveLocation,
  useVendorUpdateLiveLocation,
} from "@/modules/seller/services/orders";
import { type Order, type OrderStatus } from "@/shared/core/seller";

export const STATUS_META: Record<OrderStatus, { label: string; className: string }> = {
  new: { label: "New (Action Required)", className: "bg-amber-600 text-white animate-pulse" },
  accepted: { label: "Accepted", className: "bg-accent text-accent-foreground" },
  vendor_accepted: { label: "Accepted (Preparing)", className: "bg-emerald-600 text-white" },
  cancelled_by_vendor: {
    label: "Cancelled by Vendor",
    className: "bg-destructive text-destructive-foreground",
  },
  preparing: { label: "Preparing", className: "bg-accent text-accent-foreground" },
  packed: { label: "Packed", className: "bg-accent text-accent-foreground" },
  ready_for_pickup: { label: "Ready for pickup", className: "bg-amber-500 text-white" },
  assigned: { label: "Rider assigned", className: "bg-sky-600 text-white" },
  delivery_partner_assigned: { label: "Rider assigned", className: "bg-sky-600 text-white" },
  going_to_vendor: { label: "Rider going to shop", className: "bg-indigo-600 text-white" },
  arrived_at_vendor: { label: "Rider arrived at shop", className: "bg-purple-600 text-white" },
  rider_assigned: { label: "Rider assigned", className: "bg-sky-600 text-white" },
  rider_accepted: { label: "Rider accepted", className: "bg-sky-600 text-white" },
  rider_at_shop: { label: "Rider at shop", className: "bg-purple-600 text-white" },
  picked_up: { label: "Picked up", className: "bg-indigo-600 text-white" },
  going_to_customer: { label: "Heading to customer", className: "bg-blue-600 text-white" },
  arrived_at_customer: { label: "Arrived at customer", className: "bg-blue-600 text-white" },
  out_for_delivery: { label: "Out for delivery", className: "bg-blue-600 text-white" },
  at_customer: { label: "Rider at customer", className: "bg-blue-600 text-white" },
  shipped: { label: "Out for delivery", className: "bg-blue-600 text-white" },
  delivered: { label: "Delivered", className: "bg-emerald-600 text-white" },
  cancelled: { label: "Cancelled", className: "bg-destructive text-destructive-foreground" },
  returned: { label: "Returned", className: "bg-muted text-muted-foreground" },
  assignment_failed: { label: "Dispatch pending", className: "bg-amber-600 text-white" },
  delivery_failed: {
    label: "Delivery failed",
    className: "bg-destructive text-destructive-foreground",
  },
};

export const FALLBACK_STATUS_META = {
  label: "Unknown",
  className: "bg-muted text-muted-foreground",
};

export function getStatusMeta(status: OrderStatus | string) {
  return (STATUS_META as Record<string, { label: string; className: string }>)[status] ?? FALLBACK_STATUS_META;
}

export function VendorLiveLocationControl({
  orderId,
  assignedPartnerName,
  orderStatus,
}: {
  orderId: string;
  assignedPartnerName?: string;
  orderStatus: OrderStatus;
}) {
  const [isSharing, setIsSharing] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);
  const updateLive = useVendorUpdateLiveLocation();
  const stopLive = useVendorStopLiveLocation();
  const watchIdRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(0);

  useEffect(() => {
    // Automatically stop sharing if order moves to picked_up or delivered
    if (
      [
        "picked_up",
        "going_to_customer",
        "arrived_at_customer",
        "delivered",
        "cancelled",
        "cancelled_by_vendor",
      ].includes(orderStatus)
    ) {
      if (isSharing) {
        if (watchIdRef.current !== null) {
          navigator.geolocation.clearWatch(watchIdRef.current);
          watchIdRef.current = null;
        }
        void stopLive.mutateAsync({ id: orderId }).catch((error) => {
          console.error("Failed to stop live location after order status change:", error);
        });
        setIsSharing(false);
      }
    }
  }, [orderStatus, isSharing, stopLive, orderId]);

  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, []);

  const toggleSharing = async () => {
    if (isSharing) {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      try {
        await stopLive.mutateAsync({ id: orderId });
        toast.info("Live location sharing stopped");
      } catch (e: any) {
        toast.error(e?.message ?? "Failed to stop live location");
      }
      setIsSharing(false);
    } else {
      if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
        toast.error("Geolocation is not supported by your browser");
        return;
      }

      setIsSharing(true);
      toast.success("Sharing live location with delivery partner...");

      const wid = navigator.geolocation.watchPosition(
        async (pos) => {
          const now = Date.now();
          // Throttle updates to once every 3 seconds minimum
          if (now - lastTimeRef.current < 3000) return;
          lastTimeRef.current = now;

          try {
            await updateLive.mutateAsync({
              id: orderId,
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              heading: pos.coords.heading ?? undefined,
              speed: pos.coords.speed ?? undefined,
              accuracy: pos.coords.accuracy ?? undefined,
            });
            setLastUpdate(new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" }));
          } catch (e: any) {
            console.error("Live location update error:", e);
          }
        },
        (err) => {
          toast.error(`GPS Error: ${err.message}`);
          if (watchIdRef.current !== null) {
            navigator.geolocation.clearWatch(watchIdRef.current);
            watchIdRef.current = null;
          }
          void stopLive.mutateAsync({ id: orderId }).catch((error) => {
            console.error("Failed to stop live location after GPS error:", error);
          });
          setIsSharing(false);
        },
        {
          enableHighAccuracy: true,
          maximumAge: 3000,
          timeout: 15000,
        },
      );
      watchIdRef.current = wid;
    }
  };

  return (
    <div className="rounded-lg border border-indigo-200 bg-indigo-50/50 dark:border-indigo-900 dark:bg-indigo-950/30 p-3 space-y-2.5">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold uppercase text-indigo-900 dark:text-indigo-300 flex items-center gap-1.5">
          <MapPin className="h-4 w-4 text-indigo-600 dark:text-indigo-400 animate-bounce" />
          Live Location Sharing
        </div>
        {isSharing ? (
          <Badge className="bg-emerald-600 text-white gap-1 animate-pulse">
            <span className="h-2 w-2 rounded-full bg-white animate-ping" /> Sharing
          </Badge>
        ) : (
          <Badge variant="outline" className="text-muted-foreground text-[10px]">
            Inactive
          </Badge>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        {assignedPartnerName
          ? `Share your current GPS location to guide ${assignedPartnerName} directly to your pickup point.`
          : "Share your live location to help the assigned delivery partner find your shop entrance."}
      </p>

      {isSharing && lastUpdate && (
        <div className="text-[11px] font-mono text-emerald-700 dark:text-emerald-400">
          Last broadcast: {lastUpdate}
        </div>
      )}

      <Button
        type="button"
        size="sm"
        variant={isSharing ? "destructive" : "default"}
        className={`w-full text-xs font-semibold ${
          !isSharing
            ? "bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-600/20"
            : ""
        }`}
        onClick={toggleSharing}
        disabled={updateLive.isPending || stopLive.isPending}
      >
        <MapPin className="mr-1.5 h-3.5 w-3.5" />
        {isSharing ? "Stop Sharing Live Location" : "📍 Share Live Location"}
      </Button>
    </div>
  );
}

export function OrderDetailSheet({
  order,
  onClose,
}: {
  order: Order | null;
  onClose: () => void;
}) {
  const [rejectOpen, setRejectOpen] = useState(false);
  const [prepMinutes, setPrepMinutes] = useState(20);

  const acceptOrder = useVendorAcceptOrder();
  const rejectOrder = useVendorRejectOrder();
  const markReady = useVendorMarkReady();
  const cancelOrder = useCancelOrder();

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

              {/* Delivery Partner & Dispatch Status Section */}
              <section className="rounded-lg border border-primary/20 bg-primary/5 p-3.5 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase text-primary">
                    <Truck className="h-4 w-4 text-primary" /> Delivery Partner Status
                  </div>
                  {order.status === "ready_for_pickup" && (
                    <Badge variant="outline" className="bg-amber-100 text-amber-800 text-[10px]">
                      Ready for Pickup
                    </Badge>
                  )}
                </div>

                {order.assignedPartner ? (
                  <div className="space-y-2 pt-1 text-sm">
                    <div className="flex items-center justify-between bg-background p-2.5 rounded-md border border-border">
                      <div>
                        <div className="font-semibold text-foreground flex items-center gap-1.5">
                          <span>{order.assignedPartner.fullName}</span>
                          {order.assignedPartner.rating && (
                            <span className="text-xs text-amber-500 font-medium">
                              ★ {order.assignedPartner.rating}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {order.assignedPartner.vehicleType} •{" "}
                          {order.assignedPartner.vehicleNumber || "Verified Rider"}
                        </div>
                      </div>
                      {order.assignedPartner.mobile && (
                        <a
                          href={`tel:${order.assignedPartner.mobile}`}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 bg-emerald-50 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 px-2.5 py-1.5 rounded-md hover:bg-emerald-100 transition-colors"
                        >
                          <Phone className="h-3.5 w-3.5" /> Call Partner
                        </a>
                      )}
                    </div>

                    <div className="text-xs text-muted-foreground flex items-center justify-between px-1">
                      <span>Assignment Status:</span>
                      <span className="font-semibold capitalize text-foreground">
                        {order.deliveryAssignment?.status?.replace(/_/g, " ") ?? "Assigned"}
                      </span>
                    </div>
                  </div>
                ) : order.deliveryAssignment &&
                  ["pending", "requested"].includes(order.deliveryAssignment.status) ? (
                  <div className="p-2.5 bg-amber-50 dark:bg-amber-950/40 rounded-md border border-amber-200 dark:border-amber-800 text-xs space-y-1">
                    <div className="font-semibold text-amber-800 dark:text-amber-300 flex items-center gap-1">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Dispatch Request Sent
                    </div>
                    <p className="text-amber-700 dark:text-amber-400">
                      Broadcasting order to nearby active delivery partners.
                    </p>
                  </div>
                ) : (
                  <div className="p-2.5 bg-background rounded-md border text-xs space-y-1.5">
                    <div className="text-muted-foreground">
                      {order.status === "ready_for_pickup"
                        ? "No partner has accepted yet. Delivery dispatch is active."
                        : order.status === "new"
                          ? "Accept the order to begin preparation."
                          : "Click 'Ready for Pickup' below when order is prepared to dispatch a delivery partner."}
                    </div>
                  </div>
                )}
              </section>

              {/* Vendor Live Location Control Component */}
              {(order.status === "ready_for_pickup" ||
                order.assignedPartner ||
                [
                  "assigned",
                  "delivery_partner_assigned",
                  "going_to_vendor",
                  "arrived_at_vendor",
                ].includes(order.status)) && (
                <VendorLiveLocationControl
                  orderId={order.id}
                  assignedPartnerName={order.assignedPartner?.fullName}
                  orderStatus={order.status}
                />
              )}

              {/* Workflow Action Buttons */}
              <div className="space-y-3 pt-2">
                {/* 1. New Order Approval Flow */}
                {order.status === "new" && (
                  <div className="space-y-3 rounded-lg border border-amber-300 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/30 p-3.5">
                    <div className="text-xs font-semibold text-amber-900 dark:text-amber-300 flex items-center gap-1.5">
                      <Package className="h-4 w-4 text-amber-600" /> New Order Approval
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs text-muted-foreground font-medium">
                        Estimated Preparation Time
                      </label>
                      <div className="flex gap-2">
                        {[15, 20, 30, 45].map((mins) => (
                          <Button
                            key={mins}
                            type="button"
                            size="sm"
                            variant={prepMinutes === mins ? "default" : "outline"}
                            className="flex-1 text-xs"
                            onClick={() => setPrepMinutes(mins)}
                          >
                            {mins} mins
                          </Button>
                        ))}
                      </div>
                    </div>

                    <div className="flex gap-2 pt-1">
                      <Button
                        type="button"
                        className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold shadow-md"
                        disabled={acceptOrder.isPending}
                        onClick={async () => {
                          try {
                            await acceptOrder.mutateAsync({
                              id: order.id,
                              estimatedPrepMinutes: prepMinutes,
                            });
                            toast.success("Order accepted! Start preparing items.");
                          } catch (e: any) {
                            toast.error(e?.message ?? "Failed to accept order");
                          }
                        }}
                      >
                        {acceptOrder.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          "Accept Order"
                        )}
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        className="flex-1 font-semibold"
                        disabled={rejectOrder.isPending}
                        onClick={() => setRejectOpen(true)}
                      >
                        Reject Order
                      </Button>
                    </div>
                  </div>
                )}

                {/* 2. Ready for Pickup Flow */}
                {(order.status === "vendor_accepted" ||
                  order.status === "accepted" ||
                  order.status === "preparing" ||
                  order.status === "packed") && (
                  <Button
                    type="button"
                    className="w-full h-12 text-base font-semibold bg-amber-500 hover:bg-amber-600 text-white shadow-lg shadow-amber-500/20"
                    disabled={markReady.isPending}
                    onClick={async () => {
                      try {
                        const res = await markReady.mutateAsync({ id: order.id });
                        if (res.dispatch_error) {
                          toast.error("Order is ready, but delivery dispatch failed.", {
                            description: res.dispatch_error,
                            duration: 10_000,
                          });
                        } else if (res.dispatched_count > 0) {
                          toast.success(
                            `Order is ready. Delivery request sent to ${res.dispatched_count} nearby partner(s).`,
                          );
                        } else {
                          toast.warning(
                            "Order is ready, but no delivery offer was created. Check partner availability.",
                          );
                        }
                      } catch (e: any) {
                        toast.error(e?.message ?? "Failed to mark order ready");
                      }
                    }}
                  >
                    {markReady.isPending ? (
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    ) : (
                      "✅ Ready for Pickup"
                    )}
                  </Button>
                )}
              </div>
            </div>

            {/* Reject Confirmation Dialog */}
            <AlertDialog open={rejectOpen} onOpenChange={setRejectOpen}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Reject this customer order?</AlertDialogTitle>
                  <AlertDialogDescription>
                    The buyer will be notified immediately. Order items will be returned to stock.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Back</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive hover:bg-destructive/90 text-destructive-foreground font-semibold"
                    onClick={async () => {
                      try {
                        await rejectOrder.mutateAsync({
                          id: order.id,
                          reason: "Cancelled by vendor",
                        });
                        toast.success("Order rejected");
                        setRejectOpen(false);
                      } catch (e: any) {
                        toast.error(e?.message ?? "Failed");
                      }
                    }}
                  >
                    Reject Order
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
