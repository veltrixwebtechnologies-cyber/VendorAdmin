import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

import { rowToSeller } from "@/shared/services/data-mappers";

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
