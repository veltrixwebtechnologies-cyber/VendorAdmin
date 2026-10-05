# LocalShore Phase B — Local Implementation Notes

This document describes the staged B2–B5 implementation prepared in this worktree. No Supabase database was queried or changed. The production project reference `flbygucibbrfcwcgzyea` is strictly off limits.

## Status and rollout

The application code and migrations are prepared locally. All new database behavior is **PREPARED — DATABASE VERIFICATION PENDING**. Apply these migrations only to an explicitly identified development project, in timestamp order, after reviewing the existing B1 migration and data. Do not apply them to production.

1. `20261004130000_phase_b_store_foundation.sql` — existing B1 Store table/backfill foundation.
2. `20261004140000_phase_b_store_domain.sql` — B2 product/order links, backfill, default-store assignment triggers, location dual-write and admin location RPC.
3. `20261004150000_phase_b_service_zones.sql` — B5 extension of existing `delivery_zones` and Store-zone assignments.
4. `20261004160000_phase_b_commerce_runtime.sql` — safe storefront/checkout resolvers, Store availability and assigned-zone/radius eligibility, one-Store order-item invariant, customer order Store details, and Store-aware dispatch pickup snapshots.

The migrations are additive. Do not edit earlier migration files once applied; corrections should be a new timestamped migration. The existing Phase A permissions and audit table remain the authorization/audit foundation. The database permissions for `service_zones.view` and `service_zones.manage` are added in B5; B5 grants manage to Super Admin and Operations Admin, and view to Seller Manager and Analyst. Client-side checks are UX only; RLS/RPC checks remain authoritative.

## Data model decisions

- A seller remains the business/account and financial owner. Payouts and settlements are not moved to Stores and no Store wallet is introduced.
- A Store is a physical selling/fulfillment location; the schema supports multiple Stores per seller while marking at most one default Store.
- `products.seller_id` remains the ownership key and `products.store_id` is the physical location. B2 backfills Store IDs only where a default Store exists and validates the seller/Store composite relationship.
- The checkout path currently rejects carts that contain products from multiple sellers. Therefore `orders.store_id` belongs on the existing seller-owned order header; `order_items` does not need a redundant Store ID. Historical orders use the default Store only when that relationship is unambiguous.
- Seller-keyed hours and legacy seller address/coordinate fields remain available. B2 snapshots normalized `shop_hours` into Store JSON for future migration, but current hours, discovery, and delivery behavior remain on existing seller/platform data paths.
- A Store service radius is optional. The current Seller schema has no seller-specific radius; this is not copied from delivery-partner coverage. If a Store has active assigned service zones, those zones restrict delivery. Otherwise an explicit Store radius restricts delivery. With neither configured, the current checkout behavior is preserved after a valid location is confirmed. Existing platform delivery-partner zones are not silently treated as customer delivery boundaries.
- B5 reuses `delivery_zones` as the configurable radius-zone catalog and adds `store_service_zones`; it creates no hardcoded cities/neighborhoods or fake zone records. Existing public active-zone reads are preserved, and management is permission-checked.
- Google Maps behavior is reused. Store maps show only actual Store records with valid coordinates; existing seller location remains a fallback until later data-path rollout.

## Local implementation

The domain resolver in `src/lib/store-domain.ts` explicitly handles missing, ambiguous, and ownership-mismatched defaults; it never chooses an arbitrary first Store. Location, delivery-radius, and dispatch pickup compatibility are centralized there. Customer pure commerce rules are in `ShorelineShopper/src/lib/store-commerce.ts`; the current app retains seller-keyed URLs/cart ownership while checkout resolves one physical Store for fulfillment. The new RPC preflight runs before COD order creation and before Razorpay order creation; a database trigger is the final order-item guard. Customer order history retrieves Store display/location data only for the authenticated order owner. Dispatch pickup metadata is snapshotted onto assigned deliveries from Store-first/Seller-legacy resolution. Admin and Seller Hub data hooks are in `src/lib/stores.ts`. Admin Store list/detail/map, location editor, and Service Zones pages use existing LocalShore components, Google Maps components, RBAC, and audit infrastructure.

Seller Store Profile exposes the default Store’s name, description, and optional radius without forcing a multi-Store workflow. Seller location confirmation continues through the existing RPC contract; B2 makes that RPC dual-write to the default Store when present. Customer shop URLs remain seller-keyed for compatibility, but the Storefront uses the new safe Store status/name/address RPC when installed. The delivery partner app reads pickup snapshots from assignments and retains Seller location fallback. Until database rollout, missing Store schema falls back to the existing Seller Hub/customer Seller path.

## Verification still required

Local build/typecheck/tests can validate source behavior and migration invariants statically, but cannot prove PostgreSQL syntax/application success, deployed schema compatibility, RLS behavior, backfill parity, or runtime Google Maps/API behavior. The runtime migration and Store-aware RPC/trigger behavior are **PREPARED — DATABASE VERIFICATION PENDING**. These must be verified in a confirmed development database before treating any database-dependent feature as active. Authenticated RBAC boundary testing also remains outstanding. No production readiness is claimed.
