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
