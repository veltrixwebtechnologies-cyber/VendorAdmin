import type { Database } from "@/integrations/supabase/types";
import type { DatabaseRow } from "./core/database";
export type { Database } from "@/integrations/supabase/types";
export type TableRow<Name extends keyof Database["public"]["Tables"] & string> = DatabaseRow<
  Database,
  Name
>;
