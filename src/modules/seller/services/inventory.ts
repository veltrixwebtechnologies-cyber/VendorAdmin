import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

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
