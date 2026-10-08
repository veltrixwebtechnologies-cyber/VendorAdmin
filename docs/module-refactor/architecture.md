# LocalShore module refactor

## Implemented architecture

Three repositories/builds still serve one platform and the same existing Supabase project. Admin is developer 4's module, primarily hosted by SellerHub, not a rebuilt fourth application.

```text
LocalShoree/
├── ShorelineShopper-GMap/
│   ├── packages/localshore-core/src/     canonical cross-app contracts + cn
│   ├── src/modules/shopper/
│   │   ├── components/                  shop cards, discovery, imported storefront
│   │   ├── hooks/                       discovery and live search
│   │   └── services/                    cart, orders, addresses, search, notifications
│   ├── src/shared/core/                 checked-in verified snapshot
│   └── src/routes/                      existing customer URLs
├── SellerHub/
│   ├── src/modules/seller/services/     profile, stores, orders, stock, settlements
│   ├── src/modules/admin/
│   │   ├── components/                  store map/location editor
│   │   └── services/                    admin data, sellers, stores, delivery review
│   ├── src/shared/
│   │   ├── core/                        verified cross-app snapshot
│   │   ├── auth/                        existing permission adapters
│   │   ├── services/                    unchanged seller/order mappers
│   │   ├── shops/                       neutral store contracts
│   │   ├── notifications/               existing notification hooks/events
│   │   └── storage/                     existing document upload/signed URLs
│   └── src/routes/{seller,admin}/        existing URLs and owner-specific page code
└── Delivery Partner Hub/
    ├── src/modules/delivery/            services, repositories, navigation, hooks
    ├── src/modules/seller/              retained vendor compatibility services
    ├── src/modules/admin/pages/         retained delivery-admin console
    ├── src/shared/{core,auth,orders,components}/
    └── src/routes/                      partner/vendor/admin URLs unchanged
```

Role code depends on shared contracts/adapters and the existing backend; it may not depend on another role's private implementation. Legacy src/lib, services, hooks and component paths forward exports during migration. Generated database types remain per app, accessed through src/shared/database.ts; persisted record aliases derive actual generated rows rather than guessed fields. Seller and Shopper order display DTOs remain separate views of the same persisted orders, not separate databases or order systems.

## Ownership and communication

Developer 1 owns Shopper; 2 owns Seller including vendor compatibility; 3 owns Delivery; 4 owns Admin including delivery-admin compatibility. TanStack route registration stays in src/routes to preserve URLs and generated route behavior. Existing src/lib/products.functions.ts is a shared authenticated server boundary used by seller and admin; it was not moved into either role. Existing server-side payment, auth, cache and integration files remain in place for safe TanStack server-function transformation. Their ownership is documented rather than forcing risky file moves.

Shopper creates orders through the existing checkout/payment backend. Seller reads the same orders and advances the existing vendor/preparation RPCs. Dispatch creates delivery_assignments; riders use existing acceptance, pickup/completion and GPS APIs. Shopper consumes existing status/location updates. Admin consumes authorized views/RPCs. No inter-app UI imports, new business tables, or parallel order systems were introduced.

## Preserved platform capabilities

Supabase Auth/user_roles and activation rules remain unchanged. Admin still uses get_my_admin_access, admin_access_assignments/admin_role_permissions and has_admin_permission. Server middleware and RLS are still the authority, not frontend gates. Independent browser origins do not automatically share a session; no token forwarding or new SSO was introduced.

Orders/order_items, sellers/stores/products, profiles, delivery_partners/assignments, payments and notifications still reference their original entities and relationships. No SQL, keys, foreign keys, triggers, RLS, storage policies, publications, or production state were changed. Historical migration hashes are checked; see migrations.md before deployment.

Shop discovery remains 7 km; customer product visibility remains 5 km. Google loaders, Places, stored imported-shop coordinates, PostGIS/nearby RPCs and map alternatives remain intact. Delivery watchPosition, throttling, queue, submit_partner_location, update_delivery_location and tracking adapters retain their implementation. Imported public shops/claim metadata remain distinct from registered stores and confirmed inventory. No additional geocoding was added.

Real checkout retains product validation, Razorpay order creation, payment_attempts, signature/captured-payment verification, place_order_once and finalize_verified_payment. Server secrets remain server-side. Imported prototype/test checkout remains separate and cannot dispatch a real fulfillment order merely through this refactor. Refund exposure/deployment questions are documented in api-discrepancies.md, not worked around with replacement APIs.

Existing notifications, delivery_notifications, notification_outbox, triggers and Realtime remain the infrastructure. Shared seller notification adapters and role-owned shopper hooks consume it. Protected support-message RPCs, evidence storage, signed URLs and privacy boundaries were left intact.

## Admin inventory and consolidation decision

SellerHub remains the primary console: users/admin-users and permission assignment; vendors/seller review; stores/store-map/service-zones; products/inventory/categories/filters/merchandising/banners/offers/coupons; orders/dispatch; payments/refunds/payouts/reconciliation; reports/reviews/disputes/tickets; audit-logs/settings/ml-control-center. Delivery /admin retains rider approval/documents, active assignment monitoring, payout/withdrawal review, delivery exceptions and timeline. There is overlapping delivery monitoring, but removing it requires a verified replacement and usage evidence. Both are developer 4 owned now; neither route was deleted or redirected prematurely.

## Incremental follow-up, not hidden completion claims

Legacy forwarding exports remain intentionally. Some role page bodies remain in role-specific route folders; moving them adds little ownership benefit and risks Route bindings. Schema regeneration, remote migration reconciliation, focused security review and authenticated end-to-end acceptance require separate verified work. The shared core contains contracts and one truly identical pure utility, not duplicated auth clients, payment handlers, or map implementations. Independently cloned apps can build using their checked-in snapshot without sibling repositories or an unpublished package.

See CONTRIBUTING.md for coordinated shared changes; SECURITY_REVIEW.md for unproven concerns; verification.md for actual test results and limits.
