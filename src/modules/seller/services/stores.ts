import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { resolveDefaultStore, type StoreLike } from "@/lib/store-domain";
import { isMissingStoreSchema } from "@/shared/shops/store-contracts";

export function useSellerDefaultStore(sellerId: string | null | undefined) {
  return useQuery({
    queryKey: ["seller-stores", sellerId],
    enabled: Boolean(sellerId),
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("stores")
        .select("*")
        .eq("seller_id", sellerId)
        .order("is_default", { ascending: false });
      if (error) {
        if (isMissingStoreSchema(error))
          return { stores: [], resolution: { state: "missing" as const }, unavailable: true };
        throw error;
      }
      const stores = (data ?? []) as StoreLike[];
      return {
        stores,
        resolution: resolveDefaultStore(stores, sellerId!),
        unavailable: false,
      };
    },
  });
}

export function useUpdateSellerStore() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      sellerId: string;
      name: string;
      description: string;
      serviceRadiusKm: number | null;
    }) => {
      const { data, error } = await (supabase as any)
        .from("stores")
        .update({
          name: input.name.trim(),
          description: input.description.trim() || null,
          service_radius_km: input.serviceRadiusKm,
        })
        .eq("id", input.id)
        .eq("seller_id", input.sellerId)
        .select("id")
        .single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: async (_id, input) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["seller-stores", input.sellerId] }),
        qc.invalidateQueries({ queryKey: ["admin-stores"] }),
        qc.invalidateQueries({ queryKey: ["admin-store"] }),
      ]);
    },
  });
}
