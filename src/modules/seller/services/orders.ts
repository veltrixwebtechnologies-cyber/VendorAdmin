import type { OrderStatus, Notification } from "@/shared/core/seller";

import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { rowToOrder } from "@/shared/services/data-mappers";
import {
  playOrderNotificationSound,
  triggerDesktopOrderNotification,
} from "@/shared/notifications/seller-events";

export function useMyOrders() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["my-orders", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data: seller, error: sellerError } = await supabase
        .from("sellers")
        .select("id")
        .eq("user_id", user!.id)
        .maybeSingle();
      if (sellerError) throw sellerError;
      if (!seller) return [];

      const { data: mainData, error: mainError } = await supabase
        .from("orders")
        .select("*, order_items(*), delivery_assignments(*, delivery_partners(*))")
        .eq("seller_id", seller.id)
        .order("placed_at", { ascending: false });

      let data = mainData;
      if (mainError) {
        const fallback = await supabase
          .from("orders")
          .select("*, order_items(*)")
          .eq("seller_id", seller.id)
          .order("placed_at", { ascending: false });
        data = fallback.data as any;
        if (fallback.error) throw fallback.error;
      }
      return (data ?? []).map((r: any) => rowToOrder(r, r.order_items));
    },
  });

  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`seller-orders-${user.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "orders" },
        (payload: any) => {
          const newOrder = payload.new;
          const orderNum = newOrder?.order_number || "New Order";
          const totalAmt = newOrder?.total ? `₹${newOrder.total}` : "";

          playOrderNotificationSound();

          toast.success(`🔔 NEW ORDER RECEIVED! #${orderNum} (${totalAmt})`, {
            duration: 15000,
            description: "A customer just placed an order with your store! Click to view.",
            action: {
              label: "View Orders",
              onClick: () => {
                if (typeof window !== "undefined") {
                  window.location.href = "/seller/orders";
                }
              },
            },
          });

          triggerDesktopOrderNotification(
            `🔔 New Order #${orderNum}!`,
            `Customer order of ${totalAmt} received. Click to open seller portal.`,
          );

          void qc.invalidateQueries({ queryKey: ["my-orders", user.id] });
        },
      )
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "orders" }, () => {
        void qc.invalidateQueries({ queryKey: ["my-orders", user.id] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "order_items" }, () => {
        void qc.invalidateQueries({ queryKey: ["my-orders", user.id] });
      })
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "delivery_assignments" },
        () => {
          void qc.invalidateQueries({ queryKey: ["my-orders", user.id] });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [qc, user]);

  return query;
}

export function useOrderNotificationListener() {
  const { user } = useAuth();
  const qc = useQueryClient();

  useEffect(() => {
    if (!user) return;

    if (
      typeof window !== "undefined" &&
      "Notification" in window &&
      Notification.permission === "default"
    ) {
      Notification.requestPermission().catch(() => {});
    }

    const channel = supabase
      .channel(`seller-global-orders-${user.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "orders" },
        (payload: any) => {
          const newOrder = payload.new;
          const orderNum = newOrder?.order_number || "New Order";
          const totalAmt = newOrder?.total ? `₹${newOrder.total}` : "";

          playOrderNotificationSound();

          toast.success(`🔔 NEW ORDER RECEIVED! #${orderNum} (${totalAmt})`, {
            duration: 15000,
            description: "A customer placed a new order with your store. Click to view orders.",
            action: {
              label: "View Order",
              onClick: () => {
                if (typeof window !== "undefined") {
                  window.location.href = "/seller/orders";
                }
              },
            },
          });

          triggerDesktopOrderNotification(
            `🔔 New Order #${orderNum}!`,
            `Customer order of ${totalAmt} received. Click to open seller portal.`,
          );

          void qc.invalidateQueries({ queryKey: ["my-orders", user.id] });
          void qc.invalidateQueries({ queryKey: ["my-notifications", user.id] });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [user, qc]);
}

export function useAdvanceOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { id: string }) => {
      const { data, error } = await (supabase as any).rpc("advance_seller_order", {
        _order_id: v.id,
      });
      if (error) {
        console.error("[orders] advance_seller_order failed", {
          orderId: v.id,
          code: error.code,
          status: error.status,
          message: error.message,
          details: error.details,
          hint: error.hint,
        });
        throw error;
      }
      return data as { status: OrderStatus; dispatched: number };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-orders"] });
      qc.invalidateQueries({ queryKey: ["my-notifications"] });
    },
  });
}

export function useCancelOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { id: string; reason: string }) => {
      const { data, error } = await (supabase as any).rpc("cancel_seller_order", {
        _order_id: v.id,
        _reason: v.reason,
      });
      if (error) throw error;
      if (!data) throw new Error("Order was not cancelled");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-orders"] });
      qc.invalidateQueries({ queryKey: ["my-notifications"] });
    },
  });
}

export function useVendorAcceptOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { id: string; estimatedPrepMinutes?: number }) => {
      const { data, error } = await (supabase as any).rpc("vendor_accept_order", {
        _order_id: v.id,
        _estimated_prep_minutes: v.estimatedPrepMinutes ?? 20,
      });
      if (error) {
        if (
          error.code === "PGRST202" ||
          error.message?.includes("Could not find the function") ||
          error.message?.includes("schema cache")
        ) {
          const { data: advData, error: advError } = await (supabase as any).rpc(
            "advance_seller_order",
            { _order_id: v.id },
          );
          if (advError) throw advError;
          return advData;
        }
        throw error;
      }
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-orders"] });
      qc.invalidateQueries({ queryKey: ["my-notifications"] });
    },
  });
}

export function useVendorRejectOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { id: string; reason?: string }) => {
      const { data, error } = await (supabase as any).rpc("vendor_reject_order", {
        _order_id: v.id,
        _reason: v.reason ?? "Cancelled by vendor",
      });
      if (error) {
        if (
          error.code === "PGRST202" ||
          error.message?.includes("Could not find the function") ||
          error.message?.includes("schema cache")
        ) {
          const { data: cancelData, error: cancelError } = await (supabase as any).rpc(
            "cancel_seller_order",
            { _order_id: v.id, _reason: v.reason ?? "Cancelled by vendor" },
          );
          if (cancelError) throw cancelError;
          return cancelData;
        }
        throw error;
      }
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-orders"] });
      qc.invalidateQueries({ queryKey: ["my-notifications"] });
    },
  });
}

export function useVendorMarkReady() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { id: string }) => {
      const { data, error } = await (supabase as any).rpc("vendor_mark_ready_for_pickup", {
        _order_id: v.id,
      });
      if (error) {
        if (
          error.code === "PGRST202" ||
          error.message?.includes("Could not find the function") ||
          error.message?.includes("schema cache")
        ) {
          const { data: advData, error: advError } = await (supabase as any).rpc(
            "advance_seller_order",
            { _order_id: v.id },
          );
          if (advError) throw advError;
          return {
            success: true,
            status: advData?.status ?? "ready_for_pickup",
            dispatched_count: advData?.dispatched ?? 0,
            dispatch_error: null,
          };
        }
        throw error;
      }
      return data as {
        success: boolean;
        status: string;
        dispatched_count: number;
        dispatch_error?: string | null;
      };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-orders"] });
      qc.invalidateQueries({ queryKey: ["my-notifications"] });
    },
  });
}

export function useVendorUpdateLiveLocation() {
  return useMutation({
    mutationFn: async (v: {
      id: string;
      lat: number;
      lng: number;
      heading?: number;
      speed?: number;
      accuracy?: number;
    }) => {
      const { data, error } = await (supabase as any).rpc("update_vendor_live_location", {
        _order_id: v.id,
        _lat: v.lat,
        _lng: v.lng,
        _heading: v.heading ?? null,
        _speed: v.speed ?? null,
        _accuracy: v.accuracy ?? null,
      });
      if (error) {
        throw error;
      }
      return data;
    },
  });
}

export function useVendorStopLiveLocation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { id: string }) => {
      const { data, error } = await (supabase as any).rpc("stop_vendor_live_location", {
        _order_id: v.id,
      });
      if (error) {
        throw error;
      }
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-orders"] });
    },
  });
}
