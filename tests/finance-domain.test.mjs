import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { register } from "tsx/esm/api";

register();
const domain = await import("../src/lib/finance-domain.ts");

test("refundable balance reserves requested/approved amounts and uses minor units", () => {
  assert.equal(
    domain.getRefundableAmount(100, [
      { amount: 10.1, status: "requested" },
      { amount: 20.2, status: "approved" },
      { amount: 50, status: "rejected" },
    ]),
    69.7,
  );
  assert.equal(domain.validateRefundAmount(69.71, 69.7), false);
  assert.equal(domain.validateRefundAmount(69.7, 69.7), true);
});

test("refund eligibility considers order state, capture, COD and duplicate open requests", () => {
  assert.deepEqual(
    domain.getRefundEligibility({
      orderStatus: "delivered",
      paymentMethod: "card",
      paymentStatus: "paid",
      orderAmount: 100,
      capturedAmount: 100,
      refunds: [{ amount: 25, status: "refunded" }],
    }),
    { eligible: true, refundableAmount: 75, mode: "gateway", reasons: [] },
  );
  assert.equal(
    domain.getRefundEligibility({
      orderStatus: "new",
      paymentMethod: "card",
      paymentStatus: "paid",
      orderAmount: 100,
      capturedAmount: 100,
      refunds: [],
    }).eligible,
    false,
  );
  assert.equal(
    domain.getRefundEligibility({
      orderStatus: "delivered",
      paymentMethod: "cod",
      paymentStatus: "pending",
      orderAmount: 100,
      refunds: [],
    }).mode,
    "manual",
  );
  assert.ok(
    domain
      .getRefundEligibility({
        orderStatus: "delivered",
        paymentMethod: "cod",
        paymentStatus: "pending",
        orderAmount: 100,
        refunds: [],
        hasOpenRequest: true,
      })
      .reasons.includes("OPEN_REFUND_EXISTS"),
  );
});

test("refund transitions are explicit; approval is not refund completion", () => {
  assert.equal(domain.canTransitionRefund("requested", "approved"), true);
  assert.equal(domain.canTransitionRefund("approved", "refunded"), true);
  assert.equal(domain.canTransitionRefund("requested", "refunded"), false);
  assert.equal(domain.canTransitionRefund("rejected", "approved"), false);
});

test("COD requests use manual flow and require delivered order", () => {
  assert.equal(
    domain.getRefundRequestMode({
      paymentMethod: "cod",
      orderStatus: "delivered",
      paymentStatus: "pending",
    }),
    "manual",
  );
  assert.equal(
    domain.getRefundRequestMode({
      paymentMethod: "cod",
      orderStatus: "cancelled",
      paymentStatus: "pending",
    }),
    null,
  );
  assert.equal(
    domain.getRefundRequestMode({
      paymentMethod: "card",
      orderStatus: "cancelled",
      paymentStatus: "paid",
    }),
    "gateway",
  );
  assert.equal(
    domain.getRefundRequestMode({
      paymentMethod: "upi",
      orderStatus: "delivered",
      paymentStatus: "pending",
    }),
    null,
  );
});

test("payment reconciliation reports only transaction-backed inconsistencies", () => {
  const issues = domain.classifyPaymentReconciliation(
    [
      {
        id: "a",
        orderNumber: "A",
        paymentMethod: "card",
        paymentStatus: "paid",
        orderStatus: "delivered",
      },
      {
        id: "b",
        orderNumber: "B",
        paymentMethod: "upi",
        paymentStatus: "pending",
        orderStatus: "delivered",
      },
      {
        id: "c",
        orderNumber: "C",
        paymentMethod: "cod",
        paymentStatus: "pending",
        orderStatus: "delivered",
      },
    ],
    [
      { orderId: "b", status: "captured", amount: 12 },
      { orderId: "a", status: "failed", amount: 10 },
    ],
  );
  assert.deepEqual(issues.map((issue) => issue.issue).sort(), [
    "CAPTURED_ATTEMPT_ORDER_NOT_PAID",
    "FAILED_ATTEMPT_ON_PAID_ORDER",
    "PAID_ORDER_WITHOUT_CAPTURED_ATTEMPT",
  ]);
});

test("payout eligibility returns reasons rather than assuming payout success", () => {
  const blocked = domain.getPayoutEligibility({
    status: "processing",
    netPayout: 200,
    bankDetailsConfigured: true,
    pendingRefunds: 1,
    unresolvedFinancialDisputes: 1,
  });
  assert.equal(blocked.eligible, false);
  assert.deepEqual(blocked.reasons, ["REFUND_REQUIRES_FINANCE_REVIEW", "FINANCIAL_DISPUTE_OPEN"]);
});

test("seller refunds reduce unpaid payable without rewriting a paid payout", () => {
  assert.deepEqual(
    domain.calculateSellerRefundAccounting({
      settlementNetPayable: 100,
      successfulRefunds: [10.25, 4.75],
      settlementStatus: "pending",
    }),
    {
      originalPayoutAmount: 100,
      refundDeduction: 15,
      amountPayable: 85,
      recoveryDue: 0,
      historicalPayoutPreserved: false,
    },
  );
  assert.deepEqual(
    domain.calculateSellerRefundAccounting({
      settlementNetPayable: 100,
      successfulRefunds: [15],
      settlementStatus: "paid",
    }),
    {
      originalPayoutAmount: 100,
      refundDeduction: 15,
      amountPayable: 0,
      recoveryDue: 15,
      historicalPayoutPreserved: true,
    },
  );
});

test("payout eligibility blocks inactive sellers and refund recoveries", () => {
  const result = domain.getPayoutEligibility({
    status: "pending",
    netPayout: 500,
    bankDetailsConfigured: true,
    pendingRefunds: 0,
    unresolvedFinancialDisputes: 0,
    sellerActive: false,
    recoveryDue: 5,
  });
  assert.deepEqual(result.reasons, [
    "SELLER_NOT_ACTIVE",
    "REFUND_RECOVERY_REQUIRES_FINANCE_REVIEW",
  ]);
});

test("refund reconciliation finds pending provider and seller-payable gaps", () => {
  assert.deepEqual(
    domain
      .classifyRefundReconciliation([
        { status: "approved", amount: 20 },
        {
          status: "refunded",
          amount: 30,
          sellerAdjustmentAmount: 0,
          adjustmentState: "unallocated",
        },
        {
          status: "partially_refunded",
          amount: 5,
          sellerAdjustmentAmount: 5,
          adjustmentState: "recovery_due",
        },
      ])
      .sort(),
    [
      "APPROVED_REFUND_AWAITING_PROCESSING",
      "COMPLETED_REFUND_NOT_FULLY_REFLECTED_IN_SELLER_PAYABLE",
      "REFUND_ADJUSTMENT_UNALLOCATED",
      "REFUND_RECOVERY_DUE",
    ],
  );
});

test("finance reconciliation detects orphan captures, duplicate open refunds and unpaid/held settlement states", () => {
  const findings = domain.classifyFinanceReconciliation({
    orders: [
      { id: "order-1", paymentMethod: "card", paymentStatus: "paid", orderStatus: "delivered" },
    ],
    attempts: [
      { id: "attempt-1", orderId: null, status: "captured", amount: 100 },
      { id: "attempt-2", orderId: "order-1", status: "captured", amount: 100 },
    ],
    refunds: [
      {
        id: "r1",
        orderId: "order-1",
        paymentAttemptId: "attempt-2",
        amount: 10,
        status: "requested",
        executionMethod: "gateway",
      },
      {
        id: "r2",
        orderId: "order-1",
        paymentAttemptId: "attempt-2",
        amount: 20,
        status: "approved",
        executionMethod: "gateway",
      },
    ],
    adjustments: [],
    settlements: [
      { id: "s1", status: "pending", netPayout: 90 },
      { id: "s2", status: "held", netPayout: 50 },
    ],
    disputes: [],
  });
  const issues = findings.map((item) => item.issue);
  assert.ok(issues.includes("CAPTURED_PAYMENT_WITHOUT_VALID_ORDER"));
  assert.ok(issues.includes("DUPLICATE_OPEN_REFUNDS"));
  assert.ok(issues.includes("APPROVED_REFUND_AWAITING_GATEWAY_PROCESSING"));
  assert.ok(issues.includes("UNPAID_SETTLEMENT_REQUIRES_ELIGIBILITY_REVIEW"));
  assert.ok(issues.includes("PAYOUT_ON_HOLD"));
});

test("finance migration keeps seller ownership and does not claim a gateway adapter", async () => {
  const migration = await readFile(
    new URL("../supabase/migrations/20261004170000_phase_c_finance_refunds.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /seller_id uuid NOT NULL REFERENCES public\.sellers/i);
  assert.match(migration, /payment_method IN \('upi','card','cod'\)/i);
  assert.match(migration, /complete_gateway_refund/i);
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.complete_gateway_refund[\s\S]*TO service_role/i,
  );
  assert.match(
    migration,
    /approved.*Payment refund execution is not configured|approval never implies success/i,
  );
  assert.match(migration, /has_admin_permission\('refunds\.approve'\)/i);
  assert.match(
    migration,
    /Missing public\.payment_attempts[\s\S]*20260909160000_razorpay_payment_integration\.sql/i,
  );
  assert.match(
    migration,
    /Missing orders\.store_id[\s\S]*20261004140000_phase_b_store_domain\.sql/i,
  );
  assert.match(migration, /public\.support_case_events/i);
  assert.doesNotMatch(
    migration,
    /RAZORPAY_KEY_SECRET|VITE_RAZORPAY|fetch\(['"]https:\/\/api\.razorpay/i,
  );
  const extension = await readFile(
    new URL(
      "../supabase/migrations/20261004180000_phase_c_refund_accounting_customer_eligibility.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(extension, /refunds_one_open_request_per_order/i);
  assert.match(extension, /get_customer_refund_eligibility/i);
  assert.match(extension, /seller_financial_adjustments/i);
  assert.match(extension, /refund_status_events/i);
  assert.match(extension, /apply_razorpay_refund_webhook/i);
  assert.match(
    extension,
    /REVOKE ALL ON FUNCTION public\.complete_gateway_refund[\s\S]*FROM PUBLIC, anon, authenticated, service_role/i,
  );
  assert.match(extension, /SUPPORT_STAGE_' \|\| upper\(e\.to_stage\)/i);
  assert.doesNotMatch(extension, /e\.action/);
  for (const requiredTimestamp of [
    "accepted_at",
    "picked_up_at",
    "out_for_delivery_at",
    "delivered_at",
  ]) {
    assert.ok(
      extension.includes(requiredTimestamp),
      `timeline preflight must check ${requiredTimestamp}`,
    );
  }
  assert.match(
    extension,
    /REVOKE ALL ON FUNCTION public\.apply_razorpay_refund_webhook[\s\S]*FROM PUBLIC, anon, authenticated/i,
  );
});
