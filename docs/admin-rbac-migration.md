# LocalShore Admin RBAC — Manual Migration and Verification

This guide covers the local Phase A RBAC migrations. They have **not** been applied or verified against a database. No secrets belong in this file.

## Migration files and prerequisites

Apply these migrations in this order:

1. `supabase/migrations/20261004100000_admin_rbac_and_audit.sql`
2. `supabase/migrations/20261004110000_admin_rbac_policy_hardening.sql`

The first migration creates the role/permission tables, the admin assignment table, the permission function, audit storage/triggers, and guarded admin-management/audit RPCs. It backfills active `user_roles.role = 'admin'` accounts as `SUPER_ADMIN` assignments. The second migration refreshes the reviewed permission mapping and changes the existing admin RLS policies to permission-scoped policies.

Before applying, confirm the target database already has the referenced core LocalShore schema and migrations: `app_role`, `user_roles.status`, `profiles`, `sellers`, `seller_documents`, `products`, `orders`, `order_items`, `settlements`, `payment_attempts`, the catalog/promotion tables used by enabled features, delivery tables, and `auth.users`. `localshore_offer_cards` is optional and the policy migration now skips its policy block if that table is absent. Do not blindly apply unrelated pending demo/seed migrations to production to satisfy a missing prerequisite. Resolve schema drift first.

Take a restorable database backup/snapshot, confirm you are connected to the intended Supabase project, and schedule a maintenance window if the admin console is actively used. These migrations are additive/restrictive, but they change authorization decisions. Apply the complete first SQL file, verify its result, then apply the complete second SQL file. In Supabase Dashboard, use **SQL Editor → New query**, paste each whole file in order, and run it. Both files use explicit transactions. If a run errors before `COMMIT`, do not rerun the first migration blindly; check whether the transaction rolled back and inspect `pg_policies` before retrying the failed migration. Review the result for errors; do not continue after a partial/failing query.

## Expected compatibility behavior

Only active rows in `user_roles` with the actual `admin` enum value are backfilled. Signup metadata, profile text fields, email address, or a client-supplied role are not treated as proof of admin access. Existing active legacy admins become `SUPER_ADMIN`; inactive legacy admin rows are not elevated. Once an `admin_access_assignments` row exists, it is authoritative: suspended assignments and non-Super-Admin roles do not inherit legacy `has_role(..., 'admin')` access. The compatibility helper treats legacy admin as Super Admin only when no assignment exists, for safe rollout of any legitimate legacy row missed by the backfill.

Admin assignment creation/changes use `set_admin_access(...)`, require an authenticated Super Admin plus a reason, and cannot directly create Auth identities. Assignment rows cannot be directly inserted/updated/deleted by authenticated clients. Removal/deactivation of the final active Super Admin is serialized with a transaction advisory lock and rejected by the database.

## Verification queries

### Test identity inventory (read only)

Before running identity-bound checks, inventory existing admin assignments. This query returns user UUIDs but no email addresses; keep the results private and do not post them in screenshots. Do not create or modify assignments in production just to populate a role.

```sql
select role, status, user_id
from public.admin_access_assignments
order by role, status, user_id;

select 'seller' as identity_type, count(distinct user_id) as available_accounts
from public.sellers
union all
select 'delivery_partner', count(distinct user_id)
from public.delivery_partners
union all
select 'ordinary_customer_candidate', count(*)
from auth.users u
where not exists (select 1 from public.admin_access_assignments a where a.user_id = u.id)
  and not exists (select 1 from public.sellers s where s.user_id = u.id)
  and not exists (select 1 from public.delivery_partners d where d.user_id = u.id);
```

Use only known, non-production test accounts for the authenticated role checks. If a role has no safe assigned test identity, record its checks as **NOT TESTED — SAFE TEST IDENTITY REQUIRED**. Do not promote, demote, or otherwise edit a production account to create a fixture.

## Permission/RLS coverage found in this repository

The legacy schema models the vendor's business and physical shop on the same `sellers` row; this work does not add a separate Store entity. Inventory is stored on `products.stock`, not a separate inventory table. No verified gateway refund-execution workflow was found; changing an order to `returned` is not proof that money was refunded.

| Resource                       | Existing access shape before RBAC                          | Legacy dependency                       | Permission after migration                                                                    | Read / insert / update / delete                                                         |
| ------------------------------ | ---------------------------------------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Sellers and documents          | Owner access plus named admin policies                     | `has_role(..., 'admin')`                | `sellers.view`; update requires `sellers.manage`, `sellers.approve`, or `sellers.suspend`     | Owner submission preserved; admin read/update scoped; no new delete                     |
| Products / images              | Owner, public active catalog, named admin policies         | Legacy admin read/update/delete         | `products.view` or `inventory.view`; updates require `products.manage` or `products.moderate` | Read/update scoped; admin delete removed                                                |
| Categories, brands, filters    | Public active rows plus broad admin access                 | Legacy admin `FOR ALL`                  | `categories.view/manage`                                                                      | Public active read preserved; admin read/insert/update split; no new delete             |
| Orders / items                 | Buyer/seller/delivery ownership plus admin policies/RPCs   | Legacy admin policies and RPCs          | `orders.view/manage`                                                                          | Owner/participant policies preserved; admin read/update split; admin delete removed     |
| Settlements / payment attempts | Seller reads and admin settlement access                   | Legacy admin policies                   | `payouts.view/manage`, `payments.view`                                                        | Seller access preserved; admin SELECT/UPDATE split; no admin INSERT/DELETE              |
| Profiles / customer status     | Self access plus admin directory/block actions             | Legacy admin policies                   | `customers.view/manage`                                                                       | Self access preserved; admin read and block mutations split                             |
| Reviews                        | Public approved and author access plus admin `FOR ALL`     | Legacy admin policy                     | `reviews.view/moderate`                                                                       | Public/author reads preserved; admin read/update split; admin delete removed            |
| Support cases/messages         | Customer/seller/delivery participants plus privileged RPCs | Legacy admin branch                     | `support.view/manage`                                                                         | Participant access preserved; admin workflows use guarded RPCs                          |
| Promotions / notifications     | Public active rows plus broad admin policies               | Legacy admin policies                   | `promotions.view/manage`, `notifications.view/manage`                                         | Public reads preserved; admin read/insert/update split; no admin delete                 |
| Dispatch                       | Delivery-partner ownership and admin workflow functions    | Raw legacy role checks in dispatch RPCs | `dispatch.view/manage`                                                                        | Partner scope preserved; admin reads and workflow RPCs permission-checked               |
| Platform settings              | Public read and admin update                               | Legacy admin policy                     | `settings.manage`; `commissions.manage` is restricted to commission field                     | Public read preserved; RLS plus field-check trigger protects updates                    |
| Admin assignments / audit      | New RBAC objects                                           | N/A                                     | `admins.view/manage`, `audit.view`                                                            | Assignments via guarded RPC; direct client writes revoked; audit append-only to clients |

Historical policies not explicitly replaced by the second migration continue to use the hardened compatibility helper and therefore remain Super-Admin-only. This intentionally fails closed but means delegated access is not enabled for every historical/secondary admin screen. Verify those modules before assigning roles that require their access.

Run these read-only queries after both migrations. First, confirm the expected permissions and role grants:

```sql
select role, count(*) as permission_count
from public.admin_role_permissions
group by role
order by role;

select role, permission
from public.admin_role_permissions
order by role, permission;
```

Confirm existing admins were mapped, and that at least one active Super Admin remains:

```sql
select u.email, a.role, a.status, a.created_at
from public.admin_access_assignments a
join auth.users u on u.id = a.user_id
order by a.created_at;

select count(*) as active_super_admins
from public.admin_access_assignments
where role = 'SUPER_ADMIN' and status = 'active';

select u.email as legacy_admin_missing_assignment
from public.user_roles r
join auth.users u on u.id = r.user_id
left join public.admin_access_assignments a on a.user_id = r.user_id
where r.role = 'admin'::public.app_role and r.status = 'active'
  and a.user_id is null;
```

The last query should return no rows for a fully backfilled database. Never repair it by assigning every user Super Admin; investigate each returned legacy admin account.

Check the permission helper, audit objects, RPC grants, and the critical policy set:

```sql
select to_regclass('public.admin_audit_logs') as audit_table,
       to_regclass('public.admin_access_assignments') as assignments_table,
       to_regprocedure('public.has_admin_permission(text)') as permission_function,
       to_regprocedure('public.set_admin_access(uuid,text,text,text)') as assignment_rpc,
       to_regprocedure('public.list_admin_audit_logs(text,text,text,timestamptz,timestamptz,text,integer,integer)') as audit_rpc;

select schemaname, tablename, policyname, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('sellers','seller_documents','products','categories','brands','orders',
    'order_items','settlements','payment_attempts','profiles','user_status','reviews','coupons',
    'banners','platform_settings','admin_access_assignments','admin_audit_logs')
order by tablename, policyname;

select routine_name, privilege_type, grantee
from information_schema.routine_privileges
where routine_schema = 'public'
  and routine_name in ('get_my_admin_access','list_admin_users','find_admin_account',
    'set_admin_access','list_admin_audit_logs','has_admin_permission')
order by routine_name, grantee, privilege_type;
```

For identity-bound permission checks, use an isolated SQL Editor transaction and a **known test account UUID**. Replace the UUID; do not use a production customer's identity for mutation tests. Supabase SQL Editor may restrict `SET ROLE`; if so, run the same checks in a disposable local Supabase instance or through the authenticated app session.

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'REPLACE_WITH_TEST_USER_UUID', true);
select public.get_my_admin_access();
select public.has_admin_permission('audit.view') as can_read_audit;
select public.has_admin_permission('finance.view') as unknown_legacy_permission_is_denied;
rollback;
```

The old `finance.view` name is intentionally not part of the refreshed mapping; `has_admin_permission` must return false for it. Use the permission names listed in the migration for positive/negative role checks.

Test role boundaries using existing test identities assigned to each role, never by editing a production account solely for testing:

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'REPLACE_WITH_FINANCE_ADMIN_UUID', true);
select public.has_admin_permission('payments.view') as finance_can_view_payments,
       public.has_admin_permission('sellers.manage') as finance_cannot_manage_sellers,
       public.has_admin_permission('payouts.manage') as finance_can_manage_payouts;
rollback;
```

Repeat with Seller Manager, Support Agent, Analyst, ordinary customer, and seller identities. Expected checks include:

- Customer/seller without an admin assignment: `admins.view`, `admins.manage`, `audit.view`, and all admin data permissions are false.
- Finance Admin: payment/refund/payout/commission permissions are true; seller management, settings, and admin management are false.
- Seller Manager: seller/store permissions are true; payout and settings management are false.
- Support Agent: support read/manage and customer/order/review read are true; settings, payouts, and admin management are false.
- Analyst: assigned read-only analytics/report/order/product/category/inventory/payment/payout/review permissions are true; seller-private access and all mutation permissions are false.

To prove RPC denial, invoke `list_admin_audit_logs` and `set_admin_access` under ordinary-user claims inside separate transactions; both must raise authorization errors. Roll back each test. To verify direct audit-table isolation, attempt a `SELECT` under ordinary-user claims: it must return no rows (or a permission denial). Authenticated INSERT/UPDATE/DELETE on audit logs and admin assignments must remain unavailable.

Confirm seller/customer isolation with existing authenticated tests: Seller A must only see/update Seller A's products, orders, and settlements; customers must only see their own private records. The new admin read policies are additional permission checks and must not remove existing owner/participant policies.

## RBAC test matrix

| Capability                           | Super Admin | Operations | Seller Manager | Catalog | Finance | Support | Marketing |   Analyst |
| ------------------------------------ | ----------: | ---------: | -------------: | ------: | ------: | ------: | --------: | --------: |
| Dashboard                            |         Yes |        Yes |            Yes |     Yes |     Yes |     Yes |       Yes |       Yes |
| Approve/suspend seller               |         Yes |         No |            Yes |      No |      No |      No |        No |        No |
| Manage store/seller record           |         Yes |         No |            Yes |      No |      No |      No |        No |        No |
| Manage products/categories/inventory |         Yes |         No |             No |     Yes |      No |      No |        No | Read-only |
| Manage orders                        |         Yes |        Yes |             No |      No |      No |      No |        No |        No |
| View payments/payouts                |         Yes |         No |             No |      No |     Yes |      No |        No | Read-only |
| Manage payouts/commissions/refunds   |         Yes |         No |             No |      No |     Yes |      No |        No |        No |
| View/manage support                  |         Yes |  View only |             No |      No |      No |     Yes |        No |        No |
| Manage promotions/notifications      |         Yes |         No |             No |      No |      No |      No |       Yes |        No |
| Dispatch view/manage                 |         Yes |        Yes |             No |      No |      No |      No |        No |        No |
| Manage platform settings             |         Yes |         No |             No |      No |      No |      No |        No |        No |
| Manage admin assignments             |         Yes |         No |             No |      No |      No |      No |        No |        No |
| Read audit logs                      |         Yes |         No |             No |      No |      No |      No |        No |        No |

The database mapping in `admin_role_permissions` is authoritative; this table is a human-readable summary. Permission granularity in RLS/RPCs is the security boundary, not navigation visibility.

## Rollback considerations

Do not drop the new RBAC/audit tables or reverse the legacy helper as a quick rollback after assignments have been created; that can silently restore privileges to stale legacy admin rows. If migration application fails, stop and retain the error. For a planned rollback, first disable delegated assignments through the authorized database path, verify existing active legacy Super Admin identities, then use a reviewed forward-fix migration. Audit history should be retained. Restore from the pre-migration snapshot only with an explicit recovery plan.

## Current validation status

As of 2026-10-04, the project owner reports that both migrations were run in the target Supabase project. SQL Editor screenshots confirm the eight permission mappings are present, there is one active Super Admin and no active legacy admin missing an assignment, the core RBAC tables/functions exist, and the inspected policies include permission-scoped admin order/audit/assignment rules alongside customer and delivery-partner order policies. These are user-provided observations, not a direct database session from this worktree.

This environment has neither the Supabase CLI nor `psql`, and no target database credentials/session are available here. Therefore authenticated role-boundary tests, last-Super-Admin RPC behavior, ordinary-user denial, direct audit-table write denial, and seller/customer cross-account isolation are **not independently verified**. Complete the identity-bound checks below against existing safe test accounts before treating Phase A as fully verified.
