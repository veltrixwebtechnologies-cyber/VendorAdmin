import test from "node:test";
import assert from "node:assert/strict";
import { sourceLoader } from "./load-source.mjs";
const load = sourceLoader(process.cwd(), {
  "@/integrations/supabase/client": "export const supabase = {};",
  "@/lib/auth": "export const useAuth = () => ({});",
});
const { rowToSeller, sellerPatchToDb } = await load("src/lib/db.ts");
test("pickup address and coordinates persist together in canonical and legacy fields", () => {
  const address = {
    shopAddress: "Business",
    landmark: "",
    city: "City",
    state: "State",
    pincode: "123456",
    pickupSame: false,
    pickupAddress: "Warehouse",
    pickupCity: "Town",
    pickupState: "State",
    pickupPincode: "123457",
    pickupLat: 11.2,
    pickupLng: 76.3,
  };
  const patch = sellerPatchToDb({ address }, { otherField: "preserved" });
  assert.equal(patch.lat, 11.2);
  assert.equal(patch.lng, 76.3);
  assert.equal(patch.wizard_data.pickupLat, 11.2);
  assert.equal(patch.wizard_data.pickupAddress, "Warehouse");
  assert.equal(patch.wizard_data.otherField, "preserved");
  assert.equal(rowToSeller({ ...patch }).address.pickupLat, 11.2);
});
test("separate pickup address never inherits an old business pin", () => {
  assert.equal(
    rowToSeller({ lat: 11, lng: 76, wizard_data: { pickupSame: false } }).address.pickupLat,
    null,
  );
  assert.equal(
    rowToSeller({ lat: 11, lng: 76, wizard_data: { pickupSame: true } }).address.pickupLat,
    11,
  );
});
test("cleared pickup pin clears every coordinate representation", () => {
  const patch = sellerPatchToDb(
    { address: { pickupLat: null, pickupLng: null } },
    { lat: 11, lng: 76, pickupLat: 11, pickupLng: 76 },
  );
  assert.equal(patch.lat, null);
  assert.equal(patch.lng, null);
  assert.equal(patch.wizard_data.lat, null);
  assert.equal(patch.wizard_data.pickupLat, null);
});
