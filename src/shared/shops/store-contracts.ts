import { type ResolvedStoreLocation, type StoreLike } from "@/lib/store-domain";

export interface AdminStore extends StoreLike {
  business_type: string | null;
  description: string | null;
  created_at: string;
  updated_at: string;
  seller?: {
    business_name: string | null;
    full_name: string | null;
    email: string | null;
    status: string | null;
  } | null;
  product_count: number | null;
  order_count: number | null;
  service_zone_count?: number | null;
  resolved_location?: ResolvedStoreLocation;
  resolved_service_radius?: {
    km: number | null;
    source: "store" | "seller-legacy" | "unspecified";
  };
}

export interface ServiceZone {
  id: string;
  name: string;
  city: string;
  latitude: number | null;
  longitude: number | null;
  radius_km: number;
  is_active: boolean;
  zone_type: "radius";
  created_at: string;
  updated_at: string | null;
  store_count: number | null;
}

export function isMissingStoreSchema(error: unknown) {
  const candidate = error as { code?: string; message?: string } | null;
  return (
    candidate?.code === "42P01" ||
    candidate?.code === "PGRST205" ||
    /relation .*stores.*does not exist|table .*stores.*not found/i.test(candidate?.message ?? "")
  );
}
