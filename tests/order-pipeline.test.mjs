import assert from "node:assert/strict";
import test from "node:test";
import { register } from "tsx/esm/api";

register();
const {
  PIPELINE_STAGES,
  orderMatchesStage,
  getStageForOrderStatus,
  normalizePipelineStage,
  calculatePipelineCounts,
  calculateOrdersPageTabCounts,
  getPipelineEmptyState,
} = await import("../src/lib/order-pipeline.ts");

test("PIPELINE_STAGES contains exact 6 stages in required sequence", () => {
  const keys = PIPELINE_STAGES.map((s) => s.key);
  assert.deepEqual(keys, ["new", "accepted", "preparing", "ready", "delivery", "delivered"]);

  const labels = PIPELINE_STAGES.map((s) => s.label);
  assert.deepEqual(labels, [
    "New",
    "Accepted",
    "Preparing",
    "Ready",
    "Delivery",
    "Delivered",
  ]);
});

test("all pipeline stages have mutually exclusive statuses (no overlaps)", () => {
  const allStatuses = [];
  for (const stage of PIPELINE_STAGES) {
    for (const status of stage.statuses) {
      assert.ok(
        !allStatuses.includes(status),
        `Status "${status}" is duplicated across stages`,
      );
      allStatuses.push(status);
    }
  }
});

test("orderMatchesStage strictly filters each pipeline stage", () => {
  // New
  assert.equal(orderMatchesStage("new", "new"), true);
  assert.equal(orderMatchesStage("accepted", "new"), false);
  assert.equal(orderMatchesStage("preparing", "new"), false);

  // Accepted
  assert.equal(orderMatchesStage("accepted", "accepted"), true);
  assert.equal(orderMatchesStage("vendor_accepted", "accepted"), true);
  assert.equal(orderMatchesStage("new", "accepted"), false);
  assert.equal(orderMatchesStage("preparing", "accepted"), false);

  // Preparing
  assert.equal(orderMatchesStage("preparing", "preparing"), true);
  assert.equal(orderMatchesStage("packed", "preparing"), true);
  assert.equal(orderMatchesStage("new", "preparing"), false);
  assert.equal(orderMatchesStage("accepted", "preparing"), false);
  assert.equal(orderMatchesStage("ready_for_pickup", "preparing"), false);

  // Ready
  assert.equal(orderMatchesStage("ready_for_pickup", "ready"), true);
  assert.equal(orderMatchesStage("preparing", "ready"), false);
  assert.equal(orderMatchesStage("out_for_delivery", "ready"), false);

  // Delivery
  assert.equal(orderMatchesStage("assigned", "delivery"), true);
  assert.equal(orderMatchesStage("delivery_partner_assigned", "delivery"), true);
  assert.equal(orderMatchesStage("going_to_vendor", "delivery"), true);
  assert.equal(orderMatchesStage("arrived_at_vendor", "delivery"), true);
  assert.equal(orderMatchesStage("rider_assigned", "delivery"), true);
  assert.equal(orderMatchesStage("rider_accepted", "delivery"), true);
  assert.equal(orderMatchesStage("rider_at_shop", "delivery"), true);
  assert.equal(orderMatchesStage("picked_up", "delivery"), true);
  assert.equal(orderMatchesStage("going_to_customer", "delivery"), true);
  assert.equal(orderMatchesStage("arrived_at_customer", "delivery"), true);
  assert.equal(orderMatchesStage("out_for_delivery", "delivery"), true);
  assert.equal(orderMatchesStage("at_customer", "delivery"), true);
  assert.equal(orderMatchesStage("shipped", "delivery"), true);
  assert.equal(orderMatchesStage("delivered", "delivery"), false);
  assert.equal(orderMatchesStage("ready_for_pickup", "delivery"), false);

  // Delivered
  assert.equal(orderMatchesStage("delivered", "delivered"), true);
  assert.equal(orderMatchesStage("out_for_delivery", "delivered"), false);
});

test("normalizePipelineStage normalizes various input formats into canonical keys", () => {
  assert.equal(normalizePipelineStage("new"), "new");
  assert.equal(normalizePipelineStage("New"), "new");
  assert.equal(normalizePipelineStage("vendor_accepted"), "accepted");
  assert.equal(normalizePipelineStage("Accepted"), "accepted");
  assert.equal(normalizePipelineStage("preparing"), "preparing");
  assert.equal(normalizePipelineStage("packed"), "preparing");
  assert.equal(normalizePipelineStage("ready_for_pickup"), "ready");
  assert.equal(normalizePipelineStage("Ready"), "ready");
  assert.equal(normalizePipelineStage("out_for_delivery"), "delivery");
  assert.equal(normalizePipelineStage("Delivery"), "delivery");
  assert.equal(normalizePipelineStage("delivered"), "delivered");
  assert.equal(normalizePipelineStage("Delivered"), "delivered");
  assert.equal(normalizePipelineStage("invalid_status"), null);
  assert.equal(normalizePipelineStage(null), null);
});

test("calculatePipelineCounts calculates exact counts across full orders set", () => {
  const dummyOrders = [
    { status: "new" },
    { status: "new" },
    { status: "new" },
    { status: "new" },
    { status: "new" }, // 5 New
    { status: "accepted" },
    { status: "vendor_accepted" },
    { status: "vendor_accepted" }, // 3 Accepted
    { status: "preparing" },
    { status: "packed" }, // 2 Preparing
    { status: "ready_for_pickup" },
    { status: "ready_for_pickup" },
    { status: "ready_for_pickup" },
    { status: "ready_for_pickup" }, // 4 Ready
    { status: "out_for_delivery" }, // 1 Delivery
    ...Array.from({ length: 18 }, () => ({ status: "delivered" })), // 18 Delivered
  ];

  const counts = calculatePipelineCounts(dummyOrders);
  assert.deepEqual(counts, {
    new: 5,
    accepted: 3,
    preparing: 2,
    ready: 4,
    delivery: 1,
    delivered: 18,
  });

  const tabCounts = calculateOrdersPageTabCounts(dummyOrders);
  assert.equal(tabCounts.all, 33);
  assert.equal(tabCounts.new, 5);
  assert.equal(tabCounts.accepted, 3);
  assert.equal(tabCounts.preparing, 2);
  assert.equal(tabCounts.ready, 4);
  assert.equal(tabCounts.delivery, 1);
  assert.equal(tabCounts.delivered, 18);
  assert.equal(tabCounts.cancelled, 0);
});

test("getPipelineEmptyState generates clean, exact empty state copy", () => {
  const prepEmpty = getPipelineEmptyState("preparing");
  assert.equal(prepEmpty.title, "No Preparing Orders");
  assert.equal(prepEmpty.description, "There are currently no orders in the Preparing stage.");

  const newEmpty = getPipelineEmptyState("new");
  assert.equal(newEmpty.title, "No New Orders");
  assert.equal(newEmpty.description, "There are currently no orders in the New stage.");

  const readyEmpty = getPipelineEmptyState("ready");
  assert.equal(readyEmpty.title, "No Ready Orders");
  assert.equal(readyEmpty.description, "There are currently no orders in the Ready stage.");
});
