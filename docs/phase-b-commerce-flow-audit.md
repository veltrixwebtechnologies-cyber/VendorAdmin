# Phase B commerce-flow audit (code/migration review only)

No database was queried. Findings below come from the current SellerHub and `ShorelineShopper` source plus repository migrations. The development database is not verified; the production project `flbygucibbrfcwcgzyea` was not accessed.

## Current commerce path

| Stage | Existing implementation | Seller/Store assumption |
|---|---|---|
| Discovery/catalog | Shopper home and search use `discover_nearby_shops`, `get_customer_visible_shops`, `get_customer_visible_products`, and related catalog RPCs. Product rows center on `seller_id`; some queries use `approved_vendor_catalog` / `approved_product_catalog`. | Shop result `id`/URL is seller ID; coordinates and business status come from Seller. |
| Shop/product detail | `src/routes/store.$storeId.tsx`, product detail, and recommendation components filter/join on `product.seller_id`. | URL compatibility is seller-keyed; no Store ID reaches all product cards. |
| Cart | `src/lib/cart-store.ts` persists one `storeId`; adding from another shop replaces the existing cart. | `storeId` is actually seller ID, so it prevents cross-seller orders but not cross-Store orders for a future multi-Store seller. |
| Checkout | `src/routes/checkout.tsx` obtains the shop pin through `useShopCoordinates`, computes Haversine distance/fee/ETA in the browser, and validates only that pins are confirmed/valid. | Distance comes from `approved_vendor_catalog` seller coordinates; no explicit service eligibility result is shown. ETA/fee are estimates. |
| COD order | `ordersStore.place()` sends buyer information, product IDs/quantities, payment method, coupon, and customer coordinates to `place_order_once`; no Store ID is sent. | Existing SQL verifies active products, approved seller, inventory, one seller per order, then uses seller hours/status. |
| Online payment | Shopper server function validates products by `seller_id`; payment verification then calls `place_order_once`. | Existing payment flow remains seller-grouped. Any new rejection must happen before payment authorization and again atomically at order creation. |
| Order history | `orders-store.ts` loads `orders + order_items`, maps seller business name and seller/wizard pickup coordinates. | Order Store identity is inferred as `order.seller_id`; no Store relationship is selected. |
| Dispatch | SQL dispatch migrations join `orders.seller_id` to `sellers.lat/lng` for pickup distance/routing. Delivery Partner UI consumes assignment/order details from its separate app. | Pickup coordinates are seller-based; delivery-partner authorization is tied to assigned order and must remain so. |
| Hours/availability | `shop-availability.ts` calls `get_shop_status(seller_id)` / batch RPC; Seller hours, overrides, holidays, and `accepts_orders` remain seller-keyed. Its legacy missing-RPC fallback reports open. Order SQL calls seller status/hours, but a legacy function catches broad errors. | No Store status/hours participate in customer purchasability. UI status fallback can fail open if the status RPC is missing. |
| Service zones/distance | `delivery_zones` are used by dispatch to match delivery-partner zones; new prepared B5 migration adds store assignments. Store radius is nullable, and the legacy seller schema has no seller-specific delivery radius. | Existing zones are not customer delivery boundaries today; adding restrictions without explicit assignments/radius would change checkout behavior. |

## Cart and fulfillment decision

The current cart is intentionally single-shop and current order SQL rejects multiple sellers. Preserve that invariant and URL shape. Add Store identity alongside Seller identity. A cart may contain only one Seller and one physical Store; if product Store IDs differ, require the shopper to split the order rather than combine pickup locations. Existing carts with no Store metadata resolve through product → Seller default Store. A mismatched Store/Seller relationship or ambiguous default must fail closed.

## Delivery compatibility decision

The existing checkout does not enforce a customer delivery boundary, while discovery radius is a browse/query radius and `delivery_zones` currently route delivery partners. Do not reinterpret dispatch zones as Store delivery boundaries. Explicit Store-zone assignments will be restrictive; if a Store has assignments, customer distance must fall within at least one assigned active radius zone. Otherwise use an explicit Store radius if configured. Where neither is configured, retain current legacy eligibility after requiring valid Store/legacy coordinates and Seller/Store order availability; surface that coverage is not configured rather than inventing a radius. Runtime enforcement must be atomic in the database. ETA/fees remain existing estimates, not guaranteed delivery promises.

## Compatibility/source-of-truth decision

- Store is authoritative for physical location, Store state, and Store-specific radius when present.
- Seller remains business ownership, account approval, financial beneficiary, and a temporary compatibility mirror for existing code.
- Existing normalized `shop_hours` remains authoritative until safely migrated; Store hours snapshot is used only where present and otherwise falls back to seller hours.
- Product `seller_id` remains ownership; product `store_id` is fulfillment location. Order keeps seller ownership and captures one store.
- Payment/payout/settlement ownership and delivery-partner assigned-order access are unchanged.
- The existing `ShorelineShopper` cart invariant already prevents mixed sellers. With Store-aware identity it will additionally prevent mixed Stores.

## Runtime rollout boundaries

This task prepares source code and a new migration only. Store-aware order enforcement, availability APIs, product/store links, delivery-zone policy, and dispatch joins are **PREPARED — DATABASE VERIFICATION PENDING** until the migrations are applied to an explicitly confirmed development database. Do not access or apply them to production.
