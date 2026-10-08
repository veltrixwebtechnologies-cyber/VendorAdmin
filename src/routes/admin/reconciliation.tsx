import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { classifyFinanceReconciliation } from "@/lib/finance-domain";
import { adminErrorMessage, useAdminAccess } from "@/shared/auth/admin-permissions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, CheckCircle2 } from "lucide-react";

export const Route = createFileRoute("/admin/reconciliation")({
  head: () => ({
    meta: [{ title: "Financial Reconciliation — Admin" }, { name: "robots", content: "noindex" }],
  }),
  component: ReconciliationPage,
});

function ReconciliationPage() {
  const access = useAdminAccess();
  const canReadRefunds = access.hasPermission("refunds.view");
  const canReadPayouts = access.hasPermission("payouts.view");
  const q = useQuery({
    queryKey: ["admin", "finance-reconciliation", canReadRefunds, canReadPayouts],
    queryFn: async () => {
      const [orders, attempts, refunds, adjustments, settlements] = await Promise.all([
        (supabase as any)
          .from("orders")
          .select("id,order_number,payment_method,payment_status,status,created_at")
          .order("created_at", { ascending: false })
          .limit(1000),
        (supabase as any)
          .from("payment_attempts")
          .select("id,order_id,status,amount")
          .order("created_at", { ascending: false })
          .limit(2000),
        canReadRefunds
          ? (supabase as any)
              .from("refunds")
              .select("id,order_id,payment_attempt_id,amount,status,execution_method")
              .order("requested_at", { ascending: false })
              .limit(1000)
          : Promise.resolve({ data: [], error: null }),
        canReadPayouts
          ? (supabase as any)
              .from("seller_financial_adjustments")
              .select("refund_id,amount,status")
              .limit(2000)
          : Promise.resolve({ data: [], error: null }),
        canReadPayouts
          ? (supabase as any)
              .from("settlements")
              .select("id,status,net_payout")
              .order("created_at", { ascending: false })
              .limit(500)
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (orders.error) throw orders.error;
      if (attempts.error) throw attempts.error;
      if (refunds.error) throw refunds.error;
      if (adjustments.error) throw adjustments.error;
      if (settlements.error) throw settlements.error;
      const recentSettlements = settlements.data ?? [];
      const eligibility = canReadPayouts
        ? await Promise.all(
            recentSettlements.map(async (settlement: any) => {
              const { data, error } = await (supabase as any).rpc("get_payout_eligibility", {
                p_settlement_id: settlement.id,
              });
              if (error)
                return { ...settlement, eligibilityReasons: ["ELIGIBILITY_CHECK_UNAVAILABLE"] };
              const result = Array.isArray(data) ? data[0] : data;
              return { ...settlement, eligibilityReasons: result?.reasons ?? [] };
            }),
          )
        : recentSettlements;
      return {
        orders: orders.data ?? [],
        attempts: attempts.data ?? [],
        refunds: refunds.data ?? [],
        adjustments: adjustments.data ?? [],
        settlements: eligibility,
      };
    },
  });
  const findings = q.data
    ? classifyFinanceReconciliation({
        orders: q.data.orders.map((o: any) => ({
          id: o.id,
          orderNumber: o.order_number,
          paymentMethod: o.payment_method ?? "cod",
          paymentStatus: o.payment_status ?? "pending",
          orderStatus: o.status,
        })),
        attempts: q.data.attempts.map((p: any) => ({
          id: p.id,
          orderId: p.order_id,
          status: p.status,
          amount: Number(p.amount),
        })),
        refunds: q.data.refunds.map((r: any) => ({
          id: r.id,
          orderId: r.order_id,
          paymentAttemptId: r.payment_attempt_id,
          amount: Number(r.amount),
          status: r.status,
          executionMethod: r.execution_method,
        })),
        adjustments: q.data.adjustments.map((a: any) => ({
          refundId: a.refund_id,
          amount: Number(a.amount),
          status: a.status,
        })),
        settlements: q.data.settlements.map((s: any) => ({
          id: s.id,
          status: s.status,
          netPayout: Number(s.net_payout),
          eligibilityReasons: s.eligibilityReasons,
        })),
        disputes: [],
      })
    : [];
  const labels: Record<string, string> = {
    PAID_ORDER_WITHOUT_CAPTURED_ATTEMPT: "Marked paid without a captured gateway attempt",
    FAILED_ATTEMPT_ON_PAID_ORDER: "Failed attempt exists alongside paid order status",
    CAPTURED_ATTEMPT_ORDER_NOT_PAID: "Captured payment but order is not marked paid",
    FULFILLED_ORDER_PAYMENT_UNCONFIRMED: "Fulfilled prepaid order has no confirmed capture",
    CAPTURED_PAYMENT_WITHOUT_VALID_ORDER: "Captured transaction is not linked to a valid order",
    APPROVED_REFUND_AWAITING_GATEWAY_PROCESSING:
      "Approved gateway refund has not started processing",
    REFUND_AWAITING_GATEWAY_RESULT: "Gateway refund is still awaiting a final result",
    REFUND_FAILED_REQUIRES_REVIEW: "Refund execution failed and needs finance review",
    COMPLETED_REFUND_NOT_REFLECTED_IN_SELLER_PAYABLE:
      "Completed refund has no matching seller payable deduction",
    REFUND_ADJUSTMENT_UNALLOCATED: "Refund deduction could not be allocated to a settlement cycle",
    REFUND_RECOVERY_DUE: "Refund was completed after payout; recovery requires finance review",
    PAYOUT_ON_HOLD: "Settlement is on hold",
    PAYOUT_FAILED: "Payout is marked failed",
    UNPAID_SETTLEMENT_REQUIRES_ELIGIBILITY_REVIEW:
      "Pending settlement requires eligibility review before payout",
    UNRESOLVED_FINANCIAL_DISPUTE: "An unresolved payment/refund dispute affects payout eligibility",
    DUPLICATE_OPEN_REFUNDS: "Multiple refund requests are open for the same order",
    REFUNDS_EXCEED_CAPTURED_AMOUNT: "Successful refunds exceed the captured payment amount",
    ELIGIBILITY_CHECK_UNAVAILABLE:
      "Payout eligibility could not be confirmed; investigate before processing",
  };
  return (
    <main className="space-y-5">
      <header>
        <h1 className="text-2xl font-black tracking-tight sm:text-3xl">Financial Reconciliation</h1>
        <p className="text-sm text-muted-foreground">
          Checks across persisted orders, payment attempts, refunds, refund adjustments, and
          settlement eligibility. This is not a ledger or external gateway statement.
        </p>
      </header>
      {q.isError ? (
        <Card>
          <CardContent className="p-5 text-sm text-destructive">
            {adminErrorMessage(q.error, "Reconciliation data could not be loaded.")}
          </CardContent>
        </Card>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <Summary label="Orders inspected" value={q.data?.orders.length ?? "—"} />
        <Summary label="Potential inconsistencies" value={q.data ? findings.length : "—"} />
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Payment/order consistency findings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {q.isLoading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Checking recent records…
            </p>
          ) : !findings.length ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 text-success" />
              No inconsistencies found in the loaded records.
            </div>
          ) : (
            findings.map((item, index) => (
              <article
                key={`${item.resourceType}-${item.resourceId}-${item.issue}-${index}`}
                className="flex flex-wrap items-center gap-2 rounded-lg border p-3"
              >
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                <span className="font-medium">
                  {`${item.resourceType} ${item.resourceId.slice(0, 8)}`}
                </span>
                <Badge variant="outline">{item.issue}</Badge>
                <span className="w-full text-xs text-muted-foreground sm:w-auto sm:ml-auto">
                  {labels[item.issue] ?? "Review required"}
                </span>
              </article>
            ))
          )}
          <p className="border-t pt-3 text-xs text-muted-foreground">
            Checks inspect a bounded recent window only. Settlement eligibility is queried per
            settlement; this does not verify external Razorpay balances or execute payouts.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
function Summary({ label, value }: { label: string; value: string | number }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-bold">{value}</p>
      </CardContent>
    </Card>
  );
}
