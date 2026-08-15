import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type DispatchAssignment = {
  id: string; order_id: string; partner_id: string; status: string;
  distance_km: number | null; estimated_earning: number | null; expires_at: string | null;
  responded_at: string | null; picked_up_at: string | null; delivered_at: string | null; created_at: string; updated_at: string;
  order?: { id: string; order_number?: string | null; buyer_name: string | null; buyer_phone?: string | null; buyer_address?: string | null; status: string; seller_id: string | null; created_at: string; } | null;
  partner?: { id: string; full_name: string; mobile: string; availability: string; status: string; current_latitude: number | null; current_longitude: number | null; location_updated_at: string | null; rating: number; total_deliveries: number; cancelled_deliveries: number; late_deliveries: number; total_requests: number; accepted_requests: number; } | null;
};
export type TrackingEvent = { id: string; assignment_id: string; status: string; note: string | null; actor_role: string | null; actor_user_id: string | null; created_at: string };
export type DeliveryException = { id: string; assignment_id: string; order_id: string; partner_id: string; reason: string; notes: string | null; photo_path: string | null; created_by: string; resolution_status: string; resolution_note: string | null; created_at: string; updated_at: string };

export function useDispatchCenter() {
  return useQuery({
    queryKey: ["admin", "dispatch-center"],
    queryFn: async () => {
      const [assignments, tracking, exceptions, earnings] = await Promise.all([
        (supabase as any).from("delivery_assignments").select("id,order_id,partner_id,status,distance_km,estimated_earning,expires_at,responded_at,picked_up_at,delivered_at,created_at,updated_at,orders(id,order_number,buyer_name,buyer_phone,buyer_address,status,seller_id,created_at),delivery_partners(id,full_name,mobile,availability,status,current_latitude,current_longitude,location_updated_at,rating,total_deliveries,cancelled_deliveries,late_deliveries,total_requests,accepted_requests)").order("updated_at", { ascending: false }).limit(500),
        (supabase as any).from("delivery_tracking").select("id,assignment_id,status,note,actor_role,actor_user_id,created_at").order("created_at", { ascending: true }).limit(2000),
        (supabase as any).from("delivery_exceptions").select("id,assignment_id,order_id,partner_id,reason,notes,photo_path,created_by,resolution_status,resolution_note,created_at,updated_at").order("created_at", { ascending: false }).limit(500),
        (supabase as any).from("delivery_earnings").select("id,partner_id,assignment_id,amount,created_at").order("created_at", { ascending: false }).limit(2000),
      ]);
      for (const response of [assignments, tracking, exceptions, earnings]) if (response.error) throw response.error;
      return { assignments: (assignments.data ?? []).map((row: any) => ({ ...row, order: row.orders, partner: row.delivery_partners })) as DispatchAssignment[], tracking: (tracking.data ?? []) as TrackingEvent[], exceptions: (exceptions.data ?? []) as DeliveryException[], earnings: earnings.data ?? [] };
    },
    refetchInterval: 10_000,
  });
}

export function useAdminReassignDelivery() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (assignmentId: string) => {
      const { data, error } = await (supabase as any).rpc("admin_reassign_delivery", { _assignment_id: assignmentId });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "dispatch-center"] }),
  });
}

export function useResolveDeliveryException() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status, note }: { id: string; status: string; note?: string }) => {
      const { error } = await (supabase as any).rpc("resolve_delivery_exception", { _exception_id: id, _status: status, _note: note ?? null });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "dispatch-center"] }),
  });
}
