// Synced from @localshore/core 0.1.0; edit packages/localshore-core/src in the Shopper repository.
export interface DiscoveryShop {
  id: string;
  shop_name: string;
  business_type: string | null;
  category: string | null;
  lat: number;
  lng: number;
  distance_km: number;
  city?: string;
  state?: string;
  address_line1?: string;
  is_open?: boolean;
  is_verified?: boolean;
  is_fallback?: boolean;
  zone_name?: string;
  fallback_zone_name?: string;
  primary_zone_name?: string;
  shop_banner_path?: string;
  shop_logo_path?: string;
}
