// Synced from @localshore/core 0.1.0; edit packages/localshore-core/src in the Shopper repository.
export interface ImportedShopRow {
  id: string;
  business_name: string;
  category: string;
  formatted_address: string | null;
  city: string | null;
  state: string | null;
  latitude: number;
  longitude: number;
  distance_km: number;
  website: string | null;
  google_maps_url: string | null;
  rating: number | string | null;
  review_count: number | null;
  cover_image_url: string | null;
  image_type: string | null;
  claim_status: string;
}
