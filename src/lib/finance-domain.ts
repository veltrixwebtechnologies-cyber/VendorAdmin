export type RefundStatus =
  | "requested"
  | "reviewing"
  | "approved"
  | "processing"
  | "refunded"
  | "partially_refunded"
  | "failed"
  | "rejected"
  | "cancelled";

const reservingRefundStatuses = new Set<RefundStatus>([
  "requested",
  "reviewing",
  "approved",
  "processing",
  "refunded",
  "partially_refunded",
]);

/** Convert decimal currency to integer minor units before comparisons/sums. */
export function toMinorUnits(amount: number): number | null {
  if (!Number.isFinite(amount) || amount < 0) return null;
  return Math.round((amount + Number.EPSILON) * 100);
}

export function getRefundableAmount(
  paidAmount: number,
  refunds: readonly { amount: number; status: RefundStatus }[],
): number {
  const paid = toMinorUnits(paidAmount);
  if (paid === null) return 0;
  const reserved = refunds.reduce((sum, refund) => {
    const amount = toMinorUnits(refund.amount);
    return amount !== null && reservingRefundStatuses.has(refund.status) ? sum + amount : sum;
  }, 0);
  return Math.max(0, paid - reserved) / 100;
}

export interface RefundEligibilityInput {
  orderStatus: string;
  paymentMethod: string;
  paymentStatus: string;
  orderAmount: number;
  capturedAmount?: number | null;
  refunds: readonly { amount: number; status: RefundStatus }[];
  hasOpenRequest?: boolean;
}

/** UI guidance only; the database RPC remains the authority for request amount/ownership. */
export function getRefundEligibility(input: RefundEligibilityInput): {
  eligible: boolean;
  refundableAmount: number;
  mode: "gateway" | "manual" | null;
  reasons: string[];
} {
  const reasons: string[] = [];
  const orderStatus = input.orderStatus.toLowerCase();
  const paymentMethod = input.paymentMethod.toLowerCase();
  const mode = getRefundRequestMode(input);
  const refundableBasis =
    paymentMethod === "cod"
      ? input.orderAmount
      : input.capturedAmount != null
        ? input.capturedAmount
        : 0;
  const refundableAmount = getRefundableAmount(refundableBasis, input.refunds);

  if (!mode) {
    reasons.push(
      paymentMethod === "cod" ? "COD_REIMBURSEMENT_AFTER_DELIVERY_ONLY" : "PAYMENT_NOT_CAPTURED",
    );
  }
  if (input.hasOpenRequest) reasons.push("OPEN_REFUND_EXISTS");
  if (
    mode === "gateway" &&
    !["delivered", "returned", "cancelled", "cancelled_by_vendor", "delivery_failed"].includes(
      orderStatus,
    )
  ) {
    reasons.push("ORDER_NOT_REFUND_ELIGIBLE_STATE");
  }
  if (refundableAmount <= 0) reasons.push("NO_REFUNDABLE_BALANCE");

  return { eligible: reasons.length === 0, refundableAmount, mode, reasons };
}

export function validateRefundAmount(amount: number, refundable: number): boolean {
  const requested = toMinorUnits(amount);
  const remaining = toMinorUnits(refundable);
  return requested !== null && requested > 0 && remaining !== null && requested <= remaining;
}

const refundTransitions: Record<RefundStatus, readonly RefundStatus[]> = {
  requested: ["reviewing", "approved", "rejected", "cancelled"],
  reviewing: ["approved", "rejected", "cancelled"],
  approved: ["processing", "refunded", "partially_refunded", "failed"],
  processing: ["refunded", "partially_refunded", "failed"],
  refunded: [],
  partially_refunded: [],
  failed: [],
  rejected: [],
  cancelled: [],
};

export function canTransitionRefund(from: RefundStatus, to: RefundStatus): boolean {
  return refundTransitions[from].includes(to);
}

export function getRefundRequestMode(input: {
  paymentMethod: string;
  orderStatus: string;
  paymentStatus: string;
}): "gateway" | "manual" | null {
  if (input.paymentMethod.toLowerCase() === "cod") {
    return input.orderStatus.toLowerCase() === "delivered" ? "manual" : null;
  }
  return input.paymentStatus.toLowerCase() === "paid" ? "gateway" : null;
}

export interface ReconciliationOrder {
  id: string;
  orderNumber?: string;
  paymentMethod: string;
  paymentStatus: string;
  orderStatus: string;
}

export interface ReconciliationAttempt {
  orderId: string | null;
  status: string;
  amount: number;
}

export function classifyPaymentReconciliation(
  orders: readonly ReconciliationOrder[],
  attempts: readonly ReconciliationAttempt[],
): Array<{ orderId: string; orderNumber?: string; issue: string }> {
  const issues: Array<{ orderId: string; orderNumber?: string; issue: string }> = [];
  for (const order of orders) {
    const linked = attempts.filter((attempt) => attempt.orderId === order.id);
    const captured = linked.some((attempt) => attempt.status === "captured");
    const failed = linked.some((attempt) => attempt.status === "failed");
    const paid = order.paymentStatus.toLowerCase() === "paid";
    const finalOrder = ["delivered", "shipped", "picked_up", "out_for_delivery"].includes(
      order.orderStatus.toLowerCase(),
    );
    const isCod = order.paymentMethod.toLowerCase() === "cod";

    if (paid && !isCod && !captured) {
      issues.push({
        orderId: order.id,
        orderNumber: order.orderNumber,
        issue: "PAID_ORDER_WITHOUT_CAPTURED_ATTEMPT",
      });
    }
    if (failed && paid) {
      issues.push({
        orderId: order.id,
        orderNumber: order.orderNumber,
        issue: "FAILED_ATTEMPT_ON_PAID_ORDER",
      });
    }
    if (
      captured &&
      order.paymentStatus.toLowerCase() !== "paid" &&
      order.paymentStatus.toLowerCase() !== "refunded"
    ) {
      issues.push({
        orderId: order.id,
        orderNumber: order.orderNumber,
        issue: "CAPTURED_ATTEMPT_ORDER_NOT_PAID",
      });
    }
    if (finalOrder && !isCod && !paid && !captured) {
      issues.push({
        orderId: order.id,
        orderNumber: order.orderNumber,
        issue: "FULFILLED_ORDER_PAYMENT_UNCONFIRMED",
      });
    }
  }
  return issues;
}

export function getPayoutEligibility(input: {
  status: string;
  netPayout: number;
  bankDetailsConfigured: boolean;
  pendingRefunds: number;
  unresolvedFinancialDisputes: number;
  sellerActive?: boolean;
  unallocatedRefundAdjustments?: number;
  recoveryDue?: number;
}): { eligible: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (input.status === "paid") reasons.push("ALREADY_PAID");
  if (input.status === "held") reasons.push("PAYOUT_ON_HOLD");
  if (!Number.isFinite(input.netPayout) || input.netPayout <= 0)
    reasons.push("NON_POSITIVE_PAYOUT");
  if (!input.bankDetailsConfigured) reasons.push("SELLER_BANK_DETAILS_INCOMPLETE");
  if (input.pendingRefunds > 0) reasons.push("REFUND_REQUIRES_FINANCE_REVIEW");
  if (input.unresolvedFinancialDisputes > 0) reasons.push("FINANCIAL_DISPUTE_OPEN");
  if (input.sellerActive === false) reasons.push("SELLER_NOT_ACTIVE");
  if ((input.unallocatedRefundAdjustments ?? 0) > 0) reasons.push("REFUND_ADJUSTMENT_UNALLOCATED");
  if ((input.recoveryDue ?? 0) > 0) reasons.push("REFUND_RECOVERY_REQUIRES_FINANCE_REVIEW");
  return { eligible: reasons.length === 0, reasons };
}

export function calculateSellerRefundAccounting(input: {
  settlementNetPayable: number;
  successfulRefunds: readonly number[];
  settlementStatus: string;
}): {
  originalPayoutAmount: number;
  refundDeduction: number;
  amountPayable: number;
  recoveryDue: number;
  historicalPayoutPreserved: boolean;
} {
  const original = toMinorUnits(input.settlementNetPayable) ?? 0;
  const deduction = input.successfulRefunds.reduce(
    (sum, amount) => sum + (toMinorUnits(amount) ?? 0),
    0,
  );
  const paid = input.settlementStatus.toLowerCase() === "paid";
  return {
    originalPayoutAmount: original / 100,
    refundDeduction: deduction / 100,
    amountPayable: paid ? 0 : (original - deduction) / 100,
    recoveryDue: paid ? deduction / 100 : 0,
    historicalPayoutPreserved: paid,
  };
}

export interface RefundReconciliationRecord {
  status: RefundStatus;
  amount: number;
  sellerAdjustmentAmount?: number;
  adjustmentState?: "deduct_before_payout" | "recovery_due" | "unallocated";
}

export function classifyRefundReconciliation(
  refunds: readonly RefundReconciliationRecord[],
): string[] {
  const issues = new Set<string>();
  for (const refund of refunds) {
    if (refund.status === "approved") issues.add("APPROVED_REFUND_AWAITING_PROCESSING");
    if (refund.status === "processing") issues.add("REFUND_AWAITING_PROVIDER_RESULT");
    if (
      (refund.status === "refunded" || refund.status === "partially_refunded") &&
      (refund.sellerAdjustmentAmount ?? 0) < refund.amount
    ) {
      issues.add("COMPLETED_REFUND_NOT_FULLY_REFLECTED_IN_SELLER_PAYABLE");
    }
    if (refund.status === "refunded" || refund.status === "partially_refunded") {
      if (refund.adjustmentState === "unallocated") issues.add("REFUND_ADJUSTMENT_UNALLOCATED");
      if (refund.adjustmentState === "recovery_due") issues.add("REFUND_RECOVERY_DUE");
    }
  }
  return [...issues];
}

export interface FinanceReconciliationInput {
  orders: readonly ReconciliationOrder[];
  attempts: readonly (ReconciliationAttempt & { id?: string })[];
  refunds: readonly {
    id: string;
    orderId: string;
    paymentAttemptId?: string | null;
    amount: number;
    status: RefundStatus;
    executionMethod: "gateway" | "manual";
  }[];
  adjustments: readonly { refundId: string; amount: number; status: string }[];
  settlements: readonly {
    id: string;
    status: string;
    netPayout: number;
    eligibilityReasons?: readonly string[];
  }[];
  disputes: readonly {
    id: string;
    orderId?: string | null;
    category?: string | null;
    status: string;
  }[];
}

export function classifyFinanceReconciliation(input: FinanceReconciliationInput) {
  const findings: Array<{ resourceId: string; resourceType: string; issue: string }> = [];
  const orderIds = new Set(input.orders.map((order) => order.id));
  findings.push(
    ...classifyPaymentReconciliation(input.orders, input.attempts).map((finding) => ({
      resourceId: finding.orderId,
      resourceType: "order",
      issue: finding.issue,
    })),
  );
  for (const attempt of input.attempts) {
    if (attempt.status === "captured" && (!attempt.orderId || !orderIds.has(attempt.orderId))) {
      findings.push({
        resourceId: attempt.id ?? attempt.orderId ?? "unknown",
        resourceType: "payment",
        issue: "CAPTURED_PAYMENT_WITHOUT_VALID_ORDER",
      });
    }
  }
  const adjustmentByRefund = new Map(
    input.adjustments.map((adjustment) => [adjustment.refundId, adjustment]),
  );
  const activeRefundsByOrder = new Map<string, number>();
  const successfulRefundsByAttempt = new Map<string, number>();
  for (const refund of input.refunds) {
    if (["requested", "reviewing", "approved", "processing"].includes(refund.status)) {
      activeRefundsByOrder.set(refund.orderId, (activeRefundsByOrder.get(refund.orderId) ?? 0) + 1);
    }
    if (["refunded", "partially_refunded"].includes(refund.status) && refund.paymentAttemptId) {
      successfulRefundsByAttempt.set(
        refund.paymentAttemptId,
        (successfulRefundsByAttempt.get(refund.paymentAttemptId) ?? 0) + refund.amount,
      );
    }
    const adjustment = adjustmentByRefund.get(refund.id);
    if (refund.executionMethod === "gateway" && refund.status === "approved") {
      findings.push({
        resourceId: refund.id,
        resourceType: "refund",
        issue: "APPROVED_REFUND_AWAITING_GATEWAY_PROCESSING",
      });
    }
    if (refund.executionMethod === "gateway" && refund.status === "processing") {
      findings.push({
        resourceId: refund.id,
        resourceType: "refund",
        issue: "REFUND_AWAITING_GATEWAY_RESULT",
      });
    }
    if (refund.status === "failed") {
      findings.push({
        resourceId: refund.id,
        resourceType: "refund",
        issue: "REFUND_FAILED_REQUIRES_REVIEW",
      });
    }
    if (
      ["refunded", "partially_refunded"].includes(refund.status) &&
      (!adjustment || adjustment.amount < refund.amount)
    ) {
      findings.push({
        resourceId: refund.id,
        resourceType: "refund",
        issue: "COMPLETED_REFUND_NOT_REFLECTED_IN_SELLER_PAYABLE",
      });
    }
    if (
      ["refunded", "partially_refunded"].includes(refund.status) &&
      adjustment?.status === "unallocated"
    ) {
      findings.push({
        resourceId: refund.id,
        resourceType: "refund",
        issue: "REFUND_ADJUSTMENT_UNALLOCATED",
      });
    }
    if (
      ["refunded", "partially_refunded"].includes(refund.status) &&
      adjustment?.status === "recovery_due"
    ) {
      findings.push({
        resourceId: refund.id,
        resourceType: "refund",
        issue: "REFUND_RECOVERY_DUE",
      });
    }
  }
  for (const [orderId, count] of activeRefundsByOrder) {
    if (count > 1)
      findings.push({
        resourceId: orderId,
        resourceType: "order",
        issue: "DUPLICATE_OPEN_REFUNDS",
      });
  }
  const capturedAmounts = new Map(
    input.attempts
      .filter((attempt) => attempt.id && attempt.status === "captured")
      .map((attempt) => [attempt.id!, attempt.amount]),
  );
  for (const [attemptId, refunded] of successfulRefundsByAttempt) {
    const captured = capturedAmounts.get(attemptId);
    if (captured !== undefined && refunded > captured) {
      findings.push({
        resourceId: attemptId,
        resourceType: "payment",
        issue: "REFUNDS_EXCEED_CAPTURED_AMOUNT",
      });
    }
  }
  for (const settlement of input.settlements) {
    if (settlement.status === "held")
      findings.push({
        resourceId: settlement.id,
        resourceType: "settlement",
        issue: "PAYOUT_ON_HOLD",
      });
    if (settlement.status === "failed")
      findings.push({
        resourceId: settlement.id,
        resourceType: "settlement",
        issue: "PAYOUT_FAILED",
      });
    if (["pending", "processing"].includes(settlement.status) && settlement.netPayout > 0) {
      findings.push({
        resourceId: settlement.id,
        resourceType: "settlement",
        issue: "UNPAID_SETTLEMENT_REQUIRES_ELIGIBILITY_REVIEW",
      });
    }
    if (settlement.eligibilityReasons?.includes("FINANCIAL_DISPUTE_OPEN")) {
      findings.push({
        resourceId: settlement.id,
        resourceType: "settlement",
        issue: "UNRESOLVED_FINANCIAL_DISPUTE",
      });
    }
  }
  for (const dispute of input.disputes) {
    const category = (dispute.category ?? "").toLowerCase();
    if (
      ["payment", "refund"].includes(category) &&
      !["resolved", "cancelled", "refunded"].includes(dispute.status.toLowerCase())
    ) {
      findings.push({
        resourceId: dispute.id,
        resourceType: "dispute",
        issue: "UNRESOLVED_FINANCIAL_DISPUTE",
      });
    }
  }
  return findings;
}
