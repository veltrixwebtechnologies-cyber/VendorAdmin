/* ============================================================
 * Shop Availability — data layer for Seller Hub
 * Covers: weekly hours, manual overrides, holidays, audit log.
 * All "live" status checks use the DB RPC to avoid client-clock drift.
 * ============================================================ */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

/* ── Types ─────────────────────────────────────────────────────────────────── */

export const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
export const DAY_FULL = [
  "Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday",
] as const;

export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface ShopHour {
  id: string;
  sellerId: string;
  dayOfWeek: DayOfWeek;
  isOpen: boolean;
  openTime: string;   // "HH:MM"
  closeTime: string;  // "HH:MM"
  breakStart: string | null;
  breakEnd: string | null;
  updatedAt: string;
}

export type OverrideKind = "temporary_closed" | "manual_open" | "manual_closed";

export interface ShopOverride {
  id: string;
  sellerId: string;
  kind: OverrideKind;
  reason: string | null;
  effectiveUntil: string | null;
  createdAt: string;
  revertedAt: string | null;
}

export interface ShopHoliday {
  id: string;
  sellerId: string;
  name: string;
  startDate: string;  // "YYYY-MM-DD"
  endDate: string;
  specialOpen: string | null;
  specialClose: string | null;
  isClosed: boolean;
  createdAt: string;
}

export type ShopStatusKind =
  | "open"
  | "closed"
  | "closed_override"
  | "open_override"
  | "holiday";

export interface ShopStatus {
  status: ShopStatusKind;
  isOpen: boolean;
  label: string;
  opensAt: string | null;
  closesAt: string | null;
  overrideReason: string | null;
  checkedAt: string;
}

export interface AvailabilityLogEntry {
  id: string;
  sellerId: string;
  actorId: string | null;
  action: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

/* ── Mappers ────────────────────────────────────────────────────────────────── */

function rowToHour(r: any): ShopHour {
  return {
    id:          r.id,
    sellerId:    r.seller_id,
    dayOfWeek:   r.day_of_week as DayOfWeek,
    isOpen:      r.is_open,
    openTime:    (r.open_time  ?? "09:00").slice(0, 5),
    closeTime:   (r.close_time ?? "21:00").slice(0, 5),
    breakStart:  r.break_start ? r.break_start.slice(0, 5) : null,
    breakEnd:    r.break_end   ? r.break_end.slice(0, 5)   : null,
    updatedAt:   r.updated_at,
  };
}

function rowToOverride(r: any): ShopOverride {
  return {
    id:             r.id,
    sellerId:       r.seller_id,
    kind:           r.kind,
    reason:         r.reason,
    effectiveUntil: r.effective_until,
    createdAt:      r.created_at,
    revertedAt:     r.reverted_at,
  };
}

function rowToHoliday(r: any): ShopHoliday {
  return {
    id:           r.id,
    sellerId:     r.seller_id,
    name:         r.name,
    startDate:    r.start_date,
    endDate:      r.end_date,
    specialOpen:  r.special_open  ? r.special_open.slice(0, 5)  : null,
    specialClose: r.special_close ? r.special_close.slice(0, 5) : null,
    isClosed:     r.is_closed,
    createdAt:    r.created_at,
  };
}

function dbToStatus(r: any): ShopStatus {
  return {
    status:         r.status,
    isOpen:         r.is_open,
    label:          r.label,
    opensAt:        r.opens_at,
    closesAt:       r.closes_at,
    overrideReason: r.override_reason,
    checkedAt:      r.checked_at,
  };
}

/* ── Default schedule builder ────────────────────────────────────────────────── */
export function defaultWeeklyHours(sellerId: string): Omit<ShopHour, "id" | "updatedAt">[] {
  return Array.from({ length: 7 }, (_, i) => ({
    sellerId,
    dayOfWeek:  i as DayOfWeek,
    isOpen:     i !== 0,          // closed Sunday by default
    openTime:   "09:00",
    closeTime:  "21:00",
    breakStart: null,
    breakEnd:   null,
  }));
}

/* ── RPC: get live status ─────────────────────────────────────────────────────── */

export function useShopStatus(sellerId: string | null | undefined) {
  return useQuery({
    queryKey: ["shop-status", sellerId],
    enabled:  !!sellerId,
    refetchInterval: 60_000,            // refresh every minute
    staleTime:       30_000,
    queryFn: async (): Promise<ShopStatus> => {
      const { data, error } = await (supabase as any).rpc("get_shop_status", {
        _seller_id: sellerId,
      });
      if (error) throw error;
      return dbToStatus(data);
    },
  });
}

/** Batch-fetch statuses for multiple sellers (used in shopper home) */
export function useShopsStatus(sellerIds: string[]) {
  return useQuery({
    queryKey: ["shops-status", sellerIds.join(",")],
    enabled:  sellerIds.length > 0,
    staleTime: 60_000,
    refetchInterval: 120_000,
    queryFn: async (): Promise<Map<string, ShopStatus>> => {
      const { data, error } = await (supabase as any).rpc("get_shops_status", {
        _seller_ids: sellerIds,
      });
      if (error) throw error;
      const map = new Map<string, ShopStatus>();
      for (const row of data ?? []) {
        map.set(row.seller_id, dbToStatus(row.status_info));
      }
      return map;
    },
  });
}

/* ── Weekly hours ─────────────────────────────────────────────────────────────── */

export function useMyShopHours(sellerId: string | null | undefined) {
  return useQuery({
    queryKey: ["shop-hours", sellerId],
    enabled:  !!sellerId,
    queryFn: async (): Promise<ShopHour[]> => {
      const { data, error } = await supabase
        .from("shop_hours")
        .select("*")
        .eq("seller_id", sellerId!)
        .order("day_of_week");
      if (error) throw error;
      const rows = (data ?? []).map(rowToHour);
      // Fill missing days with defaults
      const byDay = new Map(rows.map((r) => [r.dayOfWeek, r]));
      return Array.from({ length: 7 }, (_, i) => {
        const dow = i as DayOfWeek;
        return byDay.get(dow) ?? {
          id:          `virtual-${dow}`,
          sellerId:    sellerId!,
          dayOfWeek:   dow,
          isOpen:      dow !== 0,
          openTime:    "09:00",
          closeTime:   "21:00",
          breakStart:  null,
          breakEnd:    null,
          updatedAt:   "",
        };
      });
    },
  });
}

export function useUpsertShopHour() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: {
      sellerId:    string;
      dayOfWeek:   DayOfWeek;
      isOpen:      boolean;
      openTime:    string;
      closeTime:   string;
      breakStart?: string | null;
      breakEnd?:   string | null;
    }) => {
      const { error } = await (supabase as any).rpc("upsert_shop_hours", {
        _seller_id:   v.sellerId,
        _day_of_week: v.dayOfWeek,
        _is_open:     v.isOpen,
        _open_time:   v.openTime,
        _close_time:  v.closeTime,
        _break_start: v.breakStart ?? null,
        _break_end:   v.breakEnd   ?? null,
      });
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["shop-hours",  v.sellerId] });
      qc.invalidateQueries({ queryKey: ["shop-status", v.sellerId] });
    },
  });
}

/* ── Bulk save helper (saves all 7 days in one mutation) ─────────────────────── */
export function useSaveAllShopHours() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { sellerId: string; hours: Omit<ShopHour, "id" | "updatedAt">[] }) => {
      for (const h of v.hours) {
        const { error } = await (supabase as any).rpc("upsert_shop_hours", {
          _seller_id:   v.sellerId,
          _day_of_week: h.dayOfWeek,
          _is_open:     h.isOpen,
          _open_time:   h.openTime,
          _close_time:  h.closeTime,
          _break_start: h.breakStart ?? null,
          _break_end:   h.breakEnd   ?? null,
        });
        if (error) throw error;
      }
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["shop-hours",  v.sellerId] });
      qc.invalidateQueries({ queryKey: ["shop-status", v.sellerId] });
    },
  });
}

/* ── Seller timezone ─────────────────────────────────────────────────────────── */

export function useUpdateShopTimezone() {
  const qc   = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (v: { sellerId: string; timezone: string }) => {
      const { error } = await supabase
        .from("sellers")
        .update({ timezone: v.timezone })
        .eq("id", v.sellerId);
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["my-seller", user?.id] });
      qc.invalidateQueries({ queryKey: ["shop-status", v.sellerId] });
    },
  });
}

/* ── Overrides ───────────────────────────────────────────────────────────────── */

export function useActiveOverride(sellerId: string | null | undefined) {
  return useQuery({
    queryKey: ["shop-override", sellerId],
    enabled:  !!sellerId,
    refetchInterval: 60_000,
    queryFn: async (): Promise<ShopOverride | null> => {
      const { data, error } = await supabase
        .from("shop_overrides")
        .select("*")
        .eq("seller_id", sellerId!)
        .is("reverted_at", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data ? rowToOverride(data) : null;
    },
  });
}

export function useSetShopOverride() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: {
      sellerId:       string;
      kind:           OverrideKind;
      reason?:        string;
      effectiveUntil?: string | null;
    }) => {
      const { data, error } = await (supabase as any).rpc("set_shop_override", {
        _seller_id:       v.sellerId,
        _kind:            v.kind,
        _reason:          v.reason ?? null,
        _effective_until: v.effectiveUntil ?? null,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["shop-override", v.sellerId] });
      qc.invalidateQueries({ queryKey: ["shop-status",   v.sellerId] });
      qc.invalidateQueries({ queryKey: ["shop-avail-log"] });
    },
  });
}

export function useRevertShopOverride() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (sellerId: string) => {
      const { error } = await (supabase as any).rpc("revert_shop_override", {
        _seller_id: sellerId,
      });
      if (error) throw error;
    },
    onSuccess: (_d, sellerId) => {
      qc.invalidateQueries({ queryKey: ["shop-override", sellerId] });
      qc.invalidateQueries({ queryKey: ["shop-status",   sellerId] });
      qc.invalidateQueries({ queryKey: ["shop-avail-log"] });
    },
  });
}

/* ── Holidays ────────────────────────────────────────────────────────────────── */

export function useShopHolidays(sellerId: string | null | undefined) {
  return useQuery({
    queryKey: ["shop-holidays", sellerId],
    enabled:  !!sellerId,
    queryFn: async (): Promise<ShopHoliday[]> => {
      const { data, error } = await supabase
        .from("shop_holidays")
        .select("*")
        .eq("seller_id", sellerId!)
        .gte("end_date", new Date().toISOString().slice(0, 10))
        .order("start_date");
      if (error) throw error;
      return (data ?? []).map(rowToHoliday);
    },
  });
}

export function useAddShopHoliday() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: {
      sellerId:     string;
      name:         string;
      startDate:    string;
      endDate:      string;
      isClosed:     boolean;
      specialOpen?:  string | null;
      specialClose?: string | null;
    }) => {
      const { data, error } = await supabase
        .from("shop_holidays")
        .insert({
          seller_id:    v.sellerId,
          name:         v.name,
          start_date:   v.startDate,
          end_date:     v.endDate,
          is_closed:    v.isClosed,
          special_open:  v.specialOpen  ?? null,
          special_close: v.specialClose ?? null,
        })
        .select("*")
        .single();
      if (error) throw error;
      // Log
      await supabase.from("shop_availability_log").insert({
        seller_id: v.sellerId,
        action:    "add_holiday",
        payload:   { name: v.name, start: v.startDate, end: v.endDate },
      });
      return rowToHoliday(data);
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["shop-holidays", v.sellerId] });
      qc.invalidateQueries({ queryKey: ["shop-status",   v.sellerId] });
    },
  });
}

export function useDeleteShopHoliday() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { id: string; sellerId: string }) => {
      const { error } = await supabase
        .from("shop_holidays")
        .delete()
        .eq("id", v.id);
      if (error) throw error;
      await supabase.from("shop_availability_log").insert({
        seller_id: v.sellerId,
        action:    "del_holiday",
        payload:   { id: v.id },
      });
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["shop-holidays", v.sellerId] });
      qc.invalidateQueries({ queryKey: ["shop-status",   v.sellerId] });
    },
  });
}

/* ── Audit log ───────────────────────────────────────────────────────────────── */

export function useAvailabilityLog(sellerId: string | null | undefined) {
  return useQuery({
    queryKey: ["shop-avail-log", sellerId],
    enabled:  !!sellerId,
    queryFn: async (): Promise<AvailabilityLogEntry[]> => {
      const { data, error } = await supabase
        .from("shop_availability_log")
        .select("*")
        .eq("seller_id", sellerId!)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        id:        r.id,
        sellerId:  r.seller_id,
        actorId:   r.actor_id,
        action:    r.action,
        payload:   r.payload ?? {},
        createdAt: r.created_at,
      }));
    },
  });
}

/* ── Validation helpers ───────────────────────────────────────────────────────── */

export function validateTimeRange(open: string, close: string): string | null {
  if (!open || !close) return "Open and close times are required.";
  const [oh, om] = open.split(":").map(Number);
  const [ch, cm] = close.split(":").map(Number);
  if (isNaN(oh) || isNaN(om) || isNaN(ch) || isNaN(cm))
    return "Invalid time format. Use HH:MM.";
  // Overnight is fine (close < open); only invalid if equal
  if (oh === ch && om === cm) return "Open and close times cannot be the same.";
  return null;
}

export function isOvernightSchedule(open: string, close: string): boolean {
  const [oh, om] = open.split(":").map(Number);
  const [ch, cm] = close.split(":").map(Number);
  return oh * 60 + om > ch * 60 + cm;
}

/* ── Common timezones for India + global fallback list ─────────────────────── */
export const TIMEZONES = [
  { value: "Asia/Kolkata",         label: "India Standard Time (IST, UTC+5:30)" },
  { value: "Asia/Colombo",         label: "Sri Lanka (UTC+5:30)" },
  { value: "Asia/Dubai",           label: "UAE (UTC+4)" },
  { value: "Asia/Singapore",       label: "Singapore (UTC+8)" },
  { value: "Asia/Tokyo",           label: "Japan (UTC+9)" },
  { value: "Europe/London",        label: "UK (UTC±0 / BST)" },
  { value: "Europe/Berlin",        label: "Central Europe (UTC+1 / CEST)" },
  { value: "America/New_York",     label: "US Eastern (UTC-5 / EDT)" },
  { value: "America/Chicago",      label: "US Central (UTC-6 / CDT)" },
  { value: "America/Los_Angeles",  label: "US Pacific (UTC-8 / PDT)" },
  { value: "Australia/Sydney",     label: "Australia Eastern (UTC+10 / AEDT)" },
];
