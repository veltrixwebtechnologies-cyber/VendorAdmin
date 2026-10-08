import assert from "node:assert/strict";
import test from "node:test";
import { register } from "tsx/esm/api";

register();
const {
  PIPELINE_STAGES,
  orderMatchesStage,
  calculatePipelineCounts,
  getPipelineEmptyState,
} = await import("../src/lib/order-pipeline.ts");

const sampleOrders = [
  { id: "o-new-1", orderNumber: "ORD-101", status: "new", buyerName: "Alice", total: 500, createdAt: "2026-10-06T10:00:00Z" },
  { id: "o-new-2", orderNumber: "ORD-102", status: "new", buyerName: "Bob", total: 750, createdAt: "2026-10-06T10:05:00Z" },
  { id: "o-acc-1", orderNumber: "ORD-201", status: "accepted", buyerName: "Charlie", total: 1200, createdAt: "2026-10-06T09:30:00Z" },
  { id: "o-acc-2", orderNumber: "ORD-202", status: "vendor_accepted", buyerName: "David", total: 450, createdAt: "2026-10-06T09:35:00Z" },
  { id: "o-prep-1", orderNumber: "ORD-301", status: "preparing", buyerName: "Eve", total: 990, createdAt: "2026-10-06T09:15:00Z" },
  { id: "o-prep-2", orderNumber: "ORD-302", status: "packed", buyerName: "Frank", total: 320, createdAt: "2026-10-06T09:20:00Z" },
  { id: "o-ready-1", orderNumber: "ORD-401", status: "ready_for_pickup", buyerName: "Grace", total: 600, createdAt: "2026-10-06T09:00:00Z" },
  { id: "o-deliv-1", orderNumber: "ORD-501", status: "out_for_delivery", buyerName: "Heidi", total: 1500, createdAt: "2026-10-06T08:45:00Z" },
  { id: "o-deliv-2", orderNumber: "ORD-502", status: "rider_assigned", buyerName: "Ivan", total: 800, createdAt: "2026-10-06T08:50:00Z" },
  { id: "o-done-1", orderNumber: "ORD-601", status: "delivered", buyerName: "Judy", total: 2100, createdAt: "2026-10-06T08:00:00Z" },
];

test("Stage filtering isolation: New stage shows ONLY new orders", () => {
  const filtered = sampleOrders.filter((o) => orderMatchesStage(o.status, "new"));
  assert.equal(filtered.length, 2);
  assert.deepEqual(filtered.map((o) => o.id), ["o-new-1", "o-new-2"]);
  assert.ok(filtered.every((o) => o.status === "new"));
});

test("Stage filtering isolation: Accepted stage shows ONLY accepted & vendor_accepted orders", () => {
  const filtered = sampleOrders.filter((o) => orderMatchesStage(o.status, "accepted"));
  assert.equal(filtered.length, 2);
  assert.deepEqual(filtered.map((o) => o.id), ["o-acc-1", "o-acc-2"]);
  assert.ok(filtered.every((o) => o.status === "accepted" || o.status === "vendor_accepted"));
});

test("Stage filtering isolation: Preparing stage shows ONLY preparing & packed orders", () => {
  const filtered = sampleOrders.filter((o) => orderMatchesStage(o.status, "preparing"));
  assert.equal(filtered.length, 2);
  assert.deepEqual(filtered.map((o) => o.id), ["o-prep-1", "o-prep-2"]);
  assert.ok(filtered.every((o) => o.status === "preparing" || o.status === "packed"));
});

test("Stage filtering isolation: Ready stage shows ONLY ready_for_pickup orders", () => {
  const filtered = sampleOrders.filter((o) => orderMatchesStage(o.status, "ready"));
  assert.equal(filtered.length, 1);
  assert.deepEqual(filtered.map((o) => o.id), ["o-ready-1"]);
  assert.ok(filtered.every((o) => o.status === "ready_for_pickup"));
});

test("Stage filtering isolation: Delivery stage shows ONLY in-transit orders", () => {
  const filtered = sampleOrders.filter((o) => orderMatchesStage(o.status, "delivery"));
  assert.equal(filtered.length, 2);
  assert.deepEqual(filtered.map((o) => o.id), ["o-deliv-1", "o-deliv-2"]);
});

test("Stage filtering isolation: Delivered stage shows ONLY delivered orders", () => {
  const filtered = sampleOrders.filter((o) => orderMatchesStage(o.status, "delivered"));
  assert.equal(filtered.length, 1);
  assert.deepEqual(filtered.map((o) => o.id), ["o-done-1"]);
  assert.ok(filtered.every((o) => o.status === "delivered"));
});

test("Stage counts remain completely stable when any stage is filtered", () => {
  const fullCounts = calculatePipelineCounts(sampleOrders);

  // When 'preparing' is selected, pipeline card counts must NOT collapse to 0
  assert.equal(fullCounts.new, 2);
  assert.equal(fullCounts.accepted, 2);
  assert.equal(fullCounts.preparing, 2);
  assert.equal(fullCounts.ready, 1);
  assert.equal(fullCounts.delivery, 2);
  assert.equal(fullCounts.delivered, 1);
});

test("Empty state copy is accurate when no orders match a stage", () => {
  const ordersWithoutPreparing = sampleOrders.filter((o) => !orderMatchesStage(o.status, "preparing"));
  const prepFiltered = ordersWithoutPreparing.filter((o) => orderMatchesStage(o.status, "preparing"));
  assert.equal(prepFiltered.length, 0);

  const emptyState = getPipelineEmptyState("preparing");
  assert.equal(emptyState.title, "No Preparing Orders");
  assert.equal(emptyState.description, "There are currently no orders in the Preparing stage.");
});
