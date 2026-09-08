/* Admin-only data hooks for marketplace tables. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/* ---------- Types ---------- */
export interface Category {
  id: string;
  parent_id: string | null;
  name: string;
  slug: string;
  description: string | null;
  image_url: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}
export interface Brand {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}
export interface Coupon {
  id: string;
  code: string;
  description: string | null;
  discount_type: "percent" | "flat" | "free_shipping";
  discount_value: number;
  min_order: number;
  max_discount: number | null;
  usage_limit: number | null;
  used_count: number;
  starts_at: string | null;
  expires_at: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}
export interface Banner {
  id: string;
  title: string;
  subtitle: string | null;
  image_url: string;
  link_url: string | null;
  placement: "hero" | "featured_category" | "featured_product" | "promo";
  sort_order: number;
  is_active: boolean;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
  updated_at: string;
}
export interface Review {
  id: string;
  product_id: string | null;
  user_id: string | null;
  rating: number;
  title: string | null;
  body: string | null;
  status: "pending" | "approved" | "hidden" | "reported";
  reported_count: number;
  created_at: string;
  updated_at: string;
}
export interface SupportTicket {
  id: string;
  user_id: string | null;
  raised_by: "customer" | "vendor";
  subject: string;
  body: string;
  priority: "low" | "normal" | "high" | "urgent";
  status: "open" | "pending" | "resolved" | "closed";
  assigned_to: string | null;
  order_id?: string | null;
  issue_type?: string | null;
  support_stage?: string;
  selected_product_ids?: string[];
  evidence_urls?: string[];
  video_url?: string | null;
  customer_comment?: string | null;
  eligible?: boolean;
  eligibility_reason?: string | null;
  decision?: string | null;
  refund_amount?: number | null;
  replacement_approved?: boolean;
  reporting_deadline?: string | null;
  resolved_at?: string | null;
  created_at: string;
  updated_at: string;
}
export interface AdminBroadcast {
  id: string;
  title: string;
  body: string;
  channel: "in_app" | "email" | "push";
  audience: "all_users" | "all_vendors" | "selected_users" | "selected_vendors";
  target_ids: string[];
  sent_by: string | null;
  sent_at: string;
  recipient_count: number;
}
export interface PlatformSettings {
  id: number;
  marketplace_name: string;
  logo_url: string | null;
  commission_percent: number;
  shipping_flat: number;
  tax_percent: number;
  return_policy: string | null;
  privacy_policy: string | null;
  terms_conditions: string | null;
  payment_gateway: string;
  updated_at: string;
}
export interface FlashSale {
  id: string;
  title: string;
  discount_type: "percent" | "flat";
  discount_value: number;
  starts_at: string;
  ends_at: string;
  is_active: boolean;
}
export interface Collection {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  image_url: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  is_active: boolean;
  display_order: number;
}

/* ---------- Generic helpers ---------- */
function useList<T>(table: string, order = "created_at", ascending = false) {
  return useQuery<T[]>({
    queryKey: [table, "list", order, ascending],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from(table)
        .select("*")
        .order(order, { ascending });
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
      const { data, error } = await (supabase as any)
        .from("categories")
        .upsert(c)
        .select()
        .single();
      if (error) throw error;
      return data;
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
      if (error) throw error;
      return data;
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
    mutationFn: async (
      c: Partial<Coupon> & {
        code: string;
        discount_type: Coupon["discount_type"];
        discount_value: number;
      },
    ) => {
      const { data, error } = await (supabase as any).from("coupons").upsert(c).select().single();
      if (error) throw error;
      return data;
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

export const useFlashSales = () => useList<FlashSale>("flash_sales");
export function useUpsertFlashSale() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      sale: Partial<FlashSale> & {
        title: string;
        starts_at: string;
        ends_at: string;
        product_ids?: string[];
      },
    ) => {
      const { product_ids, ...saleData } = sale;
      const { data, error } = await (supabase as any)
        .from("flash_sales")
        .upsert(saleData)
        .select()
        .single();
      if (error) throw error;
      if (product_ids) {
        await (supabase as any).from("flash_sale_products").delete().eq("flash_sale_id", data.id);
        if (product_ids.length) {
          const { error: relationError } = await (supabase as any)
            .from("flash_sale_products")
            .insert(product_ids.map((product_id) => ({ flash_sale_id: data.id, product_id })));
          if (relationError) throw relationError;
        }
      }
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["flash_sales"] }),
  });
}
export const useGiftCollections = () => useList<Collection>("gift_collections");
export const useSeasonalCollections = () => useList<Collection>("seasonal_collections");
export function useUpsertCollection(table: "gift_collections" | "seasonal_collections") {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (collection: Partial<Collection> & { name: string; slug: string }) => {
      const { data, error } = await (supabase as any)
        .from(table)
        .upsert(collection)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [table] }),
  });
}
export function useFeatureBrand() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      brand_id,
      display_order,
    }: {
      brand_id: string;
      display_order: number;
    }) => {
      const { error } = await (supabase as any)
        .from("featured_brands")
        .upsert({ brand_id, display_order });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["featured_brands"] }),
  });
}
export function useUnfeatureBrand() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (brand_id: string) => {
      const { error } = await (supabase as any)
        .from("featured_brands")
        .delete()
        .eq("brand_id", brand_id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["featured_brands"] }),
  });
}
export function useSetProductClearance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, clearance }: { id: string; clearance: boolean }) => {
      const { error } = await (supabase as any).from("products").update({ clearance }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["products"] }),
  });
}

/* ---------- BANNERS ---------- */
export interface AppDownloadBannerConfig {
  is_active: boolean;
  badge1_text: string;
  badge2_text: string;
  headline_prefix: string;
  headline_highlight: string;
  headline_suffix: string;
  description: string;
  button_text: string;
  google_play_rating: string;
  google_play_downloads: string;
  app_store_rating: string;
  app_store_downloads: string;
  qr_label: string;
}

export const DEFAULT_APP_BANNER_CONFIG: AppDownloadBannerConfig = {
  is_active: true,
  badge1_text: "Special App Offer",
  badge2_text: "Exclusive Deals",
  headline_prefix: "Grab ",
  headline_highlight: "10% OFF",
  headline_suffix: " now",
  description:
    "Download the LocalShore App to unlock instant local shop discounts, 15-minute express delivery, and live order GPS tracking!",
  button_text: "Get App Link",
  google_play_rating: "4.8",
  google_play_downloads: "50 Lakh+",
  app_store_rating: "4.9",
  app_store_downloads: "10 Lakh+",
  qr_label: "SCAN TO DOWNLOAD",
};

export const APP_BANNER_CONFIG_KEY = "localshore_app_download_banner_config";

export function getAppBannerConfig(): AppDownloadBannerConfig {
  try {
    const raw = localStorage.getItem(APP_BANNER_CONFIG_KEY);
    if (raw) return { ...DEFAULT_APP_BANNER_CONFIG, ...JSON.parse(raw) };
  } catch {}
  return DEFAULT_APP_BANNER_CONFIG;
}

export function useAppBannerConfig() {
  return useQuery<AppDownloadBannerConfig>({
    queryKey: ["app_download_banner_config"],
    queryFn: async () => {
      try {
        const { data } = await (supabase as any)
          .from("banners")
          .select("*")
          .eq("id", "app-download-banner-global-config")
          .maybeSingle();
        if (data && data.image_url) {
          const parsed = JSON.parse(data.image_url);
          const merged = { ...DEFAULT_APP_BANNER_CONFIG, ...parsed, is_active: data.is_active ?? true };
          localStorage.setItem(APP_BANNER_CONFIG_KEY, JSON.stringify(merged));
          return merged;
        }
      } catch {}
      return getAppBannerConfig();
    },
    staleTime: 5000,
  });
}

export function useSaveAppBannerConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (config: AppDownloadBannerConfig) => {
      localStorage.setItem(APP_BANNER_CONFIG_KEY, JSON.stringify(config));
      window.dispatchEvent(new Event("localshore_banner_updated"));

      try {
        await (supabase as any).from("banners").upsert({
          id: "app-download-banner-global-config",
          title: config.headline_prefix + config.headline_highlight + config.headline_suffix,
          subtitle: config.description,
          image_url: JSON.stringify(config),
          placement: "promo",
          is_active: config.is_active,
          sort_order: 99,
        });
      } catch (err) {
        console.warn("Supabase app banner config save warning:", err);
      }

      return config;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["app_download_banner_config"] });
    },
  });
}

const LOCAL_BANNERS_KEY = "localshore_admin_banners";

function getLocalBanners(): Banner[] {
  try {
    const raw = localStorage.getItem(LOCAL_BANNERS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return [];
}

function saveLocalBanner(banner: Banner) {
  try {
    const current = getLocalBanners();
    const idx = current.findIndex((b) => b.id === banner.id);
    if (idx >= 0) {
      current[idx] = banner;
    } else {
      current.unshift(banner);
    }
    localStorage.setItem(LOCAL_BANNERS_KEY, JSON.stringify(current));
  } catch {}
}

function deleteLocalBanner(id: string) {
  try {
    const current = getLocalBanners().filter((b) => b.id !== id);
    localStorage.setItem(LOCAL_BANNERS_KEY, JSON.stringify(current));
  } catch {}
}

export const useBanners = () => {
  return useQuery<Banner[]>({
    queryKey: ["banners", "list"],
    queryFn: async () => {
      try {
        const { data, error } = await (supabase as any)
          .from("banners")
          .select("*")
          .order("sort_order", { ascending: true });
        if (!error && data) {
          localStorage.setItem(LOCAL_BANNERS_KEY, JSON.stringify(data));
          return data as Banner[];
        }
      } catch (err) {
        console.warn("Supabase banners fetch failed, fallback to local storage:", err);
      }
      return getLocalBanners();
    },
    staleTime: 5_000,
    refetchInterval: 5_000,
  });
};

export function useUpsertBanner() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (b: Partial<Banner> & { title: string; image_url: string }) => {
      const now = new Date().toISOString();
      const bannerData: Banner = {
        id: b.id || crypto.randomUUID(),
        title: b.title.trim(),
        subtitle: b.subtitle?.trim() || null,
        image_url: b.image_url.trim(),
        link_url: b.link_url?.trim() || null,
        placement: (b.placement as any) || "hero",
        sort_order: Number(b.sort_order ?? 0),
        is_active: b.is_active ?? true,
        starts_at: b.starts_at || null,
        ends_at: b.ends_at || null,
        created_at: b.created_at || now,
        updated_at: now,
      };

      try {
        const { data, error } = await (supabase as any)
          .from("banners")
          .upsert(bannerData)
          .select()
          .single();
        if (!error && data) {
          saveLocalBanner(data as Banner);
          return data as Banner;
        }
        if (error) console.warn("Supabase banner upsert warning:", error);
      } catch (err) {
        console.warn("Supabase banner upsert failed:", err);
      }

      saveLocalBanner(bannerData);
      return bannerData;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["banners"] });
      qc.invalidateQueries({ queryKey: ["homepage-banners"] });
    },
  });
}

export function useDeleteBanner() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      try {
        const { error } = await (supabase as any).from("banners").delete().eq("id", id);
        if (error) console.warn("Supabase banner delete error:", error);
      } catch (err) {
        console.warn("Supabase banner delete failed:", err);
      }
      deleteLocalBanner(id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["banners"] });
      qc.invalidateQueries({ queryKey: ["homepage-banners"] });
    },
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
const LOCAL_BROADCASTS_KEY = "localshore_admin_broadcasts";

function getLocalBroadcasts(): AdminBroadcast[] {
  try {
    const raw = localStorage.getItem(LOCAL_BROADCASTS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return [];
}

function saveLocalBroadcast(b: AdminBroadcast) {
  try {
    const current = getLocalBroadcasts();
    current.unshift(b);
    localStorage.setItem(LOCAL_BROADCASTS_KEY, JSON.stringify(current));
  } catch {}
}

export const useBroadcasts = () => {
  return useQuery<AdminBroadcast[]>({
    queryKey: ["admin_broadcasts", "list"],
    queryFn: async () => {
      try {
        const { data, error } = await (supabase as any)
          .from("admin_broadcasts")
          .select("*")
          .order("sent_at", { ascending: false });
        if (!error && data) {
          localStorage.setItem(LOCAL_BROADCASTS_KEY, JSON.stringify(data));
          return data as AdminBroadcast[];
        }
      } catch {}
      return getLocalBroadcasts();
    },
  });
};

export function useSendBroadcast() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      b: Omit<AdminBroadcast, "id" | "sent_at" | "sent_by" | "recipient_count"> & {
        recipient_count?: number;
      },
    ) => {
      let userId: string | null = null;
      try {
        const { data } = await supabase.auth.getUser();
        userId = data?.user?.id ?? null;
      } catch {}

      const broadcastData: AdminBroadcast = {
        id: crypto.randomUUID(),
        title: b.title.trim(),
        body: b.body.trim(),
        channel: b.channel,
        audience: b.audience,
        target_ids: b.target_ids ?? [],
        sent_by: userId,
        sent_at: new Date().toISOString(),
        recipient_count: b.recipient_count ?? 1,
      };

      try {
        const { error } = await (supabase as any)
          .from("admin_broadcasts")
          .insert({
            title: broadcastData.title,
            body: broadcastData.body,
            channel: broadcastData.channel,
            audience: broadcastData.audience,
            target_ids: broadcastData.target_ids,
            sent_by: broadcastData.sent_by,
            recipient_count: broadcastData.recipient_count,
          });
        if (error) console.warn("Supabase broadcast warning:", error);
      } catch (e) {
        console.warn("Supabase broadcast error:", e);
      }

      saveLocalBroadcast(broadcastData);
      return broadcastData;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin_broadcasts"] }),
  });
}

/* ---------- SETTINGS ---------- */
export function usePlatformSettings() {
  return useQuery<PlatformSettings | null>({
    queryKey: ["platform_settings"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("platform_settings")
        .select("*")
        .eq("id", 1)
        .maybeSingle();
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
  id: string;
  email: string | null;
  display_name: string | null;
  created_at: string;
  is_blocked?: boolean;
}
export function useAdminUsers() {
  return useQuery<AdminUserRow[]>({
    queryKey: ["admin_users"],
    queryFn: async () => {
      const [{ data: profiles, error: pe }, { data: blocks }] = await Promise.all([
        (supabase as any)
          .from("profiles")
          .select("id, email, display_name, created_at")
          .order("created_at", { ascending: false }),
        (supabase as any).from("user_status").select("user_id, is_blocked"),
      ]);
      if (pe) throw pe;
      const map = new Map<string, boolean>(
        (blocks ?? []).map((b: any) => [b.user_id, b.is_blocked]),
      );
      return (profiles ?? []).map((p: any) => ({ ...p, is_blocked: map.get(p.id) ?? false }));
    },
  });
}
export function useSetUserBlocked() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      userId,
      blocked,
      reason,
    }: {
      userId: string;
      blocked: boolean;
      reason?: string;
    }) => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { error } = await (supabase as any).from("user_status").upsert({
        user_id: userId,
        is_blocked: blocked,
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
        (supabase as any)
          .from("sellers")
          .select("id, status, created_at, reviewed_at, business_name, full_name, email"),
        (supabase as any)
          .from("products")
          .select("id, status, stock, category, name, selling_price, created_at"),
        (supabase as any)
          .from("orders")
          .select("id, total, status, created_at, buyer_name, seller_id"),
        (supabase as any)
          .from("orders")
          .select("id", { count: "exact", head: true })
          .gte("created_at", new Date(new Date().setHours(0, 0, 0, 0)).toISOString()),
      ]);
      const rawSellers = (sellers.data ?? []) as Array<any>;
      return {
        totalUsers: users.count ?? 0,
        sellers: rawSellers.map((s) => ({
          id: s.id,
          status: s.status,
          created_at: s.created_at,
          submitted_at: s.reviewed_at ?? null,
          shop_name: s.business_name ?? null,
          owner_name: s.full_name ?? s.email ?? null,
        })) as Array<{
          id: string;
          status: string;
          created_at: string;
          submitted_at: string | null;
          shop_name: string | null;
          owner_name: string | null;
        }>,
        products: (products.data ?? []) as Array<{
          id: string;
          status: string;
          stock: number;
          category: string | null;
          name: string;
          selling_price: number;
          created_at: string;
        }>,
        orders: (orders.data ?? []) as Array<{
          id: string;
          total: number;
          status: string;
          created_at: string;
          buyer_name: string | null;
          seller_id: string;
        }>,
        todayOrders: todayOrders.count ?? 0,
      };
    },
  });
}
