import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(
  new URL("../supabase/migrations/20261004130000_phase_b_store_foundation.sql", import.meta.url),
  "utf8",
);
const domainMigration = await readFile(
  new URL("../supabase/migrations/20261004140000_phase_b_store_domain.sql", import.meta.url),
  "utf8",
);
const serviceZoneMigration = await readFile(
  new URL("../supabase/migrations/20261004150000_phase_b_service_zones.sql", import.meta.url),
  "utf8",
);
const runtimeMigration = await readFile(
  new URL("../supabase/migrations/20261004160000_phase_b_commerce_runtime.sql", import.meta.url),
  "utf8",
);

test("Phase B1 store migration is additive and retains seller ownership", () => {
  assert.match(migration, /CREATE TABLE public\.stores/i);
  assert.match(
    migration,
    /seller_id uuid NOT NULL REFERENCES public\.sellers\(id\) ON DELETE CASCADE/i,
  );
  assert.match(
    migration,
    /CREATE UNIQUE INDEX stores_one_default_per_seller_idx[\s\S]*WHERE is_default/i,
  );
  assert.match(
    migration,
    /WHERE NOT EXISTS \(SELECT 1 FROM public\.stores existing WHERE existing\.seller_id = r\.id\)/i,
  );
  assert.doesNotMatch(
    migration,
    /\bDROP\s+TABLE\b|\bUPDATE\s+public\.(sellers|products|orders|settlements)\b/i,
  );
});

test("Phase B1 store access uses owner checks and Phase A store permissions", () => {
  assert.match(migration, /Sellers read their own stores[\s\S]*?s\.user_id = auth\.uid\(\)/i);
  assert.match(migration, /RBAC admins read stores[\s\S]*?has_admin_permission\('stores\.view'\)/i);
  assert.match(
    migration,
    /RBAC admins update stores[\s\S]*?has_admin_permission\('stores\.manage'\)/i,
  );
  assert.doesNotMatch(migration, /has_role\([^\n]*'admin'/i);
});

test("Phase B1 does not invent a location source, coordinate, or delivery radius", () => {
  assert.match(migration, /location_source text CHECK \(location_source IS NULL/i);
  assert.match(migration, /service_radius_km numeric\(7,2\).*IS NULL/i);
  assert.doesNotMatch(migration, /13\.0827|80\.2707|11\.0168|76\.9558/);
  assert.match(migration, /wizard_data->'shopCoordinates'/i);
});

test("Phase B2 links products and single-seller orders without moving seller finance ownership", () => {
  assert.match(
    domainMigration,
    /ALTER TABLE public\.products[\s\S]*ADD COLUMN IF NOT EXISTS store_id uuid/i,
  );
  assert.match(
    domainMigration,
    /ALTER TABLE public\.orders[\s\S]*ADD COLUMN IF NOT EXISTS store_id uuid/i,
  );
  assert.match(
    domainMigration,
    /FOREIGN KEY \(seller_id, store_id\)[\s\S]*REFERENCES public\.stores \(seller_id, id\)/i,
  );
  assert.match(domainMigration, /st\.seller_id = p\.seller_id/i);
  assert.match(domainMigration, /order_items[\s\S]{0,160}duplicate store_id/i);
  assert.doesNotMatch(
    domainMigration,
    /ALTER TABLE public\.(settlements|payments)\s+ADD COLUMN[\s\S]*store_id/i,
  );
});

test("Phase B5 reuses existing delivery zones and authorizes changes through RBAC", () => {
  assert.match(serviceZoneMigration, /public\.delivery_zones/);
  assert.match(serviceZoneMigration, /public\.store_service_zones/);
  assert.match(serviceZoneMigration, /has_admin_permission\('service_zones\.view'\)/i);
  assert.match(serviceZoneMigration, /has_admin_permission\('service_zones\.manage'\)/i);
  assert.doesNotMatch(serviceZoneMigration, /INSERT INTO public\.delivery_zones/i);
  assert.doesNotMatch(serviceZoneMigration, /has_role\([^\n]*'admin'/i);
});

test("domain resolver avoids arbitrary first-store selection and fake delivery radius", async () => {
  const source = await readFile(new URL("../src/lib/store-domain.ts", import.meta.url), "utf8");
  assert.match(source, /state: "ambiguous"/);
  assert.match(source, /state: "missing-default"/);
  assert.match(source, /ownership-mismatch/);
  assert.match(source, /source: "unspecified"/);
  assert.doesNotMatch(source, /stores\[0\]/);
});

test("commerce runtime resolves Store first and protects one-Store fulfillment", () => {
  assert.match(runtimeMigration, /CREATE OR REPLACE FUNCTION public\.resolve_product_store/i);
  assert.match(runtimeMigration, /store_id uuid,[\s\S]*seller_id uuid/i);
  assert.match(runtimeMigration, /MULTIPLE_FULFILLMENT_STORES/i);
  assert.match(runtimeMigration, /CREATE OR REPLACE FUNCTION public\.resolve_customer_checkout/i);
  assert.match(runtimeMigration, /OUTSIDE_SERVICE_ZONE/i);
  assert.match(runtimeMigration, /OUTSIDE_DELIVERY_RADIUS/i);
  assert.match(runtimeMigration, /CREATE TRIGGER trg_enforce_order_item_store_commerce/i);
  assert.match(runtimeMigration, /resolve_order_pickup_location/i);
  assert.match(runtimeMigration, /pickup_store_name text/i);
  assert.match(runtimeMigration, /WHERE o\.user_id=auth\.uid\(\)/i);
  assert.doesNotMatch(runtimeMigration, /11\.0168|76\.9558|stores\[0\]/);
  assert.doesNotMatch(runtimeMigration, /ALTER TABLE public\.(payments|payouts|settlements)[\s\S]{0,100}store_id/i);
});
