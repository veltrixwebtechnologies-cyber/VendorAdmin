/**
 * Supabase-backed admin auth. The admin role lives in `user_roles`.
 * These helpers are convenience for non-hook contexts; components should
 * prefer `useIsAdmin()` from `@/lib/db`.
 */
import { supabase } from "@/integrations/supabase/client";

export async function isCurrentUserAdmin(): Promise<boolean> {
  const { data: sess } = await supabase.auth.getUser();
  const uid = sess.user?.id;
  if (!uid) return false;
  const { data } = await supabase.from("user_roles").select("role").eq("user_id", uid).eq("role", "admin").maybeSingle();
  return !!data;
}
