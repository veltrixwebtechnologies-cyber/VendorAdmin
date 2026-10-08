import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

export function useIsAdmin() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["is-admin", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("user_roles")
        .select("role")
        .eq("user_id", user!.id)
        .eq("role", "admin")
        .eq("status", "active")
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
