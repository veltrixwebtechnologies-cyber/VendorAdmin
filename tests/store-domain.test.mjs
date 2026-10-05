import assert from "node:assert/strict";
import test from "node:test";
import { register } from "tsx/esm/api";

register();
const {
  resolveDefaultStore,
  resolveStoreLocation,
  resolvePickupCoordinates,
  resolveDeliveryRadius,
  validateServiceZone,
} = await import("../src/lib/store-domain.ts");

const store = (overrides = {}) => ({
  id: "store-a",
  seller_id: "seller-a",
  is_default: true,
  latitude: 11.01,
  longitude: 76.95,
  address_line1: "Main Road",
  city: "Coimbatore",
  state: "Tamil Nadu",
  pincode: "641001",
  service_radius_km: null,
  ...overrides,
});

test("default Store resolution refuses missing, ambiguous, and foreign-owner cases", () => {
  assert.equal(resolveDefaultStore([], "seller-a").state, "missing");
  assert.equal(
    resolveDefaultStore([store({ is_default: false })], "seller-a").state,
    "missing-default",
  );
  assert.equal(
    resolveDefaultStore([store(), store({ id: "store-b" })], "seller-a").state,
    "ambiguous",
  );
  assert.equal(
    resolveDefaultStore([store({ seller_id: "seller-b" })], "seller-a").state,
    "ownership-mismatch",
  );
  const resolved = resolveDefaultStore([store()], "seller-a");
  assert.equal(resolved.state, "resolved");
  if (resolved.state === "resolved") assert.equal(resolved.store.id, "store-a");
});

test("Store location falls back to the established seller location only when needed", () => {
  const legacy = {
    id: "seller-a",
    address_line1: "Legacy address",
    city: "Legacy city",
    lat: 10.5,
    lng: 76.5,
    wizard_data: { googlePlaceId: "legacy-place", shopCoordinates: { lat: 10.7, lng: 76.7 } },
  };
  const stored = resolveStoreLocation(store(), legacy);
  assert.deepEqual(stored.coordinates, { lat: 11.01, lng: 76.95 });
  assert.equal(stored.source, "store");
  const fallback = resolveStoreLocation(
    store({ latitude: null, longitude: null, address_line1: null }),
    legacy,
  );
  assert.deepEqual(fallback.coordinates, { lat: 10.7, lng: 76.7 });
  assert.equal(fallback.address, "Legacy address");
  assert.equal(fallback.source, "seller-legacy");
});

test("pickup resolution honors the Order Store and rejects cross-seller ownership", () => {
  const seller = { id: "seller-a", lat: 10.5, lng: 76.5 };
  assert.deepEqual(
    resolvePickupCoordinates({
      sellerId: "seller-a",
      orderStoreId: "store-a",
      stores: [store()],
      seller,
    }),
    { state: "resolved", coordinates: { lat: 11.01, lng: 76.95 }, source: "store" },
  );
  assert.equal(
    resolvePickupCoordinates({
      sellerId: "seller-a",
      orderStoreId: "store-b",
      stores: [store({ id: "store-b", seller_id: "seller-b" })],
      seller,
    }).state,
    "ownership-mismatch",
  );
  assert.equal(
    resolvePickupCoordinates({
      sellerId: "seller-a",
      stores: [store({ is_default: false })],
      seller,
    }).state,
    "unavailable",
  );
});

test("delivery radius does not invent a seller radius", () => {
  assert.deepEqual(resolveDeliveryRadius(store({ service_radius_km: 4.5 }), { id: "seller-a" }), {
    km: 4.5,
    source: "store",
  });
  assert.deepEqual(resolveDeliveryRadius(store(), { id: "seller-a", delivery_radius_km: 3 }), {
    km: 3,
    source: "seller-legacy",
  });
  assert.deepEqual(resolveDeliveryRadius(store(), { id: "seller-a" }), {
    km: null,
    source: "unspecified",
  });
});

test("service zone validation rejects invalid center and radius", () => {
  assert.deepEqual(
    validateServiceZone({ name: "", city: "", latitude: 91, longitude: 200, radiusKm: 0 }),
    [
      "Zone name is required.",
      "City is required.",
      "Enter valid latitude and longitude coordinates.",
      "Radius must be greater than zero.",
    ],
  );
  assert.deepEqual(
    validateServiceZone({
      name: "Central",
      city: "City",
      latitude: 11,
      longitude: 76,
      radiusKm: 5,
    }),
    [],
  );
});
