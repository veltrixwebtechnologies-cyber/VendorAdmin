# Migration ownership and reconciliation

SellerHub/supabase/migrations owns new shared schema changes. Historical copies remain exactly where they were; nothing was moved, renamed, deleted, or applied in this refactor.

Local inventories: ShorelineShopper-GMap: 7; SellerHub: 128; Delivery Partner Hub: 19. Remote applied versions have NOT been verified: no privileged PostgreSQL migration-history connection was available to this audit. REST/OpenAPI absence does not establish database absence. Do not run db push until reconciliation is reviewed.

| Version | Local copies | Comparison |
| --- | --- | --- |
| 20260721130505 | ShorelineShopper-GMap/20260721130505_bb1b16af-1c87-4ac6-b62d-637885420c8d.sql<br>SellerHub/20260721130505_email_otps.sql | CONFLICT: different SQL; manual reconciliation required |
| 20260922000000 | ShorelineShopper-GMap/20260922000000_fix_legacy_notification_user_id.sql<br>SellerHub/20260922000000_localshore_shop_search_category_fix.sql | CONFLICT: different SQL; manual reconciliation required |
| 20261004190000 | ShorelineShopper-GMap/20261004190000_fix_shop_status_overload_ambiguity.sql<br>SellerHub/20261004190000_fix_rbac_product_moderation_guard.sql | CONFLICT: different SQL; manual reconciliation required |
| 20260901160000 | SellerHub/20260901160000_fix_vendor_delivery_partner_visibility.sql<br>Delivery Partner Hub/20260901160000_fix_vendor_delivery_partner_visibility.sql | Identical SQL; duplicate historical copies |
| 20260901170000 | SellerHub/20260901170000_ensure_available_delivery_partners.sql<br>Delivery Partner Hub/20260901170000_ensure_available_delivery_partners.sql | Identical SQL; duplicate historical copies |
| 20260901180000 | SellerHub/20260901180000_expand_delivery_zone_radius.sql<br>Delivery Partner Hub/20260901180000_expand_delivery_zone_radius.sql | Identical SQL; duplicate historical copies |
| 20260902000000 | SellerHub/20260902000000_automatic_immediate_order_dispatch.sql<br>Delivery Partner Hub/20260902000000_automatic_immediate_order_dispatch.sql | Identical SQL; duplicate historical copies |

Before any schema deployment:

1. Run the read-only linked-project migration list with an authorized maintainer, or query supabase_migrations.schema_migrations over a privileged database connection. Keep credentials out of output.
2. Match remote versions AND SQL identity to this inventory; record separately whether each API is public, private, intentionally undeployed, or stale in PostgREST cache.
3. Resolve conflicting versions with a forward, reviewed reconciliation migration if needed; never silently rename an applied version.
4. Reconcile out-of-tree imported-shop/payment/location changes before treating SellerHub alone as a complete deployment tree.
5. Apply only an approved forward migration set through the existing deployment process.

The baseline guard hashes every current historical SQL file. New schema work requires review, not copying app directories into each other. See migration-inventory.json for exact SHA-256 values.
