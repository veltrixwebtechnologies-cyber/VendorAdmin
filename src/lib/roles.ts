import type { LocalShoreRole, RoleStatus } from "@/shared/core/roles";
export type { LocalShoreRole, RoleStatus } from "@/shared/core/roles";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";

export function useRoles() {
  const { user } = useAuth();
  const query = useQuery({
    queryKey: ["localshore-roles", user?.id],
    enabled: Boolean(user),
    // Admin approval can activate a seller role while the seller dashboard is
    // open in another tab/session; refresh on return so access unlocks promptly.
    staleTime: 15_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("user_roles")
        .select("role,status")
        .eq("user_id", user!.id);
      if (error) throw error;
      return (data ?? []).map((row: { role: string; status?: string | null }) => ({
        role: String(row.role) as LocalShoreRole,
        status: String(row.status ?? "active") as RoleStatus,
      }));
    },
  });

  const roles = useMemo(
    () => query.data?.map((row: { role: LocalShoreRole }) => row.role) ?? [],
    [query.data],
  );
  const hasRole = (role: LocalShoreRole) => roles.includes(role);
  const hasActiveRole = (role: LocalShoreRole) =>
    query.data?.some(
      (row: { role: LocalShoreRole; status: RoleStatus }) =>
        row.role === role && row.status === "active",
    ) ?? false;

  return { ...query, roles, hasRole, hasActiveRole };
}
