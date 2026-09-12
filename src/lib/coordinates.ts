export interface Coordinates {
  lat: number;
  lng: number;
}

export function parseCoordinates(lat: unknown, lng: unknown): Coordinates | null {
  const number = (value: unknown) =>
    typeof value === "number" || (typeof value === "string" && value.trim() !== "")
      ? Number(value)
      : NaN;
  const a = number(lat),
    b = number(lng);
  return Number.isFinite(a) &&
    Number.isFinite(b) &&
    Math.abs(a) <= 90 &&
    Math.abs(b) <= 180 &&
    !(a === 0 && b === 0)
    ? { lat: a, lng: b }
    : null;
}

// Maximum reported uncertainty for automatic GPS use; permission alone does not prove accuracy.
export const MAX_NAVIGATION_ACCURACY_M = 25;
export const MAX_LOCATION_AGE_MS = 30_000;

export function freshPartnerCoordinates(partner: any): [number, number] | null {
  const point = parseCoordinates(partner?.current_latitude, partner?.current_longitude);
  const captured = Date.parse(partner?.location_updated_at ?? "");
  return point &&
    Number.isFinite(captured) &&
    Date.now() - captured <= MAX_LOCATION_AGE_MS &&
    captured <= Date.now() + 1000
    ? [point.lat, point.lng]
    : null;
}

export function usableGPS(position: GeolocationPosition, now = Date.now()): boolean {
  return (
    !!parseCoordinates(position.coords.latitude, position.coords.longitude) &&
    Number.isFinite(position.coords.accuracy) &&
    position.coords.accuracy >= 0 &&
    position.coords.accuracy <= MAX_NAVIGATION_ACCURACY_M &&
    Number.isFinite(position.timestamp) &&
    now - position.timestamp <= MAX_LOCATION_AGE_MS &&
    position.timestamp <= now + 1000
  );
}
