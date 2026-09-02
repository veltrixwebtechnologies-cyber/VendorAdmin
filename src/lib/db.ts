/* ============================================================
 * Central Supabase data layer for Seller Hub.
 * All CRUD hooks + mutations live here, backed by RLS.
 * ============================================================ */
import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

/* ------------ Types ------------ */

export type SellerStatus = "draft" | "pending" | "approved" | "rejected" | "more_info";
export type OrderStatus =
  | "new"
  | "accepted"
  | "preparing"
  | "packed"
  | "ready_for_pickup"
  | "assigned"
  | "rider_assigned"
  | "rider_accepted"
  | "rider_at_shop"
  | "picked_up"
  | "out_for_delivery"
  | "at_customer"
  | "shipped"
  | "delivered"
  | "cancelled"
  | "returned"
  | "assignment_failed"
  | "delivery_failed";
export type BusinessType =
  "" | "Individual" | "Sole Proprietorship" | "Partnership" | "Private Limited";

export interface StoredFile {
  name: string;
  size: number;
  type: string;
  dataUrl?: string;
  path?: string;
  url?: string;
}

export interface SellerDocuments {
  panCard?: StoredFile;
  govId?: StoredFile;
  gstCertificate?: StoredFile;
  bankProof?: StoredFile;
  shopLogo?: StoredFile;
  shopBanner?: StoredFile;
}

export interface Seller {
  id: string;
  userId: string;
  createdAt: string;
  submittedAt?: string;
  status: SellerStatus;
  reviewNote?: string;
  account: {
    fullName: string;
    mobile: string;
    email: string;
    emailVerified: boolean;
    mobileVerified: boolean;
  };
  business: {
    shopName: string;
    ownerName: string;
    businessType: BusinessType;
    category: string;
    description: string;
  };
  address: {
    shopAddress: string;
    city: string;
    state: string;
    pincode: string;
    landmark: string;
    pickupSame: boolean;
    pickupAddress: string;
    pickupCity: string;
    pickupState: string;
    pickupPincode: string;
  };
  bank: {
    holderName: string;
    bankName: string;
    accountNumber: string;
    ifsc: string;
    upi: string;
  };
  tax: {
    pan: string;
    gst: string;
    businessRegNumber: string;
  };
  documents: SellerDocuments;
}

export interface OrderItem {
  id: string;
  productId: string | null;
  name: string;
  sku: string;
  qty: number;
  price: number;
}

export interface Order {
  id: string;
  orderNumber: string;
  sellerId: string;
  status: OrderStatus;
  buyerName: string;
  buyerPhone: string;
  buyerAddress: string;
  city: string;
  state: string;
  pincode: string;
  subtotal: number;
  shipping: number;
  total: number;
  paymentMode: "Prepaid" | "COD";
  awb?: string;
  courier?: string;
  createdAt: string;
  updatedAt: string;
  deliveredAt?: string;
  items: OrderItem[];
  assignedPartner?: DeliveryPartnerInfo;
  deliveryAssignment?: DeliveryAssignmentInfo;
}

export interface Notification {
  id: string;
  title: string;
  body: string;
  kind: string;
  link?: string;
  readAt: string | null;
  createdAt: string;
}

export interface Settlement {
  id: string;
  cycleStart: string;
  cycleEnd: string;
  gross: number;
  commission: number;
  gstOnFees: number;
  net: number;
  status: "pending" | "processing" | "paid";
  paidAt?: string;
  utr?: string;
}

export function getDataErrorMessage(error: unknown, fallback = "Please try again.") {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object") {
    const value = error as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown };
    const message = typeof value.message === "string" ? value.message : "";
    const details = typeof value.details === "string" ? value.details : "";
    const hint = typeof value.hint === "string" ? value.hint : "";
    const context = [details, hint].filter(Boolean).join(" ");
    if (message || context) return [message, context].filter(Boolean).join(" ");
    if (typeof value.code === "string") return `Database request failed (${value.code}).`;
  }
  return fallback;
}

/* ------------ Mappers ------------ */

function rowToSeller(r: any): Seller {
  const w: Record<string, any> =
    r.wizard_data && typeof r.wizard_data === "object" && !Array.isArray(r.wizard_data)
      ? r.wizard_data
      : {};
  return {
    id: r.id,
    userId: r.user_id,
    createdAt: r.created_at,
    submittedAt: w.submittedAt,
    status: r.status,
    reviewNote: r.admin_notes ?? undefined,
    account: {
      fullName: r.full_name ?? "",
      mobile: r.phone ?? "",
      email: r.email ?? "",
      emailVerified: !!w.emailVerified,
      mobileVerified: !!w.mobileVerified,
    },
    business: {
      shopName: r.business_name ?? "",
      ownerName: w.ownerName ?? "",
      businessType: (r.business_type ?? "") as BusinessType,
      category: w.category ?? "",
      description: w.description ?? "",
    },
    address: {
      shopAddress: r.address_line1 ?? "",
      city: r.city ?? "",
      state: r.state ?? "",
      pincode: r.pincode ?? "",
      landmark: r.address_line2 ?? "",
      pickupSame: w.pickupSame ?? true,
      pickupAddress: w.pickupAddress ?? "",
      pickupCity: w.pickupCity ?? "",
      pickupState: w.pickupState ?? "",
      pickupPincode: w.pickupPincode ?? "",
    },
    bank: {
      holderName: r.bank_account_name ?? "",
      bankName: r.bank_name ?? "",
      accountNumber: r.bank_account_number ?? "",
      ifsc: r.bank_ifsc ?? "",
      upi: w.upi ?? "",
    },
    tax: {
      pan: r.pan ?? "",
      gst: r.gstin ?? "",
      businessRegNumber: w.businessRegNumber ?? "",
    },
    documents: w.documents ?? {},
  };
}

/** Convert a client-side Partial<Seller> to a DB update patch. */
function sellerPatchToDb(patch: Partial<Seller>, existingWizard: Record<string, any> = {}) {
  const db: Record<string, any> = {};
  const w: Record<string, any> = { ...existingWizard };

  if (patch.account) {
    db.full_name = patch.account.fullName;
    db.phone = patch.account.mobile;
    db.email = patch.account.email;
    w.emailVerified = patch.account.emailVerified;
    w.mobileVerified = patch.account.mobileVerified;
  }
  if (patch.business) {
    db.business_name = patch.business.shopName;
    db.business_type = patch.business.businessType || null;
    w.ownerName = patch.business.ownerName;
    w.category = patch.business.category;
    w.description = patch.business.description;
  }
  if (patch.address) {
    db.address_line1 = patch.address.shopAddress;
    db.address_line2 = patch.address.landmark;
    db.city = patch.address.city;
    db.state = patch.address.state;
    db.pincode = patch.address.pincode;
    w.pickupSame = patch.address.pickupSame;
    w.pickupAddress = patch.address.pickupAddress;
    w.pickupCity = patch.address.pickupCity;
    w.pickupState = patch.address.pickupState;
    w.pickupPincode = patch.address.pickupPincode;
  }
  if (patch.bank) {
    db.bank_account_name = patch.bank.holderName;
    db.bank_name = patch.bank.bankName;
    db.bank_account_number = patch.bank.accountNumber;
    db.bank_ifsc = patch.bank.ifsc;
    w.upi = patch.bank.upi;
  }
  if (patch.tax) {
    db.pan = patch.tax.pan;
    db.gstin = patch.tax.gst;
    w.businessRegNumber = patch.tax.businessRegNumber;
  }
  if (patch.documents !== undefined) {
    w.documents = patch.documents;
  }
  if (patch.status) db.status = patch.status;
  if (patch.reviewNote !== undefined) db.admin_notes = patch.reviewNote;
  db.wizard_data = w;
  return db;
}

export interface DeliveryPartnerInfo {
  id: string;
  fullName: string;
  mobile: string;
  status: string;
  availability: string;
  rating?: number;
  vehicleType?: string;
  vehicleNumber?: string;
}

export interface DeliveryAssignmentInfo {
  id: string;
  status: string;
  distanceKm?: number;
  estimatedEarning?: number;
  expiresAt?: string;
  respondedAt?: string;
  partner?: DeliveryPartnerInfo;
}

function rowToOrder(r: any, items: any[]): Order {
  const w = r.buyer_address ?? "";
  // buyer_address stores "address, city, state - pincode" (we set it that way when seeding).
  // Best-effort parse for display.
  const [addr = "", rest = ""] =
    w.split(",").length > 1
      ? [w.split(",").slice(0, -2).join(","), w.split(",").slice(-2).join(",")]
      : [w, ""];
  const cityState = rest.split(" - ")[0]?.trim() ?? "";
  const pincode = rest.split(" - ")[1]?.trim() ?? "";
  const [city = "", state = ""] = cityState.split(",").map((s: string) => s.trim());

  const activeAssignment = Array.isArray(r.delivery_assignments)
    ? (r.delivery_assignments.find((a: any) => a.status !== "expired" && a.status !== "rejected") ?? r.delivery_assignments[0])
    : r.delivery_assignments ?? null;

  const partnerRow = r.assigned_partner ?? activeAssignment?.delivery_partners ?? null;
  const assignedPartner: DeliveryPartnerInfo | undefined = partnerRow
    ? {
        id: partnerRow.id,
        fullName: partnerRow.full_name ?? partnerRow.name ?? "Delivery Partner",
        mobile: partnerRow.mobile ?? partnerRow.phone ?? "",
        status: partnerRow.status ?? "approved",
        availability: partnerRow.availability ?? "online",
        rating: partnerRow.rating ? Number(partnerRow.rating) : 4.9,
        vehicleType: partnerRow.vehicle_type ?? "Motorbike",
        vehicleNumber: partnerRow.vehicle_number ?? "",
      }
    : undefined;

  const deliveryAssignment: DeliveryAssignmentInfo | undefined = activeAssignment
    ? {
        id: activeAssignment.id,
        status: activeAssignment.status,
        distanceKm: activeAssignment.distance_km ? Number(activeAssignment.distance_km) : undefined,
        estimatedEarning: activeAssignment.estimated_earning ? Number(activeAssignment.estimated_earning) : undefined,
        expiresAt: activeAssignment.expires_at ?? undefined,
        respondedAt: activeAssignment.responded_at ?? undefined,
        partner: assignedPartner,
      }
    : undefined;

  return {
    id: r.id,
    orderNumber: r.order_number,
    sellerId: r.seller_id,
    status: r.status,
    buyerName: r.buyer_name ?? "",
    buyerPhone: r.buyer_phone ?? "",
    buyerAddress: addr,
    city,
    state,
    pincode,
    subtotal: Number(r.subtotal),
    shipping: Number(r.shipping_fee),
    total: Number(r.total),
    paymentMode: r.payment_method === "cod" ? "COD" : "Prepaid",
    awb: r.awb_number ?? undefined,
    courier: r.courier ?? undefined,
    createdAt: r.placed_at,
    updatedAt: r.updated_at,
    deliveredAt: r.delivered_at ?? undefined,
    items: (items ?? []).map((it) => ({
      id: it.id,
      productId: it.product_id,
      name: it.product_name,
      sku: it.sku ?? "",
      qty: it.qty,
      price: Number(it.unit_price),
    })),
    assignedPartner,
    deliveryAssignment,
  };
}

/* ------------ Seller (current user) ------------ */

export function useMySeller() {
  const { user } = useAuth();
  const q = useQuery({
    queryKey: ["my-seller", user?.id],
    enabled: !!user,
    retry: false,
    queryFn: async () => {
      const request = supabase.from("sellers").select("*").eq("user_id", user!.id).maybeSingle();
      const result = await Promise.race([
        request,
        new Promise<never>((_, reject) =>
          globalThis.setTimeout(
            () =>
              reject(
                new Error(
                  "Seller profile request timed out. Check your Supabase connection and try again.",
                ),
              ),
            5_000,
          ),
        ),
      ]);
      const { data, error } = result;
      if (error) throw error;
      if (data) return rowToSeller(data);
      // Return null when seller profile does not exist or was deleted
      return null;
    },
  });
  return q;
}

export function useCreateDraftSeller() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Not signed in");
      const { data: existing } = await supabase
        .from("sellers")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();
      if (existing) return rowToSeller(existing);

      const { data: created, error } = await supabase
        .from("sellers")
        .insert({ user_id: user.id, email: user.email ?? null })
        .select("*")
        .single();
      if (error) throw error;
      return rowToSeller(created);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-seller"] });
    },
  });
}

export function useUpdateMySeller() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<Seller>) => {
      if (!user) throw new Error("Not signed in");
      // Read current wizard_data
      const { data: cur } = await supabase
        .from("sellers")
        .select("wizard_data")
        .eq("user_id", user.id)
        .maybeSingle();
      const curWizard =
        cur?.wizard_data && typeof cur.wizard_data === "object" && !Array.isArray(cur.wizard_data)
          ? (cur.wizard_data as Record<string, any>)
          : {};
      const dbPatch = sellerPatchToDb(patch, curWizard);
      const { data, error } = await supabase
        .from("sellers")
        .update(dbPatch as any)
        .eq("user_id", user.id)
        .select("*")
        .single();
      if (error) throw error;
      return rowToSeller(data);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["my-seller"] }),
  });
}

export function useSubmitMySeller() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Not signed in");
      const { data: cur } = await supabase
        .from("sellers")
        .select("wizard_data")
        .eq("user_id", user.id)
        .maybeSingle();
      const curWizard =
        cur?.wizard_data && typeof cur.wizard_data === "object" && !Array.isArray(cur.wizard_data)
          ? (cur.wizard_data as Record<string, any>)
          : {};
      const w = { ...curWizard, submittedAt: new Date().toISOString() };
      const { error } = await supabase
        .from("sellers")
        .update({ status: "pending", admin_notes: null, wizard_data: w })
        .eq("user_id", user.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["my-seller"] }),
  });
}

/* ------------ Admin: sellers ------------ */

export function useAllSellers() {
  return useQuery({
    queryKey: ["admin-sellers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sellers")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map(rowToSeller);
    },
  });
}

export function useSellerById(id: string | null | undefined) {
  return useQuery({
    queryKey: ["admin-seller", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sellers")
        .select("*")
        .eq("id", id!)
        .maybeSingle();
      if (error) throw error;
      return data ? rowToSeller(data) : null;
    },
  });
}

export function useReviewSeller() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: {
      id: string;
      action: "approve" | "reject" | "more_info";
      note?: string;
    }) => {
      const status =
        v.action === "approve" ? "approved" : v.action === "reject" ? "rejected" : "more_info";
      const { error } = await supabase
        .from("sellers")
        .update({ status, admin_notes: v.note ?? null, reviewed_at: new Date().toISOString() })
        .eq("id", v.id);
      if (error) throw error;
      // Notify seller
      const { data: seller } = await supabase
        .from("sellers")
        .select("user_id, business_name")
        .eq("id", v.id)
        .maybeSingle();
      if (seller) {
        const label =
          status === "approved"
            ? "Application approved"
            : status === "rejected"
              ? "Application rejected"
              : "More information requested";
        await supabase.from("notifications").insert({
          user_id: seller.user_id,
          title: label,
          body:
            v.note ||
            (status === "approved"
              ? "You can now list products and receive orders."
              : "Please check your registration for details."),
          kind: "status",
          link: "/seller",
        });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-sellers"] });
      qc.invalidateQueries({ queryKey: ["admin-seller"] });
    },
  });
}

export function useDeleteSeller() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (sellerId: string) => {
      // Clean up all seller child/related tables
      await supabase.from("seller_documents").delete().eq("seller_id", sellerId);
      await (supabase as any).from("shop_hours").delete().eq("seller_id", sellerId);
      await (supabase as any).from("shop_overrides").delete().eq("seller_id", sellerId);
      await (supabase as any).from("shop_holidays").delete().eq("seller_id", sellerId);
      await (supabase as any).from("shop_availability_log").delete().eq("seller_id", sellerId);
      await supabase.from("products").delete().eq("seller_id", sellerId);
      // Delete primary seller entry
      const { error } = await supabase.from("sellers").delete().eq("id", sellerId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-seller"] });
      qc.invalidateQueries({ queryKey: ["admin-sellers"] });
      qc.invalidateQueries({ queryKey: ["admin-seller"] });
      qc.invalidateQueries({ queryKey: ["shop-hours"] });
      qc.invalidateQueries({ queryKey: ["shop-status"] });
    },
  });
}

export function useDeleteMyAccount() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (sellerId: string) => {
      // Clean up seller related tables
      await supabase.from("seller_documents").delete().eq("seller_id", sellerId);
      await (supabase as any).from("shop_hours").delete().eq("seller_id", sellerId);
      await (supabase as any).from("shop_overrides").delete().eq("seller_id", sellerId);
      await (supabase as any).from("shop_holidays").delete().eq("seller_id", sellerId);
      await (supabase as any).from("shop_availability_log").delete().eq("seller_id", sellerId);
      await supabase.from("products").delete().eq("seller_id", sellerId);
      const { error } = await supabase.from("sellers").delete().eq("id", sellerId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-seller", user?.id] });
      qc.invalidateQueries({ queryKey: ["my-seller"] });
      qc.invalidateQueries({ queryKey: ["admin-sellers"] });
      qc.invalidateQueries({ queryKey: ["shop-hours"] });
      qc.invalidateQueries({ queryKey: ["shop-status"] });
    },
  });
}

/* ------------ Admin role ------------ */

export function useIsAdmin() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["is-admin", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user!.id)
        .eq("role", "admin")
        .maybeSingle();
      if (error) throw error;
      return !!data;
    },
  });
}

export function useHasAnyAdmin() {
  return useQuery({
    queryKey: ["has-any-admin"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("has_any_admin");
      if (error) throw error;
      return !!data;
    },
  });
}

export function useClaimFirstAdmin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("claim_first_admin");
      if (error) throw error;
      return !!data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["is-admin"] });
      qc.invalidateQueries({ queryKey: ["has-any-admin"] });
    },
  });
}

/* ------------ Orders ------------ */

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

      let { data, error } = await supabase
        .from("orders")
        .select("*, order_items(*), delivery_assignments(*, delivery_partners(*))")
        .eq("seller_id", seller.id)
        .order("placed_at", { ascending: false });

      if (error) {
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
    refetchInterval: 5_000,
  });

  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`seller-orders-${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => {
        void qc.invalidateQueries({ queryKey: ["my-orders", user.id] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "order_items" }, () => {
        void qc.invalidateQueries({ queryKey: ["my-orders", user.id] });
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [qc, user]);

  return query;
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

/* ------------ Product stock (uses direct supabase for simplicity) ------------ */

export function useUpdateProductStock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { id: string; stock?: number; lowStockAt?: number }) => {
      const patch: any = {};
      if (v.stock !== undefined) patch.stock = Math.max(0, Math.floor(v.stock));
      if (v.lowStockAt !== undefined)
        patch.low_stock_threshold = Math.max(0, Math.floor(v.lowStockAt));
      const { error } = await supabase.from("products").update(patch).eq("id", v.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["products"] }),
  });
}

/* ------------ Notifications ------------ */

export function useMyNotifications() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["my-notifications", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notifications")
        .select("*")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []).map<Notification>((r: any) => ({
        id: r.id,
        title: r.title,
        body: r.body ?? "",
        kind: r.kind ?? "info",
        link: r.link ?? undefined,
        readAt: r.read_at,
        createdAt: r.created_at,
      }));
    },
  });
}

export function useMarkNotificationRead() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["my-notifications", user?.id] }),
  });
}

export function useMarkAllNotificationsRead() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async () => {
      if (!user) return;
      const { error } = await supabase
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("user_id", user.id)
        .is("read_at", null);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["my-notifications", user?.id] }),
  });
}

/* ------------ Settlements (derived from delivered orders, upserted into DB) ------------ */

export const COMMISSION_RATE = 0.08;
export const GST_ON_FEES = 0.18;
export const COD_FEE = 40;

function startOfWeek(iso: string): Date {
  const d = new Date(iso);
  d.setHours(0, 0, 0, 0);
  const day = (d.getDay() + 6) % 7; // Mon = 0
  d.setDate(d.getDate() - day);
  return d;
}

export interface CycleSummary {
  cycleStart: string;
  cycleEnd: string;
  payoutDate: string;
  gross: number;
  commission: number;
  gstOnFees: number;
  codFees: number;
  net: number;
  status: "processing" | "paid";
  txns: Array<{
    orderId: string;
    orderNumber: string;
    date: string;
    gross: number;
    commission: number;
    gstOnFees: number;
    codFee: number;
    net: number;
    paymentMode: string;
  }>;
}

export function useMySettlements() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["my-settlements", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data: orders, error } = await supabase
        .from("orders")
        .select(
          "id, order_number, status, subtotal, shipping_fee, total, delivered_at, placed_at, seller_id",
        )
        .eq("user_id", user!.id)
        .eq("status", "delivered");
      if (error) throw error;

      const cycles = new Map<string, CycleSummary>();
      for (const o of orders ?? []) {
        const commission = Math.round(Number(o.subtotal) * COMMISSION_RATE);
        const codFee = Number(o.shipping_fee) > 0 ? COD_FEE : 0;
        const gstOnFees = Math.round((commission + codFee) * GST_ON_FEES);
        const net = Number(o.total) - commission - gstOnFees - codFee;
        const date = o.delivered_at ?? o.placed_at;
        const start = startOfWeek(date);
        const key = start.toISOString().slice(0, 10);
        const end = new Date(start);
        end.setDate(end.getDate() + 6);
        const payout = new Date(end);
        payout.setDate(payout.getDate() + 2);
        const cur =
          cycles.get(key) ??
          ({
            cycleStart: start.toISOString(),
            cycleEnd: end.toISOString(),
            payoutDate: payout.toISOString(),
            gross: 0,
            commission: 0,
            gstOnFees: 0,
            codFees: 0,
            net: 0,
            status: Date.now() >= payout.getTime() ? "paid" : "processing",
            txns: [],
          } as CycleSummary);
        cur.gross += Number(o.total);
        cur.commission += commission;
        cur.gstOnFees += gstOnFees;
        cur.codFees += codFee;
        cur.net += net;
        cur.txns.push({
          orderId: o.id,
          orderNumber: o.order_number,
          date,
          gross: Number(o.total),
          commission,
          gstOnFees,
          codFee,
          net,
          paymentMode: Number(o.shipping_fee) > 0 ? "COD" : "Prepaid",
        });
        cycles.set(key, cur);
      }
      const sorted = Array.from(cycles.values()).sort((a, b) =>
        a.cycleStart < b.cycleStart ? 1 : -1,
      );

      // Settlements are created by admin/backend only — sellers cannot self-issue payout records.
      return sorted;
    },
  });
}

/* ------------ Seller documents (storage) ------------ */

export async function uploadSellerDoc(
  userId: string,
  sellerId: string,
  docType: string,
  file: File,
): Promise<StoredFile> {
  if (file.size <= 0 || file.size > 10 * 1024 * 1024)
    throw new Error("Document exceeds the 10 MB limit");
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  const allowedExtensions = ["pdf", "jpg", "jpeg", "png", "webp", "heic", "heif"];
  const isAllowedExt = allowedExtensions.includes(ext);
  const isAllowedMime =
    !file.type ||
    file.type.startsWith("image/") ||
    file.type === "application/pdf" ||
    file.type === "application/octet-stream";

  if (!isAllowedExt && !isAllowedMime) {
    throw new Error("Unsupported or invalid document file. Please upload a PDF, PNG, JPG, or WEBP document.");
  }

  const path = `${userId}/${docType}-${Date.now()}.${ext}`;
  const { error } = await supabase.storage
    .from("seller-docs")
    .upload(path, file, { upsert: true, contentType: file.type });
  if (error) throw error;
  await supabase.from("seller_documents").insert({
    seller_id: sellerId,
    user_id: userId,
    doc_type: docType,
    file_name: file.name,
    file_url: path,
    file_size: file.size,
  });
  return { name: file.name, size: file.size, type: file.type, path };
}

export async function signedDocUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from("seller-docs").createSignedUrl(path, 3600);
  if (error) return null;
  return data.signedUrl;
}
