# Phase C — Finance, Refunds, Disputes

Status: locally implemented in part; all database changes are prepared only. No Supabase instance or payment gateway was contacted for this work. Runtime/RLS verification is pending.

## Existing finance architecture found

- Razorpay is the existing prepaid gateway. `payment_attempts` persists provider, provider order/payment identifiers, INR amount, paise amount, status, and a raw payload. The existing server functions create and verify payments and finalize verified captures.
- No Razorpay refund API adapter, refund ID, gateway refund webhook, or webhook event ledger existed. No successful gateway refund can be claimed by the current application.
- Orders store `payment_method` (`upi`, `card`, `cod`), order/payment statuses, total, seller, and customer. COD is an order payment method and must not be treated as a Razorpay capture.
- Seller earnings/payout data is stored in `settlements` and remains owned by `seller_id` / seller `user_id`. Settlement data is cycle-level aggregate data; it does not provide reliable order allocations.
- The platform has `platform_settings.commission_percent`, but the current client-side settlement display had been synthesizing earnings and fees rather than reading persisted statements. The Seller Hub now reads persisted settlement records only. No new commission calculation was invented.
- Support tickets already link to orders, sellers, issue categories, workflow stage, and `support_case_events`. Phase C reuses those cases for disputes instead of adding another communication/ticket system.
- Phase A audit logs and permission checks are reused. `refunds.approve` was missing locally and is added through this new migration for SUPER_ADMIN and FINANCE_ADMIN.

## Ownership and workflows

Seller remains the financial beneficiary. Store is optional operational attribution on a refund; it does not own a balance or payout. Existing payout ownership is not moved.

The prepared refund flow reserves requested, reviewing, approved, processing, and completed amounts against the order total while holding the order row to prevent concurrent over-refunds. Requests are idempotent per requester/key. Prepaid requests require a paid order and captured payment attempt. COD requests are only accepted after delivery and are marked manual; recording completion requires an actual manual reference. Gateway approval does not execute a refund. A future trusted server processor may report an actual gateway result through the service-role-only completion RPC.

Admin decisions use `refunds.manage`; approval/manual completion additionally requires `refunds.approve`. Refund records are not client-writable or deletable. The table trigger emits safe events into the existing append-only `admin_audit_logs` table. Payout hold/release uses a permission-checked RPC with a required hold reason and eligibility checks. Releasing a hold restores the prior pending/processing state; it does not mark a transfer paid.

Disputes remain order-linked Support Tickets. New safe summary/timeline RPCs require `support.view`; the timeline includes only persisted order, payment-attempt, support-event, and refund timestamps. Existing protected Support Console remains the communication/action surface.

## Implemented locally

- Finance domain helpers cover minor-unit money arithmetic, reserved refundable balance, status transitions, COD mode, payment/order reconciliation findings, and payout eligibility.
- Admin Payments now reports actual gateway attempts and captured amounts from persisted attempts, with explicit limited-record scope. It no longer calls delivered GMV "revenue" or cancellations "refunds".
- Admin Refunds lists/filter/paginates persisted requests; finance actions use RPCs. Gateway requests remain visibly unprocessed because no gateway refund API exists. COD completion requires a manually supplied real reference.
- Admin Order Disputes displays order-linked protected support cases and their recorded event timeline.
- Admin Reconciliation identifies payment-attempt/order status inconsistencies in bounded recent records; it does not fabricate accounting totals.
- Admin Payouts no longer directly updates settlements or labels a settlement paid. Authorized finance users may place/release holds through the RPC with confirmation and reason.
- Seller Hub settlement view reads persisted cycle totals and removes the previous client-generated fees, earnings, and automatic paid statuses. Order-level allocations remain unavailable.
- Customer order detail has a refund request/status panel guarded by `VITE_ENABLE_REFUNDS=true`; it is hidden by default. Requests use the authenticated order-refund RPC and server-side idempotency/amount validation. The application was not run against the configured Supabase project.
- `ShorelineShopper-GMap` now has the same opt-in customer flow plus a hard guard disabling it for the known Production Supabase reference. Eligibility, ownership, and status-event visibility are still enforced by authenticated database functions/RLS, not this UI guard.
- The customer panel shows requested amount, eligibility limit, status history, and review notes without claiming funds have reached a bank. Status history is prepared via `refund_status_events` and owner-scoped RLS.
- `ShorelineShopper-GMap/src/lib/razorpay-refunds.server.ts` defines a server-only injected Razorpay adapter/repository boundary, signature verifier, webhook parser, and transition/deduplication helpers. It is not wired to an endpoint and has no real HTTP transport, credentials, or provider calls.
- Seller refund deductions/recoveries are represented by `seller_financial_adjustments`. Exactly one matching settlement cycle permits automatic attribution; ambiguity is explicitly unallocated and blocks payout eligibility. Already-paid settlement history is preserved; recovery resolution remains a finance follow-up rather than an automatic bank debit.
- Reconciliation now classifies persisted payment/order mismatches, refund processing/failure and adjustment mismatches, duplicate/over-capture refunds, and payout eligibility findings. It remains limited by available persisted records and is not external gateway reconciliation.

## Prepared — database verification pending

Migration: `supabase/migrations/20261004170000_phase_c_finance_refunds.sql`.

It adds the `refunds` table and indexes; approval permission mappings; hold columns/status for settlements; authenticated request/decision/manual-COD RPCs; a service-role-only gateway-result RPC; payout eligibility and hold RPCs; refund audit trigger; and read-only order-dispute summary/timeline RPCs. It is not applied or database-verified.

Extension migration: `supabase/migrations/20261004180000_phase_c_refund_accounting_customer_eligibility.sql`.

It adds a one-open-refund-per-order unique guard, owner-checked customer eligibility RPC, customer-safe `refund_status_events` timeline, seller refund-adjustment ledger and audit event, adjustment-aware payout eligibility, and a service-role-only Razorpay webhook event ledger/RPC. It also extends the support dispute timeline with actual dispatch/order timestamps only, and revokes external execution of the older direct completion helper so the future trusted webhook path is the completion authority. It is prepared only and requires 20261004170000 first.

The extension preflight checks that delivery assignments, tracking, and the exact persisted timestamp columns referenced by the dispute timeline exist. Review the local delivery migrations if preflight reports a missing column; do not bypass the guard by weakening it.

### Local prerequisite/dependency order

The source tree contains the Razorpay payment-attempt migration locally, but a Supabase project may not have applied it. The Production SQL Editor diagnostic returned `payment_attempts = NULL`; no attempt was made here to inspect or change that database. The Phase C preflight now reports this specific dependency rather than combining it with unrelated RBAC requirements.

For a future, explicitly authorized **non-production** application, review the existing migration history and establish these prerequisites in order before `20261004170000_phase_c_finance_refunds.sql`:

1. Base LocalShore schema, including `orders`, `sellers`, and settlements/status (the repository baseline includes `20260722043421_14cd7471-6a25-4c69-aadb-53927139f0d9.sql`).
2. Support event schema (`20260729000004_support_case_flow.sql`) and protected order-linked support columns (`20260929000000_protected_customer_vendor_support.sql`).
3. Razorpay payment-attempt schema (`20260909160000_razorpay_payment_integration.sql`). This creates `payment_attempts` and its capture RPCs; it does not add refund execution.
4. Phase A RBAC/audit (`20261004100000_admin_rbac_and_audit.sql`, then `20261004110000_admin_rbac_policy_hardening.sql`).
5. Phase B Store foundation and domain link (`20261004130000_phase_b_store_foundation.sql`, then `20261004140000_phase_b_store_domain.sql`), which provide `stores` and `orders.store_id`.
6. Phase B service-zone/runtime prerequisites (`20261004150000_phase_b_service_zones.sql`, then `20261004160000_phase_b_commerce_runtime.sql`) when that environment is following the complete Phase B chain.
7. Phase C finance/refunds (`20261004170000_phase_c_finance_refunds.sql`).
8. Phase C customer eligibility/accounting/webhook ledger (`20261004180000_phase_c_refund_accounting_customer_eligibility.sql`), after confirming the delivery timeline timestamp prerequisites.

Timestamp order is not proof that a project actually applied an earlier migration. Before any future application, an authorized operator must inspect the _non-production target's_ migration history and schema. Do not fill gaps by running this sequence against Production. No migration was executed as part of the current local work.

## Not implemented / remaining limitations

- No configured gateway refund executor, Razorpay API call, provider-side idempotency implementation, or deployed/wired refund webhook route. A server-side injected adapter boundary and signature/event processing contract are prepared only. Future endpoint must validate the raw-body signature, persist/deduplicate provider event IDs atomically, map only matching gateway refund IDs, and use the webhook RPC. Never show approval or provider acceptance as completed refund.
- Customer refund UI exists in the specified `ShorelineShopper-GMap` app, remains disabled by default, and is also hard-disabled for the known Production reference. Enable only against a confirmed non-production environment after applying and verifying both Phase C migrations there.
- COD reimbursements are manually recorded only; no bank/cash disbursement mechanism exists.
- Seller refund accounting is prepared as a separate adjustment ledger. A successful refund is allocated only when exactly one seller settlement cycle matches its order date; pre-payout deductions reduce effective payable, while post-payout recovery is recorded for finance review without rewriting paid history. Missing/ambiguous allocations block eligibility. A recovery resolution workflow and runtime verification remain pending.
- Commission rates are not recalculated. Existing platform configuration alone does not establish what rate was applied to each historical order.
- Reconciliation is a diagnostic consistency check, not external Razorpay settlement matching or a complete accounting ledger.
- Payout holds do not transfer funds. Actual bank payout execution and verification are out of scope.
- New routes, RPCs, RLS, enum change, audit trigger, and constraints need SQL application/static and authenticated runtime review. The migrations are prepared—not applied or database-verified. No Supabase or Razorpay endpoint was accessed during this work.

## Tests and validation

`tests/finance-domain.test.mjs` covers money bounds, refund eligibility/transitions, COD behavior, seller payable adjustments, reconciliation classifications, payout eligibility, and migration guardrails. `ShorelineShopper-GMap/tests/refund-gateway.test.mjs` uses mock transport only for mapping, signature, and duplicate-event guard tests. Build/typecheck/lint/test results do not substitute for database RLS or gateway verification.
