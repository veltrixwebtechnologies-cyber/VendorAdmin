/* Admin-only data hooks for marketplace tables. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/* ---------- Types ---------- */
export interface Category {
  id: string; parent_id: string | null; name: string; slug: string;
  description: string | null; image_url: string | null; sort_order: number;
  is_active: boolean; created_at: string; updated_at: string;
}
export interface Brand {
  id: string; name: string; slug: string; logo_url: string | null;
  is_active: boolean; created_at: string; updated_at: string;
}
export interface Coupon {
  id: string; code: string; description: string | null;
  discount_type: "percent" | "flat" | "free_shipping"; discount_value: number;
  min_order: number; max_discount: number | null; usage_limit: number | null;
  used_count: number; starts_at: string | null; expires_at: string | null;
  is_active: boolean; created_at: string; updated_at: string;
}
export interface Banner {
  id: string; title: string; subtitle: string | null; image_url: string;
  link_url: string | null; placement: "hero"|"featured_category"|"featured_product"|"promo";
  sort_order: number; is_active: boolean; starts_at: string | null;
  ends_at: string | null; created_at: string; updated_at: string;
}
export interface Review {
  id: string; product_id: string | null; user_id: string | null; rating: number;
  title: string | null; body: string | null;
  status: "pending"|"approved"|"hidden"|"reported"; reported_count: number;
  created_at: string; updated_at: string;
}
export interface SupportTicket {
  id: string; user_id: string | null; raised_by: "customer"|"vendor";
  subject: string; body: string; priority: "low"|"normal"|"high"|"urgent";
  status: "open"|"pending"|"resolved"|"closed"; assigned_to: string | null;
  created_at: string; updated_at: string;
}
export interface AdminBroadcast {
  id: string; title: string; body: string;
  channel: "in_app"|"email"|"push";
  audience: "all_users"|"all_vendors"|"selected_users"|"selected_vendors";
  target_ids: string[]; sent_by: string | null; sent_at: string; recipient_count: number;
}
export interface PlatformSettings {
  id: number; marketplace_name: string; logo_url: string | null;
  commission_percent: number; shipping_flat: number; tax_percent: number;
  return_policy: string | null; privacy_policy: string | null;
  terms_conditions: string | null; payment_gateway: string; updated_at: string;
}

/* ---------- Generic helpers ---------- */
function useList<T>(table: string, order = "created_at", ascending = false) {
  return useQuery<T[]>({
    queryKey: [table, "list", order, ascending],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from(table).select("*").order(order, { ascending });
      if (error) throw error;
      return (data ?? []) as T[];
    },
  });
}

/* ---------- CATEGORIES ---------- */
export const useCategories = () => useList<Category>("categories", "sort_order", true);
export function useUpsertCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (c: Partial<Category> & { name: string; slug: string }) => {
      const { data, error } = await (supabase as any).from("categories").upsert(c).select().single();
      if (error) throw error; return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["categories"] }),
  });
}
export function useDeleteCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("categories").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["categories"] }),
  });
}

/* ---------- BRANDS ---------- */
export const useBrands = () => useList<Brand>("brands", "name", true);
export function useUpsertBrand() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (b: Partial<Brand> & { name: string; slug: string }) => {
      const { data, error } = await (supabase as any).from("brands").upsert(b).select().single();
      if (error) throw error; return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["brands"] }),
  });
}
export function useDeleteBrand() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("brands").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["brands"] }),
  });
}

/* ---------- COUPONS ---------- */
export const useCoupons = () => useList<Coupon>("coupons");
export function useUpsertCoupon() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (c: Partial<Coupon> & { code: string; discount_type: Coupon["discount_type"]; discount_value: number }) => {
      const { data, error } = await (supabase as any).from("coupons").upsert(c).select().single();
      if (error) throw error; return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["coupons"] }),
  });
}
export function useDeleteCoupon() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("coupons").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["coupons"] }),
  });
}

/* ---------- BANNERS ---------- */
export const useBanners = () => useList<Banner>("banners", "sort_order", true);
export function useUpsertBanner() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (b: Partial<Banner> & { title: string; image_url: string }) => {
      const { data, error } = await (supabase as any).from("banners").upsert(b).select().single();
      if (error) throw error; return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["banners"] }),
  });
}
export function useDeleteBanner() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("banners").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["banners"] }),
  });
}

/* ---------- REVIEWS ---------- */
export const useAdminReviews = () => useList<Review>("reviews");
export function useModerateReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: Review["status"] }) => {
      const { error } = await (supabase as any).from("reviews").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["reviews"] }),
  });
}
export function useDeleteReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("reviews").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["reviews"] }),
  });
}

/* ---------- SUPPORT TICKETS ---------- */
export const useAdminTickets = () => useList<SupportTicket>("support_tickets");
export function useUpdateTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...patch }: Partial<SupportTicket> & { id: string }) => {
      const { error } = await (supabase as any).from("support_tickets").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["support_tickets"] }),
  });
}

/* ---------- BROADCASTS ---------- */
export const useBroadcasts = () => useList<AdminBroadcast>("admin_broadcasts", "sent_at");
export function useSendBroadcast() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (b: Omit<AdminBroadcast, "id"|"sent_at"|"sent_by"|"recipient_count"> & { recipient_count?: number }) => {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await (supabase as any).from("admin_broadcasts").insert({ ...b, sent_by: user?.id });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin_broadcasts"] }),
  });
}

/* ---------- SETTINGS ---------- */
export function usePlatformSettings() {
  return useQuery<PlatformSettings | null>({
    queryKey: ["platform_settings"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("platform_settings").select("*").eq("id", 1).maybeSingle();
      if (error) throw error;
      return (data ?? null) as PlatformSettings | null;
    },
  });
}
export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<PlatformSettings>) => {
      const { error } = await (supabase as any).from("platform_settings").update(patch).eq("id", 1);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["platform_settings"] }),
  });
}

/* ---------- USER LIST + BLOCK ---------- */
export interface AdminUserRow {
  id: string; email: string | null; display_name: string | null; created_at: string;
  is_blocked?: boolean;
}
export function useAdminUsers() {
  return useQuery<AdminUserRow[]>({
    queryKey: ["admin_users"],
    queryFn: async () => {
      const [{ data: profiles, error: pe }, { data: blocks }] = await Promise.all([
        (supabase as any).from("profiles").select("id, email, display_name, created_at").order("created_at", { ascending: false }),
        (supabase as any).from("user_status").select("user_id, is_blocked"),
      ]);
      if (pe) throw pe;
      const map = new Map<string, boolean>((blocks ?? []).map((b: any) => [b.user_id, b.is_blocked]));
      return (profiles ?? []).map((p: any) => ({ ...p, is_blocked: map.get(p.id) ?? false }));
    },
  });
}
export function useSetUserBlocked() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, blocked, reason }: { userId: string; blocked: boolean; reason?: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await (supabase as any).from("user_status").upsert({
        user_id: userId, is_blocked: blocked,
        reason: blocked ? (reason ?? null) : null,
        blocked_at: blocked ? new Date().toISOString() : null,
        blocked_by: blocked ? user?.id : null,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin_users"] }),
  });
}

/* ---------- Admin platform overview ---------- */
export function useAdminOverview() {
  return useQuery({
    queryKey: ["admin_overview"],
    queryFn: async () => {
      const [users, sellers, products, orders, todayOrders] = await Promise.all([
        (supabase as any).from("profiles").select("id", { count: "exact", head: true }),
        (supabase as any).from("sellers").select("id, status, created_at, reviewed_at, business_name, full_name, email"),
        (supabase as any).from("products").select("id, status, stock, category, name, selling_price, created_at"),
        (supabase as any).from("orders").select("id, total, status, created_at, buyer_name, seller_id"),
        (supabase as any).from("orders").select("id", { count: "exact", head: true })
          .gte("created_at", new Date(new Date().setHours(0,0,0,0)).toISOString()),
      ]);
      const rawSellers = (sellers.data ?? []) as Array<any>;
      return {
        totalUsers: users.count ?? 0,
        sellers: rawSellers.map(s => ({
          id: s.id, status: s.status, created_at: s.created_at,
          submitted_at: s.reviewed_at ?? null,
          shop_name: s.business_name ?? null,
          owner_name: s.full_name ?? s.email ?? null,
        })) as Array<{ id: string; status: string; created_at: string; submitted_at: string | null; shop_name: string | null; owner_name: string | null }>,
        products: (products.data ?? []) as Array<{ id: string; status: string; stock: number; category: string | null; name: string; selling_price: number; created_at: string }>,
        orders: (orders.data ?? []) as Array<{ id: string; total: number; status: string; created_at: string; buyer_name: string | null; seller_id: string }>,
        todayOrders: todayOrders.count ?? 0,
      };
    },
  });
}
