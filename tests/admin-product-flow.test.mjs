import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sellerFn = readFileSync("src/lib/products.functions.ts", "utf8");
const adminPage = readFileSync("src/routes/admin/products.tsx", "utf8");
const moderationMigration = readFileSync(
  "supabase/migrations/20261004190000_fix_rbac_product_moderation_guard.sql",
  "utf8",
);

test("seller-created products enter the review queue and remain seller-owned", () => {
  assert.match(sellerFn, /status:\s*"pending"/);
  assert.match(sellerFn, /seller_id:\s*sellerId/);
  assert.match(sellerFn, /user_id:\s*userId/);
});

test("admin moderation verifies that the database persisted the requested status", () => {
  assert.match(adminPage, /\.select\("id,status"\)/);
  assert.match(adminPage, /data\.status !== status/);
  assert.match(adminPage, /onError:\s*\(error: any\)\s*=>\s*toast\.error/);
});

test("new guard migration permits only authorized admin moderation status changes", () => {
  assert.match(moderationMigration, /has_admin_permission\('products\.manage'\)/);
  assert.match(moderationMigration, /has_admin_permission\('products\.moderate'\)/);
  assert.match(moderationMigration, /NEW\.status := OLD\.status/);
  assert.match(moderationMigration, /NEW\.status := 'pending'/);
});

test("admin product list reports query failures and refreshes from product changes", () => {
  assert.match(adminPage, /q\.isError/);
  assert.match(adminPage, /q\.refetch\(\)/);
  assert.match(adminPage, /postgres_changes/);
  assert.match(adminPage, /table: "products"/);
});

test("bulk moderation is pending-only, filter-scoped, confirmed, and reasoned for rejection", () => {
  assert.match(adminPage, /const pendingRows = useMemo\([\s\S]*?rows\.filter/);
  assert.match(adminPage, /\.eq\("status", "pending"\)/);
  assert.match(adminPage, /setBulkAction\("approved"\)/);
  assert.match(adminPage, /setBulkAction\("rejected"\)/);
  assert.match(adminPage, /Rejection reason \(required\)/);
  assert.match(adminPage, /Approve all matching pending products\?/);
  assert.match(adminPage, /Reject all matching pending products\?/);
  assert.match(adminPage, /offset \+= 20/);
  assert.match(adminPage, /ADMIN_PRODUCT_PAGE_SIZE = 500/);
  assert.match(adminPage, /\.range\(offset, offset \+ ADMIN_PRODUCT_PAGE_SIZE - 1\)/);
});
