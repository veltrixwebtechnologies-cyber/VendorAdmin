import { parseCoordinates, type Coordinates } from "./coordinates.ts";

export interface StoreLike {
  id: string;
  seller_id: string;
  is_default: boolean;
  name?: string | null;
  description?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  country?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  google_place_id?: string | null;
  location_source?: string | null;
  location_verified?: boolean | null;
  location_verified_at?: string | null;
  service_radius_km?: number | null;
  status?: string | null;
  accepts_orders?: boolean | null;
  timezone?: string | null;
  estimated_prep_time_minutes?: number | null;
}

export interface LegacySellerLike {
  id: string;
  business_name?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  country?: string | null;
  lat?: number | null;
  lng?: number | null;
  location_verified?: boolean | null;
  location_verified_at?: string | null;
  accepts_orders?: boolean | null;
  timezone?: string | null;
  estimated_prep_time_minutes?: number | null;
  wizard_data?: unknown;
  delivery_radius_km?: number | null;
}

export type DefaultStoreResolution =
  | { state: "resolved"; store: StoreLike }
  | { state: "missing" }
  | { state: "missing-default"; stores: StoreLike[] }
  | { state: "ambiguous"; stores: StoreLike[] }
  | { state: "ownership-mismatch"; stores: StoreLike[] };

export function resolveDefaultStore(
  stores: readonly StoreLike[],
  sellerId: string,
): DefaultStoreResolution {
  if (stores.some((store) => store.seller_id !== sellerId)) {
    return { state: "ownership-mismatch", stores: [...stores] };
  }
  const defaults = stores.filter((store) => store.is_default);
  if (defaults.length > 1) return { state: "ambiguous", stores: defaults };
  if (defaults.length === 1) return { state: "resolved", store: defaults[0] };
  if (stores.length === 0) return { state: "missing" };
  return { state: "missing-default", stores: [...stores] };
}

const objectValue = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

function legacyCoordinates(seller: LegacySellerLike): Coordinates | null {
  const wizard = objectValue(seller.wizard_data);
  const shop = objectValue(wizard.shopCoordinates);
  return (
    parseCoordinates(shop.lat, shop.lng) ??
    parseCoordinates(seller.lat, seller.lng) ??
    parseCoordinates(wizard.lat, wizard.lng)
  );
}

export interface ResolvedStoreLocation {
  address: string;
  city: string;
  state: string;
  pincode: string;
  country: string;
  coordinates: Coordinates | null;
  googlePlaceId: string | null;
  source: "store" | "seller-legacy";
}

export function resolveStoreLocation(
  store: StoreLike | null | undefined,
  seller: LegacySellerLike,
): ResolvedStoreLocation {
  const storeCoordinates = parseCoordinates(store?.latitude, store?.longitude);
  const coordinates = storeCoordinates ?? legacyCoordinates(seller);
  const addressLine =
    [store?.address_line1, store?.address_line2].filter(Boolean).join(", ") ||
    [seller.address_line1, seller.address_line2].filter(Boolean).join(", ");
  return {
    address: addressLine,
    city: store?.city || seller.city || "",
    state: store?.state || seller.state || "",
    pincode: store?.pincode || seller.pincode || "",
    country: store?.country || seller.country || "",
    coordinates,
    googlePlaceId: store?.google_place_id || null,
    source: store && (storeCoordinates || store.address_line1) ? "store" : "seller-legacy",
  };
}

export type PickupResolution =
  | { state: "resolved"; coordinates: Coordinates; source: "store" | "seller-legacy" }
  | { state: "unavailable" }
  | { state: "ownership-mismatch" };

export function resolvePickupCoordinates(input: {
  sellerId: string;
  orderStoreId?: string | null;
  stores: readonly StoreLike[];
  seller: LegacySellerLike;
}): PickupResolution {
  const { sellerId, orderStoreId, stores, seller } = input;
  if (orderStoreId) {
    const store = stores.find((candidate) => candidate.id === orderStoreId);
    if (!store) return { state: "unavailable" };
    if (store.seller_id !== sellerId) return { state: "ownership-mismatch" };
    const location = resolveStoreLocation(store, seller);
    return location.coordinates
      ? { state: "resolved", coordinates: location.coordinates, source: location.source }
      : { state: "unavailable" };
  }
  if (stores.length) {
    const resolution = resolveDefaultStore(stores, sellerId);
    if (resolution.state !== "resolved") return { state: "unavailable" };
    const location = resolveStoreLocation(resolution.store, seller);
    return location.coordinates
      ? { state: "resolved", coordinates: location.coordinates, source: location.source }
      : { state: "unavailable" };
  }
  const coordinates = legacyCoordinates(seller);
  return coordinates
    ? { state: "resolved", coordinates, source: "seller-legacy" }
    : { state: "unavailable" };
}

export function resolveDeliveryRadius(
  store: StoreLike | null | undefined,
  seller: LegacySellerLike,
): { km: number | null; source: "store" | "seller-legacy" | "unspecified" } {
  if (typeof store?.service_radius_km === "number" && store.service_radius_km >= 0) {
    return { km: store.service_radius_km, source: "store" };
  }
  if (typeof seller.delivery_radius_km === "number" && seller.delivery_radius_km >= 0) {
    return { km: seller.delivery_radius_km, source: "seller-legacy" };
  }
  return { km: null, source: "unspecified" };
}

export function validateServiceZone(input: {
  name: string;
  city: string;
  latitude: number | null;
  longitude: number | null;
  radiusKm: number;
}): string[] {
  const errors: string[] = [];
  if (!input.name.trim()) errors.push("Zone name is required.");
  if (!input.city.trim()) errors.push("City is required.");
  if (input.latitude === null || input.longitude === null) {
    errors.push("Choose a center point on Google Maps.");
  } else if (!parseCoordinates(input.latitude, input.longitude)) {
    errors.push("Enter valid latitude and longitude coordinates.");
  }
  if (!Number.isFinite(input.radiusKm) || input.radiusKm <= 0) {
    errors.push("Radius must be greater than zero.");
  }
  return errors;
}
