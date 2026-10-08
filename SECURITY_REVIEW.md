# LocalShore security review backlog

All items below are **Needs verification**, not confirmed vulnerabilities. Architecture extraction preserves existing checks and does not silently alter policy or workflow.

| Item | Evidence | Required verification |
| --- | --- | --- |
| Shopper role discovery ignores activation status | roles-store.ts reads role/status but maps only role | Trace consumers and check suspended/pending identities against guarded routes and database |
| Seller cache invalidation has no auth middleware | seller-mutations.server.ts invalidation endpoints lack requireSupabaseAuth | Check exposure, call volume, Redis configuration, and intended authorization |
| Location mirror field discrepancy | locationService.ts sends last_location_at; inspected API schema omitted it | Verify actual PostgreSQL columns, schema cache, update errors, and authoritative location RPC |
| Legacy Admin checks differ | admin-auth.ts and useIsAdmin differ from get_my_admin_access permission checks | Trace callers; verify suspended/delegated access and RLS |
| Private data isolation | Source RLS policies exist; no authenticated cross-account test in this refactor | Test customer A/B, seller A/B, rider A/B and ordinary-user Admin denial with safe identities |

Keep support evidence private, signed URLs short-lived, and real payment verification server-side. Separate origins require an explicit session design for SSO. No production mutation or automatic role changes are authorized by this review.
