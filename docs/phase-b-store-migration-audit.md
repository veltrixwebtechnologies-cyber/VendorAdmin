# Phase B1 — Seller / Store Schema Audit

This is a code-and-migration-history audit of the repository. The development database has not been queried or migrated from this worktree; compare the migration prerequisites against that database before applying `20261004130000_phase_b_store_foundation.sql`.

## Existing relationships and source of truth

| Domain | Existing relationship | Current behavior preserved in B1 |
|---|---|---|
| Seller account | `sellers.id` is UUID PK; `sellers.user_id` is unique FK to `auth.users.id` | Seller remains the account/business and financial owner |
| Products | `products.seller_id → sellers.id` (`ON DELETE CASCADE`); owner access also uses `products.user_id` | No product FK changes in B1 |
| Orders | `orders.seller_id → sellers.id` (`ON DELETE CASCADE`); buyer/owner uses `orders.user_id` | No order FK changes in B1 |
| Payouts | `settlements.seller_id → sellers.id`; seller user also stored in `settlements.user_id` | Remains seller/business-owned; no payout duplication |
| Dispatch | Delivery assignment points to an order; routing joins `orders.seller_id → sellers` for pickup coordinates | No dispatch changes in B1 |
| Shop hours | `shop_hours`, `shop_overrides`, `shop_holidays`, `shop_availability_log` are keyed by `seller_id` | Not copied/rewired in B1; current hours/status RPCs remain authoritative |
| Delivery/pickup fee | Persisted per order in `orders.shipping_fee`; platform has `platform_settings.shipping_flat`; dispatch earnings use `delivery_assignments.estimated_earning` with order fee fallback | No store-specific fee exists; B1 does not invent one or rewrite historic charges |
| Coordinates | `sellers.lat/lng`; a later migration adds `shop_latitude/shop_longitude`; onboarding stores `wizard_data.shopCoordinates`, `wizard_data.lat/lng` | B1 copies a complete pair from `wizard_data.shopCoordinates` first, then `lat/lng`, then wizard `lat/lng`; legacy columns remain untouched |
| Google Place ID | `wizard_data.googlePlaceId` | Copied verbatim to `stores.google_place_id`; no geocoding or verification is performed |
| Location verification | `sellers.location_verified/location_verified_at` | Copied verbatim; historical verification is not renewed. `location_verified_by` stays NULL because no source column exists |
| Availability | `sellers.accepts_orders`, `sellers.timezone`, seller-keyed hours/overrides/holidays | `accepts_orders` and `timezone` are copied; normalized schedule/override rows stay seller-keyed for now |
| Preparation time | `sellers.estimated_prep_time_minutes` | Copied verbatim |
| Delivery radius | No seller-specific radius column found. `delivery_zones.radius_km` is platform-zone coverage; nearby-shop discovery also accepts a request radius (commonly defaulted to 7 km). | `stores.service_radius_km` is nullable and left NULL; no global/platform radius is misrepresented as a store radius |

## Seller field classification

| Existing field(s) | Classification | B1 treatment |
|---|---|---|
| `id`, `user_id`, `created_at`, `updated_at`, `status`, `full_name`, `email`, `phone` | SELLER ACCOUNT DATA (some contact fields are shared with the storefront) | Remain on `sellers`; `status` is copied to the initial store as a transitional snapshot |
| `bank_account_name`, `bank_account_number`, `bank_ifsc`, `bank_name`, `gstin`, `pan`, `tax_category`, `hsn_default`, `reviewed_at`, `reviewed_by`, `admin_notes` | SELLER ACCOUNT / LEGAL / FINANCIAL DATA | Stay solely on `sellers`; never copied to stores |
| `business_name`, `business_type` | SHARED / REQUIRES DECISION (legal business identity and customer-facing store identity overlap) | Copied to `stores.name` / `stores.business_type`; legacy columns retained and still used by existing code |
| `address_line1`, `address_line2`, `city`, `state`, `pincode`, `country` | STORE DATA | Copied exactly into matching store fields |
| `lat`, `lng`, `shop_latitude`, `shop_longitude` | STORE DATA; duplicate legacy representations | Current UI/discovery preference is `wizard_data.shopCoordinates`, then `lat/lng`; B1 copies that effective pair, falling back only to `wizard_data.lat/lng`. All seller columns remain unchanged |
| `location_verified`, `location_verified_at` | STORE DATA | Copied exactly; no source/verified-by is inferred |
| `estimated_prep_time_minutes`, `timezone`, `accepts_orders` | STORE OPERATIONS | Copied exactly |
| `wizard_data` | SHARED / MIXED onboarding payload | Remains on seller; only store-facing `description`, `category`, coordinates and `googlePlaceId` are copied. Account verification, pickup details, bank metadata and documents remain untouched |
| `shop_hours`, `shop_overrides`, `shop_holidays`, `shop_availability_log` rows | STORE OPERATIONS currently keyed by seller | Remain untouched and continue to drive current functions until a later subphase migrates these relations safely |

## B1 migration behavior

- Creates a UUID `stores` table with a many-to-one `seller_id` FK and a partial unique index allowing one `is_default` store per seller, while permitting additional non-default stores.
- Backfills one default store per existing seller. The insert is guarded against existing store rows and the transaction asserts exactly one default row per seller.
- Preserves empty/null legacy text values as stored; it does not synthesize a store name, coordinates, address, place ID, service radius, or verification source.
- Adds seller-owner RLS plus separate `stores.view` and `stores.manage` admin policies. No legacy `role = admin` predicate is used. There is no client DELETE grant/policy and no public read grant yet.
- Adds store admin audit events to the existing Phase A `admin_audit_logs` table. Audit snapshots omit seller legal, contact, and financial fields.
- Does not change products, orders, settlements, delivery-zone data, dispatch functions, customer discovery, or Seller Hub read/write paths.

## Pre-apply / post-apply checks

Before applying in a development project, confirm that the required seller columns listed in the migration prerequisite block exist. The migration fails with a clear prerequisite error before table creation if they do not. Also inspect existing effective coordinates: if the selected legacy coordinate pair is outside latitude/longitude bounds, the new table constraint intentionally aborts and rolls back the migration. Correct or explicitly decide how to handle that source data before retrying; this migration does not clamp, geocode, or silently discard it.

After applying in development, verify count and copied-value parity before moving to B2:

```sql
select
  (select count(*) from public.sellers) as seller_count,
  (select count(*) from public.stores) as store_count,
  (select count(*) from public.stores where is_default) as default_store_count,
  (select count(*) from public.sellers s where not exists (
    select 1 from public.stores st where st.seller_id = s.id and st.is_default
  )) as sellers_missing_default_store;

select count(*) as mismatched_address_rows
from public.sellers s
join public.stores st on st.seller_id = s.id and st.is_default
where st.address_line1 is distinct from s.address_line1
   or st.address_line2 is distinct from s.address_line2
   or st.city is distinct from s.city
   or st.state is distinct from s.state
   or st.pincode is distinct from s.pincode
   or st.country is distinct from s.country;

select schemaname, tablename, policyname, cmd, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'stores'
order by policyname;
```

Expected after the backfill: `store_count = seller_count`, `default_store_count = seller_count`, zero sellers missing a default store, and zero mismatched address rows. Do not move to B2 until the development backfill and seller-owner RLS have been verified.
