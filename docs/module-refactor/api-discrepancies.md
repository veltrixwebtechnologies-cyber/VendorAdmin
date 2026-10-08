# API/schema discrepancies — needs verification

Previous read-only server API inspection did not expose these objects. This is not evidence they are absent in PostgreSQL. No replacement endpoints were created. No grants, schema-cache reloads, or deployments were performed.

| Object | References in local migration SQL | Remote/deployment state |
| --- | --- | --- |
| vendor_accept_order | SellerHub/20260906000000_vendor_approval_and_live_location.sql | Needs verification in PostgreSQL catalogs, applied history, permissions, and PostgREST cache |
| vendor_order_live_locations | SellerHub/20260906000000_vendor_approval_and_live_location.sql | Needs verification in PostgreSQL catalogs, applied history, permissions, and PostgREST cache |
| refunds | SellerHub/20261004100000_admin_rbac_and_audit.sql<br>SellerHub/20261004110000_admin_rbac_policy_hardening.sql<br>SellerHub/20261004170000_phase_c_finance_refunds.sql<br>SellerHub/20261004180000_phase_c_refund_accounting_customer_eligibility.sql | Needs verification in PostgreSQL catalogs, applied history, permissions, and PostgREST cache |
| refund_status_events | SellerHub/20261004180000_phase_c_refund_accounting_customer_eligibility.sql | Needs verification in PostgreSQL catalogs, applied history, permissions, and PostgREST cache |
| seller_financial_adjustments | SellerHub/20261004180000_phase_c_refund_accounting_customer_eligibility.sql | Needs verification in PostgreSQL catalogs, applied history, permissions, and PostgREST cache |
| request_order_refund | SellerHub/20261004170000_phase_c_finance_refunds.sql | Needs verification in PostgreSQL catalogs, applied history, permissions, and PostgREST cache |
| admin_transition_refund | SellerHub/20261004170000_phase_c_finance_refunds.sql | Needs verification in PostgreSQL catalogs, applied history, permissions, and PostgREST cache |

An authorized database maintainer should inspect pg_proc, pg_class, schema permissions, and applied migration history. Then determine whether exposure is intended. Do not grant anonymous access or invent APIs to make a missing OpenAPI entry disappear.
