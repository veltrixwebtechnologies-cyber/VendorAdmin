import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  resolveDeliveryRadius,
  resolveStoreLocation,
  type LegacySellerLike,
  type StoreLike,
} from "@/lib/store-domain";
import {
  isMissingStoreSchema,
  type AdminStore,
  type ServiceZone,
} from "@/shared/shops/store-contracts";

export function useAdminStores(options: { products: boolean; orders: boolean }) {
  return useQuery<AdminStore[]>({
    queryKey: ["admin-stores", options],
    queryFn: async () => {
      const db = supabase as any;
      const { data: rawStores, error } = await db
        .from("stores")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      const stores = (rawStores ?? []) as StoreLike[];
      if (stores.length === 0) return [];
      const sellerIds = [...new Set(stores.map((store) => store.seller_id))];
      const [{ data: sellers }, productsResult, ordersResult, assignmentsResult] =
        await Promise.all([
          db
            .from("sellers")
            .select(
              "id,business_name,full_name,email,status,address_line1,address_line2,city,state,pincode,country,lat,lng,wizard_data",
            )
            .in("id", sellerIds),
          options.products
            ? db
                .from("products")
                .select("store_id")
                .in(
                  "store_id",
                  stores.map((s) => s.id),
                )
            : Promise.resolve({ data: null, error: null }),
          options.orders
            ? db
                .from("orders")
                .select("store_id")
                .in(
                  "store_id",
                  stores.map((s) => s.id),
                )
            : Promise.resolve({ data: null, error: null }),
          db
            .from("store_service_zones")
            .select("store_id,zone_id")
            .in(
              "store_id",
              stores.map((s) => s.id),
            ),
        ]);
      const sellerById = new Map((sellers ?? []).map((seller: any) => [seller.id, seller]));
      const productCounts = new Map<string, number>();
      const orderCounts = new Map<string, number>();
      const zoneCounts = new Map<string, number>();
      for (const row of productsResult.data ?? []) {
        if (row.store_id)
          productCounts.set(row.store_id, (productCounts.get(row.store_id) ?? 0) + 1);
      }
      for (const row of ordersResult.data ?? []) {
        if (row.store_id) orderCounts.set(row.store_id, (orderCounts.get(row.store_id) ?? 0) + 1);
      }
      for (const row of assignmentsResult.data ?? []) {
        zoneCounts.set(row.store_id, (zoneCounts.get(row.store_id) ?? 0) + 1);
      }
      return stores.map((store) => {
        const seller = sellerById.get(store.seller_id) as
          (LegacySellerLike & Record<string, any>) | undefined;
        const legacySeller = seller ?? { id: store.seller_id };
        return {
          ...(store as AdminStore),
          seller: seller ?? null,
          resolved_location: resolveStoreLocation(store, legacySeller),
          resolved_service_radius: resolveDeliveryRadius(store, legacySeller),
          product_count:
            options.products && !productsResult.error ? (productCounts.get(store.id) ?? 0) : null,
          order_count:
            options.orders && !ordersResult.error ? (orderCounts.get(store.id) ?? 0) : null,
          service_zone_count: zoneCounts.get(store.id) ?? 0,
        };
      }) as AdminStore[];
    },
    retry: (attempt, error) => !isMissingStoreSchema(error) && attempt < 2,
  });
}

export function useAdminStore(
  storeId: string | null | undefined,
  options: {
    products: boolean;
    orders: boolean;
  },
) {
  return useQuery({
    queryKey: ["admin-store", storeId, options],
    enabled: Boolean(storeId),
    queryFn: async () => {
      const db = supabase as any;
      const { data: store, error } = await db
        .from("stores")
        .select("*")
        .eq("id", storeId)
        .maybeSingle();
      if (error) throw error;
      if (!store) return null;
      const [{ data: seller }, productsResult, ordersResult, { data: schedules }] =
        await Promise.all([
          db
            .from("sellers")
            .select(
              "id,business_name,full_name,email,status,address_line1,address_line2,city,state,pincode,country,lat,lng,wizard_data",
            )
            .eq("id", store.seller_id)
            .maybeSingle(),
          options.products
            ? db
                .from("products")
                .select("id,name,sku,status,stock,selling_price,created_at")
                .eq("store_id", storeId)
                .order("created_at", { ascending: false })
                .limit(50)
            : Promise.resolve({ data: null, error: null }),
          options.orders
            ? db
                .from("orders")
                .select("id,order_number,status,total,created_at,placed_at")
                .eq("store_id", storeId)
                .order("placed_at", { ascending: false })
                .limit(50)
            : Promise.resolve({ data: null, error: null }),
          db
            .from("shop_hours")
            .select("day_of_week,is_open,open_time,close_time")
            .eq("seller_id", store.seller_id)
            .order("day_of_week"),
        ]);
      const legacySeller = (seller ?? { id: store.seller_id }) as LegacySellerLike;
      return {
        store: {
          ...store,
          seller: seller ?? null,
          resolved_location: resolveStoreLocation(store as StoreLike, legacySeller),
          resolved_service_radius: resolveDeliveryRadius(store as StoreLike, legacySeller),
        } as AdminStore,
        products: productsResult.data ?? null,
        productsError: productsResult.error ?? null,
        orders: ordersResult.data ?? null,
        ordersError: ordersResult.error ?? null,
        schedules: schedules ?? null,
      };
    },
  });
}

export function useAdminUpdateStoreLocation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      storeId: string;
      addressLine1: string;
      addressLine2: string;
      city: string;
      state: string;
      pincode: string;
      latitude: number;
      longitude: number;
      googlePlaceId: string | null;
      reason: string;
    }) => {
      const { data, error } = await (supabase as any).rpc("admin_update_store_location", {
        p_store_id: input.storeId,
        p_address_line1: input.addressLine1,
        p_address_line2: input.addressLine2 || null,
        p_city: input.city,
        p_state: input.state,
        p_pincode: input.pincode,
        p_latitude: input.latitude,
        p_longitude: input.longitude,
        p_google_place_id: input.googlePlaceId,
        p_reason: input.reason,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["admin-store"] }),
        qc.invalidateQueries({ queryKey: ["admin-stores"] }),
      ]);
    },
  });
}

export function useAdminUpdateStore() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; patch: Record<string, unknown> }) => {
      const { error } = await (supabase as any)
        .from("stores")
        .update(input.patch)
        .eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["admin-stores"] }),
        qc.invalidateQueries({ queryKey: ["admin-store"] }),
      ]);
    },
  });
}

export function useServiceZones() {
  return useQuery<ServiceZone[]>({
    queryKey: ["service-zones"],
    queryFn: async () => {
      const db = supabase as any;
      const [{ data, error }, { data: assignments, error: assignmentError }] = await Promise.all([
        db.from("delivery_zones").select("*").order("city").order("name"),
        db.from("store_service_zones").select("zone_id,store_id"),
      ]);
      if (error) throw error;
      const counts = new Map<string, number>();
      if (!assignmentError) {
        for (const row of assignments ?? [])
          counts.set(row.zone_id, (counts.get(row.zone_id) ?? 0) + 1);
      }
      return (data ?? []).map((zone: any) => ({
        ...zone,
        zone_type: zone.zone_type ?? "radius",
        updated_at: zone.updated_at ?? null,
        store_count: assignmentError ? null : (counts.get(zone.id) ?? 0),
      })) as ServiceZone[];
    },
  });
}

export function useSaveServiceZone() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id?: string;
      name: string;
      city: string;
      latitude: number;
      longitude: number;
      radiusKm: number;
      isActive: boolean;
    }) => {
      const values = {
        name: input.name.trim(),
        city: input.city.trim(),
        latitude: input.latitude,
        longitude: input.longitude,
        radius_km: input.radiusKm,
        is_active: input.isActive,
        zone_type: "radius",
      };
      const query = (supabase as any).from("delivery_zones");
      const { data, error } = input.id
        ? await query.update(values).eq("id", input.id).select("id").single()
        : await query.insert(values).select("id").single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["service-zones"] });
    },
  });
}

export function useAssignStoreZone() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { storeId: string; zoneId: string; assigned: boolean }) => {
      const db = supabase as any;
      const result = input.assigned
        ? await db
            .from("store_service_zones")
            .upsert(
              { store_id: input.storeId, zone_id: input.zoneId },
              { onConflict: "store_id,zone_id", ignoreDuplicates: true },
            )
        : await db
            .from("store_service_zones")
            .delete()
            .eq("store_id", input.storeId)
            .eq("zone_id", input.zoneId);
      if (result.error) throw result.error;
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["service-zones"] }),
        qc.invalidateQueries({ queryKey: ["admin-stores"] }),
        qc.invalidateQueries({ queryKey: ["store-service-zone-assignments"] }),
      ]);
    },
  });
}

export function useStoreZoneAssignments(zoneId: string) {
  return useQuery({
    queryKey: ["store-service-zone-assignments", zoneId],
    queryFn: async () => {
      const db = supabase as any;
      const [{ data: stores, error: storesError }, { data: assignments, error: assignmentsError }] =
        await Promise.all([
          db.from("stores").select("id,name,seller_id").order("name"),
          db.from("store_service_zones").select("store_id").eq("zone_id", zoneId),
        ]);
      if (storesError) throw storesError;
      if (assignmentsError) throw assignmentsError;
      return {
        stores: stores ?? [],
        assigned: new Set<string>(
          (assignments ?? []).map((row: { store_id: string }) => row.store_id),
        ),
      };
    },
  });
}
