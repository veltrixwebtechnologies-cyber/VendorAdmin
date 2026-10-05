import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { AdminRole } from "@/lib/admin-permissions";

export interface AdminUserRow {
  user_id: string;
  email: string | null;
  display_name: string | null;
  role: AdminRole;
  status: "active" | "suspended";
  assigned_by: string | null;
  created_at: string;
  last_sign_in_at: string | null;
}

export interface AdminAccountCandidate {
  user_id: string;
  email: string;
  display_name: string | null;
}

export interface AdminAuditLogRow {
  id: string;
  actor_id: string | null;
  actor_name: string | null;
  actor_email: string | null;
  actor_role: string;
  action: string;
  resource_type: string;
  resource_id: string | null;
  previous_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  reason: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  total_count: number;
}

export interface AdminAuditFilters {
  actor: string;
  action: string;
  resourceType: string;
  from: string;
  to: string;
  search: string;
  page: number;
}

export function useAdminAuditLogs(filters: AdminAuditFilters) {
  const pageSize = 25;
  return useQuery({
    queryKey: ["admin-audit-logs", filters],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("list_admin_audit_logs", {
        p_actor_search: filters.actor.trim() || null,
        p_action: filters.action || null,
        p_resource_type: filters.resourceType || null,
        p_from: filters.from ? new Date(filters.from).toISOString() : null,
        p_to: filters.to
          ? new Date(new Date(filters.to).getTime() + 86_400_000).toISOString()
          : null,
        p_search: filters.search.trim() || null,
        p_limit: pageSize,
        p_offset: (filters.page - 1) * pageSize,
      });
      if (error) throw error;
      const rows = (data ?? []) as AdminAuditLogRow[];
      return { rows, total: Number(rows[0]?.total_count ?? 0), pageSize };
    },
  });
}

export function useAdminAssignments() {
  return useQuery<AdminUserRow[]>({
    queryKey: ["admin-admin-users"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("list_admin_users");
      if (error) throw error;
      return (data ?? []) as AdminUserRow[];
    },
  });
}

export function useFindAdminAccount() {
  return useMutation({
    mutationFn: async (email: string) => {
      const { data, error } = await (supabase as any).rpc("find_admin_account", {
        p_email: email.trim(),
      });
      if (error) throw error;
      return ((data ?? [])[0] ?? null) as AdminAccountCandidate | null;
    },
  });
}

export function useSetAdminAccess() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      userId: string;
      role: AdminRole;
      status: "active" | "suspended";
      reason: string;
    }) => {
      const { error } = await (supabase as any).rpc("set_admin_access", {
        p_user_id: input.userId,
        p_role: input.role,
        p_status: input.status,
        p_reason: input.reason.trim(),
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin-admin-users"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-access"] }),
      ]);
    },
  });
}
