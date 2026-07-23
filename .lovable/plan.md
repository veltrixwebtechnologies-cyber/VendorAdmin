## Phase 1 scope

Build the seller onboarding flow, an admin review console, and the post-approval seller dashboard shell. All data is mocked in memory + `localStorage` (no backend, no real OTPs, no real payouts). Later phases add products, orders, settlements, analytics, reviews, reports.

## Design system

Apply the provided palette in `src/styles.css` via `@theme` tokens (light mode only for Phase 1):

- `--primary`: `oklch(0.48 0.22 295)` (violet) — buttons, links, active states
- `--primary-hover` / dark accent: `oklch(0.38 0.22 295)` (deep teal/violet)
- `--foreground`: `oklch(0.22 0.08 295)` (deep ink)
- `--background`: white; `--card` / muted surface: `oklch(0.98 0.01 300)` (warm sand)
- `--accent` (marigold, ratings/highlights): `oklch(0.78 0.14 78)`
- `--destructive` (coral): `oklch(0.72 0.14 30)`
- `--success`: `oklch(0.64 0.15 155)`
- `--border`: `oklch(0.78 0.08 78 / 0.55)` (amber-tinted)
- Radius `0.75rem`, generous spacing, subtle marigold-tinted borders, no other colors anywhere.

Update `src/routes/__root.tsx` head metadata (title/description/og) away from the Lovable placeholder.

## Routes (TanStack file-based, all mocked / public)

```
src/routes/
  index.tsx                     -> landing: "Become a Seller" CTA
  register.tsx                  -> 7-step wizard (single route, internal step state)
  seller.tsx                    -> seller shell (sidebar layout, <Outlet/>)
  seller.index.tsx              -> dashboard with onboarding checklist
  seller.profile.tsx            -> read-only view of submitted info + resubmit if rejected
  admin.tsx                     -> admin shell
  admin.index.tsx               -> list of seller applications with status filters
  admin.$sellerId.tsx           -> application detail: business, address, bank, tax, docs; Approve / Reject (with reason) / Request More Info
```

A tiny top bar lets you switch between "Seller" and "Admin" views (Phase 1 convenience; real auth later).

## Registration wizard (`/register`)

Single route, stepper UI, progress bar 1–7. State kept in a `useReducer` and persisted to `localStorage` under `sellerDraft:<id>` so refresh doesn't lose progress.

1. **Account** — Full Name, Mobile, Email, Password (zod validation). Simulated Email OTP: "Send OTP" reveals a 6-digit code on-screen (toast + inline), user types it back. Mobile OTP optional, same simulation. On verify → create seller record `status: "draft"`.
2. **Business Info** — Shop Name, Owner Name, Business Type (select), Category (select), Description (textarea).
3. **Business Address** — Address, City, State, Pincode, Landmark, "Pickup same as shop" checkbox → reveals pickup fields.
4. **Bank Details** — Holder, Bank, Account #, IFSC, UPI (optional). IFSC format check.
5. **Tax & Legal** — PAN (regex), GST (optional), Business Reg # (optional).
6. **Documents** — File inputs for PAN, Aadhaar, GST cert, cancelled cheque, logo, banner. Files stored as base64 data URLs in `localStorage` (mock upload). Shows filename + size + preview thumbnail.
7. **Review & Submit** — Summary of all sections with per-section Edit buttons and a final **Submit for Approval** → `status: "pending"`, redirect to `/seller` with a "Pending verification" banner.

Each step: Back / Save & Continue. Zod schema per step; can't advance until valid.

## Admin console (`/admin`)

- `admin.index.tsx`: table of all sellers with columns Name / Shop / Submitted / Status, filter chips (Pending, Approved, Rejected, More Info Requested).
- `admin.$sellerId.tsx`: tabbed view (Business / Address / Bank / Tax / Documents) with document previews. Action bar: **Approve**, **Reject** (dialog for reason), **Request More Info** (dialog for message). Updates the seller record and (mock) notification.

## Seller dashboard (`/seller`)

- Sidebar shell (shadcn sidebar) with items for Dashboard, Profile, and placeholders for Store Setup / Products / Orders / Settlements / Analytics / Reviews / Reports (each renders a friendly "Coming soon in Phase 2" empty state so navigation works).
- Dashboard content varies by status:
  - **pending** → "Application under review" card with submitted summary.
  - **rejected** → alert with admin's rejection reason + "Fix & Resubmit" button (reopens wizard from Documents step).
  - **more_info** → alert with admin's message + resubmit CTA.
  - **approved** → welcome banner + onboarding checklist (Account Created ✅, Documents Verified ✅, Bank Details Added ✅, Complete Store Profile ⬜, Add First Product ⬜, Start Selling ⬜) with progress bar.

## Data layer (mock)

`src/lib/seller-store.ts`:
- Types: `Seller`, `SellerStatus = 'draft' | 'pending' | 'approved' | 'rejected' | 'more_info'`, `SellerDocuments`, etc.
- Zustand-style store backed by `localStorage` key `sellers:v1`, plus a `currentSellerId` key.
- Helpers: `createSeller`, `updateSeller`, `submitForApproval`, `approveSeller`, `rejectSeller(reason)`, `requestMoreInfo(msg)`, `listSellers`, `getSeller`.
- OTP helper: `generateOtp()` returns a 6-digit string and stores it with a 5-min expiry.
- Seed 2 demo applications on first load so the admin view isn't empty.

## Validation & UX

- All forms: `react-hook-form` + `zod` (already conventional in shadcn stacks; add if missing).
- shadcn components: Card, Input, Select, Textarea, Button, Progress, Stepper (custom), Dialog, AlertDialog, Tabs, Sidebar, Table, Badge, Sonner toasts.
- No external color classes — every color goes through the tokens above.

## Explicitly out of scope for Phase 1

Products, orders, settlements, analytics, reviews, reports, real auth, real OTP/SMS, real file storage, admin RBAC. Left as navigable "Coming soon" pages so the shell is complete.

## Deliverable

At the end of Phase 1: you can register as a seller through all 7 steps with simulated OTP, submit, switch to Admin, approve/reject/request-info, then switch back to Seller and see the correct dashboard state — all in the specified violet/teal + sand + marigold theme.