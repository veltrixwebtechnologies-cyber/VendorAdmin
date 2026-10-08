# Contributing to LocalShore

LocalShore is one platform with three independently built applications sharing the existing Supabase project. Admin is an independently owned module hosted by SellerHub, with a delivery administration compatibility module in Delivery Partner Hub.

## Ownership

| Developer | Primary ownership |
| --- | --- |
| 1 | ShorelineShopper-GMap/src/modules/shopper and Shopper routes |
| 2 | SellerHub/src/modules/seller and /seller routes |
| 3 | Delivery Partner Hub/src/modules/delivery and /partner routes |
| 4 | SellerHub/src/modules/admin, /admin routes, and Delivery Partner Hub/src/modules/admin |

Delivery Hub's existing /vendor routes belong to Seller ownership. Keep their compatibility URLs until usage and replacement are verified. Shared services are jointly reviewed; a consuming role may not import another role's private implementation. TanStack route files remain in src/routes; implementation components may live in modules. Do not hand-edit routeTree.gen.ts.

## Shared core across separate repositories

The canonical source is ShorelineShopper-GMap/packages/localshore-core/src. Each repository carries an identical, checked-in snapshot at src/shared/core. This lets an app build from its own checkout without another repository, an unpublished package, or a sibling filesystem path. Do not edit snapshots directly. From this workspace run npm run core:sync after a reviewed core change and npm run core:check to verify all three copies. From an app checkout run npm run check:boundaries. Shared release PRs must identify the core version and coordinate changes across all consumer repositories. Synchronize compatible additive changes first; remove contracts only after all consumers migrate.

Full generated Supabase schemas remain in each app's existing integrations/supabase/types.ts. They reflect different generation histories and must not be merged by hand. The core provides common contracts and a generic typed database-row adapter, not a fabricated replacement schema. Regenerate schemas from the same verified database revision in a separate coordinated change.

## Authentication and data

Reuse Supabase Auth, user_roles activation status, and Admin permission RPCs. Role-specific hooks adapt the shared identity to each app. Authentication never grants Admin access by itself. Browser sessions on separate origins are not automatically single sign-on. Never pass tokens through URLs.

Use the existing orders/order_items, products, sellers/stores, delivery_assignments, notification infrastructure, and protected support RPCs. Module separation does not authorize table changes, new databases, relaxed RLS, or alternate payment verification. Public discovery records in imported_shops are distinct from seller-managed inventory. Keep test checkout separate from real fulfillment.

## Git and pull requests

The repositories remain separate: locc (Shopper), VendorAdmin (Seller/Admin), DeliveryHub (Delivery/compatibility modules). Integration branch: refactor/localshore-module-boundaries. Use feature/shopper-*, feature/seller-*, feature/delivery-*, feature/admin-* branches from the appropriate repository's integration branch. Use feature/core-* for coordinated contract changes. Preserve existing history and uncommitted work. Do not force push connected Lovable branches.

Every PR identifies its module, affected shared contracts, compatibility exports, unchanged URLs, database impact, test results, and downstream consumers. Obtain review from each affected owner. A different role's view of the same entity is an adapter, not a new business table.

## Placement and compatibility

Put new role-only components, hooks, repositories, and services in src/modules/<role>. Put genuinely shared app-level adapters in src/shared; put cross-app pure contracts/utilities in the canonical core. Existing src/lib and other old paths may forward exports for compatibility. New implementation code should use module paths. Do not remove forwards until routes, external consumers, and tests have migrated. Server functions retain .server.ts or .functions.ts isolation and existing middleware. Never put service-role, Razorpay secret, Redis, or email credentials in VITE_* values. Map browser keys are public and need provider restrictions.

## Database migrations

SellerHub/supabase/migrations remains the declared authority for new schema work. Existing out-of-tree migrations are historical/deployment exceptions awaiting reconciliation. Do not concatenate directories, rename applied migrations, or apply a global db push to resolve ownership. See docs/module-refactor/migrations.md in each app. Reconcile remote applied history using a privileged database connection before any migration move. All schema/RLS/RPC changes require shared review.

## Verification

Run typecheck, check:boundaries, build, and the existing test suite after each extraction. Each app has a lint:modules command for the modular code. Full lint may report existing issues; record them separately. Root commands run the active GMap shopper. Run core:check for cross-repository releases. Verify legacy export resolution and route registrations. Workflow and RLS verification requires safe authenticated customer, seller, rider, and Admin identities; do not claim success from build/static checks alone. Do not create orders, dispatch riders, charge payments, or alter production roles merely to populate test fixtures.

The prebuild hook enforces module boundaries, route compatibility, historical migration identity, and core snapshot integrity. Architecture tests also preserve extracted runtime syntax trees against reviewed fixtures in docs/module-refactor/behavior-baseline.json. For an intentional business change, update only the affected fixture after owner review and add behavior tests; never regenerate all baselines just to silence a regression.

## Adding a feature

Choose the owning role; use existing entities and services; add neutral contracts only when another role consumes them; keep authorization in RLS/RPC/server checks; add relevant tests; then review any shared impact with the other owners. Shopper discovery remains 7 km by default and customer product visibility remains 5 km. Preserve stored GeoJSON coordinates and existing GPS throttling/offline behavior.
