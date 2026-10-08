import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

export interface CycleSummary {
  id: string;
  cycleStart: string;
  cycleEnd: string;
  payoutDate: string | null;
  gross: number;
  commission: number;
  gstOnFees: number;
  codFees: number;
  net: number;
  currentPayable?: number;
  refundDeductions?: number;
  recoveryDue?: number;
  unallocatedRefundAdjustments?: number;
  adjustmentDataAvailable?: boolean;
  status: "pending" | "processing" | "paid" | "held" | "failed";
  holdReason?: string | null;
  txns: Array<{
    orderId: string;
    orderNumber: string;
    date: string;
    gross: number;
    commission: number;
    gstOnFees: number;
    codFee: number;
    net: number;
    paymentMode: string;
  }>;
}

export function useMySettlements() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["my-settlements", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("settlements")
        .select(
          "id,cycle_start,cycle_end,gross_sales,commission,gst_on_fees,net_payout,status,paid_at,created_at,hold_reason",
        )
        .eq("user_id", user!.id)
        .order("cycle_start", { ascending: false });
      if (error) throw error;
      let adjustmentRows: any[] = [];
      let adjustmentDataAvailable = true;
      const settlementIds = (data ?? []).map((row: any) => row.id);
      if (settlementIds.length) {
        const { data: adjustments, error: adjustmentError } = await (supabase as any)
          .from("seller_financial_adjustments")
          .select("settlement_id,amount,status")
          .in("settlement_id", settlementIds);
        if (adjustmentError) {
          // This extension migration is prepared separately; preserve old
          // settlement reads until it is installed, but identify missing data.
          adjustmentDataAvailable = false;
          if (
            !/[42]P01|PGRST205|schema cache/i.test(
              adjustmentError.code ?? adjustmentError.message ?? "",
            )
          ) {
            throw adjustmentError;
          }
        } else {
          adjustmentRows = adjustments ?? [];
        }
      }
      return (data ?? []).map((row: any) => {
        const adjustments = adjustmentRows.filter((item) => item.settlement_id === row.id);
        const refundDeductions = adjustments
          .filter((item) => item.status === "deduct_before_payout")
          .reduce((sum, item) => sum + Number(item.amount || 0), 0);
        const recoveryDue = adjustments
          .filter((item) => item.status === "recovery_due")
          .reduce((sum, item) => sum + Number(item.amount || 0), 0);
        const unallocatedRefundAdjustments = adjustments
          .filter((item) => item.status === "unallocated")
          .reduce((sum, item) => sum + Number(item.amount || 0), 0);
        const originalNet = Number(row.net_payout);
        return {
          id: row.id,
          cycleStart: row.cycle_start,
          cycleEnd: row.cycle_end,
          payoutDate: row.paid_at ?? null,
          gross: Number(row.gross_sales),
          commission: Number(row.commission),
          gstOnFees: Number(row.gst_on_fees),
          codFees: 0,
          net: originalNet,
          refundDeductions,
          recoveryDue,
          unallocatedRefundAdjustments,
          adjustmentDataAvailable,
          currentPayable: row.status === "paid" ? originalNet : originalNet - refundDeductions,
          status: row.status,
          holdReason: row.hold_reason ?? null,
          // This schema stores cycle-level aggregates, not order-level allocations.
          txns: [],
        };
      }) as CycleSummary[];
    },
  });
}

export interface SellerFinancialAdjustmentSummary {
  id: string;
  amount: number;
  status: "deduct_before_payout" | "recovery_due" | "unallocated" | "recovered";
  createdAt: string;
  orderId: string;
}

export function useMyFinancialAdjustments(sellerId?: string) {
  return useQuery({
    queryKey: ["my-financial-adjustments", sellerId],
    enabled: Boolean(sellerId),
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("seller_financial_adjustments")
        .select("id,amount,status,created_at,order_id")
        .eq("seller_id", sellerId!)
        .order("created_at", { ascending: false });
      if (error) {
        if (/[42]P01|PGRST205|schema cache/i.test(error.code ?? error.message ?? "")) {
          return { available: false, rows: [] as SellerFinancialAdjustmentSummary[] };
        }
        throw error;
      }
      return {
        available: true,
        rows: (data ?? []).map((row: any) => ({
          id: row.id,
          amount: Number(row.amount),
          status: row.status,
          createdAt: row.created_at,
          orderId: row.order_id,
        })) as SellerFinancialAdjustmentSummary[],
      };
    },
  });
}
