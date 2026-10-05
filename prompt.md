# LOCALSHORE ADMIN PANEL — COMPLETE PRODUCTION-READY IMPLEMENTATION

Enhance the existing **LocalShore Admin Panel** into a professional, scalable, production-ready administration and marketplace operations system for the LocalShore hyperlocal multi-vendor commerce platform.

LocalShore connects:

**Customers → Nearby Local Stores → Products → Orders → Payments → Delivery**

The Admin Panel must act as the **central control tower for the entire LocalShore marketplace**.

---

# 1. CRITICAL — INSPECT THE EXISTING PROJECT FIRST

Before writing or modifying code, inspect the complete existing LocalShore project.

Identify all existing:

- Admin pages
- Admin routes
- Admin components
- Seller Hub
- Customer functionality
- Authentication
- Roles
- Database models
- APIs
- Products
- Categories
- Inventory
- Orders
- Payments
- Seller earnings
- Payout functionality
- Refund functionality
- Store settings
- Google Maps integration
- Store latitude/longitude
- Customer location
- Delivery functionality
- Customer-care functionality
- Notifications
- Existing analytics
- Existing dashboard cards/charts
- Environment variables
- Backend services

Create an internal implementation map before making changes.

DO NOT recreate functionality that already exists.

If something already exists:

1. Reuse it.
2. Improve it.
3. Connect it properly to the Admin Panel.
4. Fix incomplete implementations.
5. Preserve existing working APIs/data structures whenever reasonable.

Do not break the:

- Customer application
- Seller Hub
- Authentication system
- Existing APIs
- Existing database data
- Existing Google Maps implementation
- Existing LocalShore design system

Do not use fake/hardcoded dashboard data when real data exists.

---

# 2. DESIGN REQUIREMENTS

Keep the existing **LocalShore branding, colors, typography and visual language**.

Upgrade the Admin Panel into a clean modern SaaS/marketplace operations interface.

The interface should feel comparable in quality to professional commerce, delivery and marketplace administration systems.

Use:

- Clean sidebar navigation
- Top navigation/header
- Global search
- Clear page titles
- Breadcrumbs where useful
- KPI cards
- Tables
- Filters
- Search
- Pagination
- Status badges
- Charts
- Drawers
- Modals
- Confirmation dialogs
- Tooltips
- Empty states
- Skeleton loading
- Error states
- Toast notifications
- Responsive layouts

Avoid unnecessary gradients, excessive cards, huge whitespace and decorative UI that does not help operations.

Prioritize information density and usability.

Support:

- Desktop
- Laptop
- Tablet
- Mobile

---

# 3. ADMIN NAVIGATION

Organize the sidebar approximately like this:

LOCALSHORE ADMIN

Overview

OPERATIONS
- Orders
- Live Orders
- Returns & Refunds
- Issues / Disputes

MARKETPLACE
- Sellers
- Seller Approvals
- Stores
- Products
- Product Approvals
- Categories
- Inventory Alerts

CUSTOMERS
- All Customers
- Customer Activity
- Reviews
- Reports / Blocks

DELIVERY
- Delivery Partners
- Delivery Zones
- Live Tracking
- Delivery Performance

FINANCE
- Transactions
- Seller Earnings
- Commissions
- Payouts
- Refunds
- Reconciliation

GROWTH
- Coupons
- Offers
- Banners
- Notifications
- Featured Stores

SUPPORT
- Support Tickets
- Complaints
- Seller Support
- Customer Care

ANALYTICS
- Sales
- Orders
- Customers
- Sellers
- Products
- Geographic
- Search Analytics
- Reports

ADMINISTRATION
- Admin Users
- Roles & Permissions
- Audit Logs
- System Settings
- Integrations
- Platform Health

Hide sections that are not implemented yet instead of creating fake functionality.

---

# 4. ADMIN OVERVIEW / ACTION CENTER

Redesign the main dashboard to answer:

**What is happening on LocalShore right now and what requires admin attention?**

Show real KPIs such as:

- GMV
- Platform revenue
- Orders today
- Active orders
- Completed orders
- Cancelled orders
- Active stores
- Offline stores
- Active sellers
- Total customers
- Average order value
- Cancellation rate
- Refund rate

Add comparison against:

- Yesterday
- Previous 7 days
- Previous 30 days

where appropriate.

Create an important:

## ACTION REQUIRED

Examples:

- Sellers waiting for approval
- Products awaiting approval
- Delayed orders
- Refund requests
- Customer complaints
- Failed payouts
- Stores offline unexpectedly
- Low-stock products
- Failed payments

Each card must navigate directly to the filtered relevant page.

Also show:

- Sales trend
- Orders trend
- Top stores
- Top products
- Top categories
- Recent orders
- Seller performance
- Area performance

Do not overload the dashboard.

---

# 5. SELLER MANAGEMENT

Create a powerful seller management system.

Seller table fields:

- Store / Business name
- Seller/owner
- Phone
- Email
- Location
- Category
- Number of products
- Orders
- Revenue / GMV
- Rating
- Verification
- Account status
- Joined date

Filters:

- Active
- Pending approval
- Rejected
- Suspended
- Offline
- Incomplete verification
- High cancellation rate
- Low rating

Add search by:

- Seller name
- Store name
- Phone
- Email
- Seller ID

Clicking a seller opens:

## SELLER 360°

Sections:

### Profile
- Business name
- Owner
- Phone
- Email
- Business details
- Verification/KYC information
- Bank/payout information
- Joining date

Mask sensitive information unless the admin role has permission.

### Store Information
- Store name
- Address
- Latitude
- Longitude
- Google Place ID if available
- Operating hours
- Service radius
- Current status

### Performance
- Orders
- GMV
- Revenue
- Acceptance rate
- Cancellation rate
- Refund rate
- Average preparation time
- Rating
- Products
- Out-of-stock percentage

### Activity
Show seller activity/history.

Admin actions:

- Approve
- Reject
- Request information
- Suspend
- Unsuspend
- Disable temporarily
- Edit allowed store information
- View products
- View orders
- View transactions
- View complaints
- Configure commission where authorized

Every sensitive action must require confirmation.

---

# 6. SELLER APPROVAL WORKFLOW

Create a structured seller onboarding workflow.

Statuses:

Draft

↓

Submitted

↓

Under Review

↓

Action Required

↓

Approved / Rejected

↓

Suspended if required later

Admin verification checklist can include:

- Phone verified
- Email verified
- Business information
- Store location
- Required documents
- Bank/payout information

Clearly show why an application is blocked.

Allow admins to:

- Approve
- Reject with reason
- Request additional information
- Add internal notes

Never silently reject a seller.

---

# 7. SEPARATE SELLERS AND STORES

Architect the system so:

**Seller = account/business owner**

**Store = physical/local marketplace location**

Avoid assuming one seller can only ever have one store.

Support architecture such as:

Seller

→ Gandhipuram Store

→ Peelamedu Store

→ Saravanampatti Store

Do not unnecessarily rewrite the existing database if this relationship already exists differently.

Make changes safely and incrementally.

---

# 8. STORE MANAGEMENT

Create a centralized Stores page.

Show:

- Store
- Seller
- Category
- Address
- Location
- Service radius
- Operating hours
- Current status
- Product count
- Order count
- Rating

Store status examples:

- Open
- Closed
- Offline
- Temporarily disabled
- Suspended
- Pending verification

Admin actions:

- View
- Edit permitted details
- Open/close when authorized
- Temporarily disable
- Correct map location
- Change service radius
- Feature store
- Suspend

---

# 9. GOOGLE MAPS / GEOGRAPHIC CONTROL CENTER

LocalShore is location-driven, so create a dedicated marketplace map.

Reuse the existing Google Maps integration and API configuration.

DO NOT add another map provider.

Display LocalShore-specific operational information instead of unnecessary generic map clutter wherever possible.

Markers:

- Active store
- Offline store
- Pending store
- Suspended store
- Active order where applicable

Allow filters by:

- Category
- Seller status
- Store status
- Area
- Service zone

Clicking a store marker should show:

- Store
- Rating
- Orders today
- Status
- Service radius
- Product count
- View Store action

Store location data should support:

- Latitude
- Longitude
- Formatted address
- Google Place ID where available
- Service radius
- Verification state

If technically appropriate, track location source such as:

- GOOGLE_PLACE
- SELLER_GPS
- ADMIN_SELECTED
- MANUAL

Do not expose private customer locations unnecessarily.

---

# 10. SERVICE ZONES

Create service-zone management.

Prepare LocalShore to support areas/hubs such as:

- Gandhipuram
- Saravanampatti
- Peelamedu
- Singanallur
- Vadavalli

Do NOT hardcode these as permanent production zones.

Store them as configurable database entities.

Allow admin to:

- Create zone
- Rename
- Enable/disable
- Define service area
- Assign stores
- View stores in zone
- View order volume
- View customer demand

Design the system so polygon-based service areas can eventually be supported instead of only circular radius calculations.

---

# 11. PRODUCT MANAGEMENT

Create centralized product management.

Table:

- Image
- Product
- Seller/store
- Category
- MRP
- Selling price
- Stock
- Approval
- Publication status
- Created date

Filters:

- Published
- Unpublished
- Pending approval
- Rejected
- Out of stock
- Low stock
- Flagged

Actions:

- View
- Edit when authorized
- Approve
- Reject with reason
- Unpublish
- Flag
- Feature

Avoid destructive deletion where unpublishing/archive is safer.

---

# 12. PRODUCT MODERATION

Support product approval workflows.

Example:

Seller creates product

↓

Pending Review

↓

Approved

↓

Published

Prepare the architecture for future seller trust levels:

Trusted seller → automatic publishing

New seller → approval required

Flagged seller → manual approval required

Do not implement unnecessary complexity if the existing project is not ready for this yet.

---

# 13. CATEGORY MANAGEMENT

Admin should control marketplace taxonomy.

Support:

- Parent categories
- Subcategories
- Category name
- Slug
- Icon/image
- Display order
- Active/inactive
- Category attributes
- Optional commission configuration

Example:

Fashion

→ Men's Fashion

→ Shirts

→ T-Shirts

→ Trousers

Prevent sellers from arbitrarily creating duplicate marketplace categories.

---

# 14. INVENTORY MONITORING

Seller manages inventory.

Admin monitors marketplace inventory health.

Show:

- Out-of-stock products
- Low-stock products
- Inactive products
- Inventory inconsistencies if detectable

Filters:

- Seller
- Store
- Category
- Product
- Area

Create configurable low-stock thresholds where appropriate.

---

# 15. ORDER MANAGEMENT

Create a complete platform-wide order management page.

Show:

- Order ID
- Customer
- Store
- Seller
- Amount
- Payment status
- Order status
- Delivery status
- Created time

Support order lifecycle similar to:

Placed

↓

Accepted

↓

Preparing

↓

Ready

↓

Picked Up

↓

Out for Delivery

↓

Delivered

Also support:

- Cancelled
- Failed
- Refunded
- Disputed

Use the existing project's actual order statuses where possible.

Do not create duplicate status systems unnecessarily.

---

# 16. ORDER DETAILS / TIMELINE

Clicking an order must show a complete order 360° page.

Include:

- Items
- Customer
- Store
- Seller
- Payment
- Pricing breakdown
- Delivery details
- Refunds
- Support tickets
- Notes

Create chronological event timeline:

Order placed

Payment successful

Seller notified

Seller accepted

Preparing

Ready

Delivery assigned

Picked up

Delivered

Cancelled/refunded events where applicable.

---

# 17. LIVE ORDER CONTROL CENTER

Create a dedicated operational view for active orders.

Columns/stages could include:

- New
- Accepted
- Preparing
- Ready
- Delivery Assigned
- Out for Delivery
- Delayed

Highlight problematic orders:

- Seller hasn't accepted
- Preparation delayed
- Delivery not assigned
- Delivery delayed
- Payment issue
- Customer issue

Do not invent delivery data if delivery functionality does not exist yet.

---

# 18. CUSTOMER MANAGEMENT

Create a customer management page.

Show:

- Customer
- Phone
- Email
- Area
- Orders
- Total spend
- Last order
- Account status

Customer profile:

- Basic account information
- Order history
- Saved addresses where authorized
- Payments
- Refunds
- Reviews
- Support tickets
- Coupon usage
- Account activity

Admin actions must be permission-controlled.

Possible actions:

- Block
- Unblock
- View orders
- View support history
- Issue refund where authorized
- Apply account/store credit only if such functionality exists

Protect customer PII.

---

# 19. REVIEWS & RATINGS

Create centralized review moderation.

Support:

- Product reviews
- Store reviews
- Delivery reviews if delivery ratings exist

Admin actions:

- View
- Flag
- Hide
- Restore
- Remove when policy allows

Store moderation reason and admin identity.

---

# 20. FINANCIAL CONTROL CENTER

Create a Finance section.

It must clearly distinguish:

- GMV
- Seller earnings
- LocalShore commission
- Taxes
- Delivery charges
- Discounts
- Refunds
- Adjustments
- Net payable

Every financial amount must be traceable to the relevant transaction/order.

Never allow silent manual balance changes.

---

# 21. TRANSACTIONS

Create transaction history.

Fields:

- Transaction ID
- Order
- Customer
- Seller
- Amount
- Payment provider
- Payment method
- Status
- Timestamp
- Gateway/reference ID

Statuses could include:

- Pending
- Successful
- Failed
- Refunded
- Partially refunded

Use actual gateway statuses where available.

---

# 22. COMMISSION MANAGEMENT

Do not hardcode LocalShore commissions.

Create configurable:

- Default marketplace commission
- Category commission
- Seller-specific commission where required

Example hierarchy:

Seller-specific override

↓

Category commission

↓

Default commission

Clearly define precedence.

Commission changes must be audited.

Do not retroactively alter completed transaction calculations.

---

# 23. SELLER PAYOUTS

Create payout management.

Show:

- Seller
- Settlement period
- Sales
- Commission
- Refunds
- Adjustments
- Net payable
- Payout status

Statuses:

- Pending
- Processing
- Paid
- Failed
- On Hold

Store:

- Bank/payment reference
- UTR/reference number
- Settlement period
- Included orders
- Deductions
- Commission
- Refunds
- Net payout

Payout actions require appropriate Finance permission.

---

# 24. REFUNDS

Create refund management.

Workflow:

Requested

↓

Reviewing

↓

Approved / Rejected

↓

Processing

↓

Refunded

Display:

- Customer reason
- Order
- Products
- Seller response
- Evidence/images where supported
- Order timeline
- Payment details
- Previous refunds

Admin must provide reason when approving/rejecting manually.

---

# 25. DELIVERY MANAGEMENT

If delivery functionality already exists, enhance it.

Otherwise build the architecture cleanly without fake delivery data.

Prepare sections for:

- Delivery partners
- Active deliveries
- Delivery zones
- Delivery charges
- Delivery performance

Metrics:

- Average delivery time
- Late deliveries
- Successful deliveries
- Failed deliveries
- Acceptance rate

---

# 26. COUPONS & OFFERS

Create promotion management.

Support:

- Percentage discount
- Fixed discount
- Free delivery
- First-order offer
- Store-specific
- Category-specific
- Minimum order
- Maximum discount
- Usage limit
- Start/end date

Track:

- Usage
- Orders generated
- GMV generated
- Discount cost
- New customers
- Repeat customers

---

# 27. HOMEPAGE / CONTENT MANAGEMENT

Allow admins to manage LocalShore marketplace content without code deployments.

Support:

- Hero banners
- Promotional banners
- Featured categories
- Featured stores
- Featured products
- Collections
- Announcements

Allow ordering/reordering.

Changes should use existing frontend APIs/components wherever possible.

---

# 28. NOTIFICATION CENTER

Create centralized notification management.

Use existing notification infrastructure.

Possible channels:

- In-app
- Push
- Email
- SMS
- WhatsApp only if properly integrated

Audience targeting:

- All customers
- Sellers
- Selected sellers
- Selected customers
- Area
- Store
- Customer segments

Store notification history and delivery state where available.

---

# 29. CUSTOMER CARE SETTINGS

Move configurable customer-care information into admin settings where technically appropriate.

Support:

- Customer-care phone
- Support email
- Operating hours
- WhatsApp contact if applicable

Do not expose secrets.

Frontend should be able to retrieve safe public support configuration from the backend.

Preserve the existing environment-variable fallback if required.

---

# 30. SUPPORT TICKET SYSTEM

Create support ticket management.

Fields:

- Ticket ID
- Customer/seller
- Related order
- Category
- Priority
- Assigned agent
- Status
- Created date
- Last update

Categories:

- Order
- Payment
- Refund
- Delivery
- Seller
- Product
- Account
- Technical

Statuses:

- Open
- In Progress
- Waiting for Customer
- Waiting for Seller
- Resolved
- Closed

Support internal notes separately from customer-visible communication.

---

# 31. ANALYTICS

Create useful analytics using actual LocalShore data.

## Business

- GMV
- Revenue
- Commission
- AOV
- Orders
- Refund rate
- Cancellation rate

## Customer

- New customers
- Returning customers
- Repeat order rate
- Order frequency
- Lifetime value where data permits

## Seller

- Top sellers
- Fast-growing sellers
- Acceptance rate
- Cancellation rate
- Rating
- Revenue

## Products

- Most viewed
- Most purchased
- Conversion where tracking exists
- Out of stock
- Search-to-purchase where tracking exists

## Geographic

- Orders by area
- GMV by area
- Customers by area
- Stores by area
- Demand heatmap
- Low-supply areas

Do not fabricate analytics when tracking does not exist.

Implement missing event tracking properly or show that data is unavailable.

---

# 32. SEARCH ANALYTICS

Track marketplace search activity.

Store:

- Search query
- Timestamp
- Customer/session where privacy-safe
- Number of results
- Product clicked
- Purchase conversion where measurable

Admin analytics should show:

- Most searched terms
- Trending searches
- Zero-result searches
- Low-result searches
- Search → product click
- Search → order conversion

Zero-result searches should be highlighted because they indicate marketplace supply gaps.

---

# 33. ADMIN USERS / RBAC

Implement proper Role-Based Access Control.

Suggested roles:

- SUPER_ADMIN
- OPERATIONS_ADMIN
- SELLER_MANAGER
- FINANCE_ADMIN
- SUPPORT_AGENT
- CATALOG_MANAGER
- MARKETING_ADMIN
- ANALYST

Do not rely only on frontend route hiding.

Permissions MUST also be validated server-side.

Examples:

Finance admin:
- Transactions
- Refunds
- Payouts
- Commission

Seller manager:
- Sellers
- Seller approval
- Stores

Support:
- Orders
- Customers
- Tickets
- Limited refund actions if explicitly granted

Only authorized roles can modify platform settings.

---

# 34. AUDIT LOGS

Implement immutable admin audit logs for sensitive actions.

Track:

- Admin ID
- Admin name
- Role
- Action
- Resource type
- Resource ID
- Previous value when appropriate
- New value when appropriate
- Reason
- Timestamp
- IP/device metadata where safely available

Audit actions such as:

- Seller approval/rejection
- Seller suspension
- Product moderation
- Price changes by admin
- Refund
- Payout
- Commission change
- Customer blocking
- Admin-role change
- Platform-setting change

Create filters by:

- Admin
- Action
- Resource
- Date
- Severity

---

# 35. PLATFORM SETTINGS

Centralize platform configuration.

Sections:

- Marketplace
- Seller
- Product
- Orders
- Payments
- Delivery
- Maps
- Notifications
- Customer care
- Taxes
- Commissions
- Refunds
- Security

Examples:

- Seller approval required
- Product approval required
- Default commission
- Default service radius
- Minimum order
- Cancellation window

Store settings securely in the backend/database.

Do not expose secrets to the frontend.

---

# 36. INTEGRATIONS

Create an integration-health page.

Show configured services such as:

- Google Maps
- Payment gateway
- SMS
- Email
- Storage
- Push notifications

For each integration show safe operational information:

- Connected/configured
- Warning
- Error
- Last successful operation where possible

Never display API keys, secrets, passwords or complete credentials.

For Google Maps, monitor relevant API errors/usage information if available through existing infrastructure.

---

# 37. PLATFORM HEALTH

Create a lightweight system-health dashboard.

Possible information:

- API health
- Database connectivity
- Payment gateway health
- Maps integration
- Storage
- Notifications

Operational counters:

- Failed payments
- API errors
- Failed notifications
- Failed background jobs

Do not expose sensitive infrastructure details to unauthorized admin roles.

---

# 38. GLOBAL ADMIN SEARCH

Create powerful global search.

Admin should be able to search:

- Order ID
- Seller
- Store
- Product
- Customer
- Phone
- Email
- Transaction ID
- Ticket ID

Display grouped results and navigate directly to the relevant entity.

---

# 39. TABLE EXPERIENCE

All major tables should support, where appropriate:

- Search
- Filters
- Sorting
- Pagination
- Date range
- Column visibility
- Status filters
- CSV export for authorized users
- Bulk actions only where safe

Persist useful filters where appropriate.

Do not load thousands of records into the browser.

Use server-side pagination/filtering for large datasets.

---

# 40. SECURITY

This Admin Panel contains highly privileged functionality.

Implement:

- Protected admin routes
- Server-side authorization
- RBAC
- Secure authentication
- Session/token validation
- Input validation
- Rate limiting where appropriate
- CSRF protection depending on authentication architecture
- Safe API error handling
- Audit logs
- Sensitive-data masking

Never trust role information sent by the frontend.

Never expose:

- Database credentials
- API secrets
- Payment secrets
- Private environment variables

---

# 41. DATABASE / BACKEND

Before creating new tables or models, inspect existing ones.

Reuse existing relationships whenever appropriate.

Possible entities may include:

- User
- Customer
- Seller
- Store
- Product
- Category
- Inventory
- Order
- OrderItem
- Transaction
- Refund
- Commission
- Payout
- Review
- SupportTicket
- Notification
- ServiceZone
- AdminRole
- Permission
- AuditLog
- PlatformSetting

Do not blindly create duplicates.

Use migrations safely.

Never destroy existing production/demo data.

---

# 42. API DESIGN

Reuse existing APIs first.

Add admin-specific endpoints only when necessary.

Examples conceptually:

/admin/dashboard

/admin/sellers

/admin/stores

/admin/products

/admin/orders

/admin/customers

/admin/finance

/admin/payouts

/admin/refunds

/admin/support

/admin/analytics

/admin/settings

/admin/audit-logs

/admin/service-zones

Use the project's existing API conventions rather than forcing these exact URLs.

Implement:

- Pagination
- Filtering
- Sorting
- Validation
- Authorization
- Consistent errors

---

# 43. LOADING / EMPTY / ERROR STATES

Every admin page must handle:

LOADING

EMPTY DATA

API ERROR

UNAUTHORIZED

NO SEARCH RESULTS

NETWORK FAILURE

Do not leave blank screens.

Provide useful retry actions.

---

# 44. CONFIRMATION FOR DANGEROUS ACTIONS

Require confirmation for actions such as:

- Suspend seller
- Reject seller
- Block customer
- Unpublish product
- Refund order
- Process payout
- Change commission
- Disable service zone

For important actions require a reason.

Example:

Suspend Dreamland Textiles?

Reason:
[________________________]

[Cancel] [Suspend Seller]

Record the reason in audit logs.

---

# 45. REAL-TIME / REFRESH BEHAVIOR

For operational pages such as:

- Live orders
- Active deliveries
- Dashboard alerts

Use the project's existing real-time architecture if available.

Otherwise implement sensible polling/refetching rather than adding unnecessary infrastructure.

Do not refresh entire pages unnecessarily.

---

# 46. PERFORMANCE

Optimize admin performance.

Use:

- Server-side pagination
- Lazy loading
- Debounced search
- Query caching
- Efficient database indexes
- Optimized aggregate queries
- Image optimization
- Code splitting where appropriate

Avoid N+1 database queries.

Dashboard analytics must not execute extremely expensive queries on every render.

---

# 47. RESPONSIVE BEHAVIOR

Desktop should prioritize dense operational information.

Tablet should remain fully functional.

Mobile should allow essential admin actions without horizontal chaos.

Tables may convert to:

- Scrollable tables
- Compact rows
- Cards

depending on what produces the best UX.

---

# 48. DO NOT DO THESE THINGS

DO NOT:

- Rebuild the entire project.
- Replace existing working functionality unnecessarily.
- Break the Seller Hub.
- Break the customer app.
- Replace Google Maps.
- Create duplicate APIs.
- Create duplicate database models.
- Hardcode dashboard metrics.
- Hardcode seller/store/order data.
- Hardcode permanent Coimbatore zones.
- Put API keys in frontend code.
- Expose private customer data unnecessarily.
- Allow admin actions without authorization.
- Add buttons that do nothing.
- Create fake charts.
- Create fake notifications.
- Create fake delivery tracking.
- Create fake payout data.
- Use placeholder admin functions and call them complete.
- Change LocalShore branding unnecessarily.
- Overdesign the interface.

---

# 49. IMPLEMENTATION STRATEGY

Do NOT attempt random changes across the entire project.

Work in phases.

## PHASE 1 — FOUNDATION

Inspect existing system.

Implement/improve:

- Admin layout
- Sidebar
- Authentication
- RBAC foundation
- Global search foundation
- Audit-log foundation

## PHASE 2 — CORE MARKETPLACE

Implement:

- Dashboard / Action Center
- Sellers
- Seller approvals
- Stores
- Products
- Categories
- Inventory monitoring

## PHASE 3 — OPERATIONS

Implement:

- Orders
- Order details
- Live orders
- Customers
- Reviews
- Support tickets

## PHASE 4 — FINANCE

Implement:

- Transactions
- Commission
- Seller earnings
- Payouts
- Refunds
- Reconciliation

## PHASE 5 — LOCATION

Implement:

- Admin marketplace map
- Store location verification
- Service zones
- Geographic analytics

Reuse Google Maps.

## PHASE 6 — GROWTH

Implement:

- Coupons
- Offers
- Banners
- Featured stores/products
- Notifications
- Search analytics

## PHASE 7 — PLATFORM CONTROL

Implement:

- Admin users
- Permissions
- Audit-log UI
- Platform settings
- Integrations
- Platform health

---

# 50. IMPORTANT — COMPLETE EACH MODULE PROPERLY

For every module:

1. Inspect existing implementation.
2. Identify reusable frontend/backend code.
3. Identify missing functionality.
4. Implement backend changes if necessary.
5. Implement frontend.
6. Add validation.
7. Add permissions.
8. Add loading/error/empty states.
9. Add responsive behavior.
10. Add audit logging for sensitive actions.
11. Test integration with existing functionality.
12. Check for regressions.

Do not move to unnecessary cosmetic work while core functionality is incomplete.

---

# 51. FINAL VALIDATION

After implementation, verify:

- Admin authentication works.
- Unauthorized users cannot access admin APIs.
- RBAC works on backend and frontend.
- Sellers display real data.
- Stores display real data.
- Google Maps uses real store coordinates.
- Products use real seller products.
- Orders use real orders.
- Customers use real customer data.
- Financial calculations are consistent.
- Refund actions are protected.
- Payout actions are protected.
- Commission changes are audited.
- Seller suspensions are audited.
- Search works.
- Filters work.
- Pagination works.
- Dashboard metrics match underlying data.
- Responsive layouts work.
- Seller Hub still works.
- Customer application still works.
- Existing APIs have not been unintentionally broken.
- No secrets are exposed.
- No critical console errors remain.
- No dead buttons remain.
- No fake production data remains.

---

# FINAL GOAL

The LocalShore Admin Panel should become the operational control center for the complete marketplace:

CUSTOMERS
↕

LOCALSHORE MARKETPLACE
↕

SELLERS / LOCAL STORES
↕

PRODUCTS + INVENTORY
↕

ORDERS
↕

PAYMENTS + COMMISSIONS + PAYOUTS
↕

DELIVERY
↕

SUPPORT

with:

ADMIN CONTROL

+ ANALYTICS

+ GOOGLE MAPS / SERVICE ZONES

+ SECURITY / RBAC

+ AUDIT LOGGING

+ PLATFORM SETTINGS

Build this by **enhancing the existing LocalShore architecture**, not replacing it.

Prioritize working functionality, maintainability, security, real data integration and operational usefulness over decorative UI.

Start by inspecting the entire existing Admin/Seller/backend implementation and produce a concise implementation assessment. Then begin with **Phase 1 and Phase 2**, completing and testing each feature before moving to later phases.