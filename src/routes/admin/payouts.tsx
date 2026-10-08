import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Wallet, Clock, CheckCircle2, Download } from "lucide-react";
import { useAdminAccess, adminErrorMessage } from "@/shared/auth/admin-permissions";

export const Route = createFileRoute("/admin/payouts")({
  head: () => ({
    meta: [{ title: "Seller Payouts — Admin" }, { name: "robots", content: "noindex" }],
  }),
  component: PayoutsPage,
});

const fmt = (n: number) =>
  `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

function PayoutsPage() {
  const access = useAdminAccess();
  const canManage = access.hasPermission("payouts.manage");
  const qc = useQueryClient();
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const q = useQuery({
    queryKey: ["admin", "settlements"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("settlements")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
  const hold = useMutation({
    mutationFn: async ({
      id,
      action,
      reason,
    }: {
      id: string;
      action: "hold" | "release";
      reason?: string;
    }) => {
      const { error } = await (supabase as any).rpc("manage_settlement_hold", {
        p_settlement_id: id,
        p_action: action,
        p_reason: reason ?? null,
      });
      if (error) throw error;
    },
    onSuccess: async (_data, variables) => {
      toast.success(
        variables.action === "hold"
          ? "Settlement placed on hold."
          : "Hold released; settlement returned to its prior workflow status.",
      );
      setReasons((current) => ({ ...current, [variables.id]: "" }));
      await qc.invalidateQueries({ queryKey: ["admin", "settlements"] });
    },
    onError: (error) =>
      toast.error(adminErrorMessage(error, "Payout action could not be completed.")),
  });

  const stats = useMemo(() => {
    const rows = q.data ?? [];
    return {
      pending: rows.filter((row) => row.status === "pending" || row.status === "processing").length,
      held: rows.filter((row) => row.status === "held").length,
      paidAmount: rows
        .filter((row) => row.status === "paid")
        .reduce((sum, row) => sum + Number(row.net_payout || 0), 0),
    };
  }, [q.data]);

  const exportCsv = () => {
    const rows = q.data ?? [];
    const csv = [
      "settlement_id,seller_id,gross_sales,commission,gst_on_fees,net_payout,status,hold_reason,created_at",
      ...rows.map((row) =>
        [
          row.id,
          row.seller_id,
          row.gross_sales,
          row.commission,
          row.gst_on_fees,
          row.net_payout,
          row.status,
          JSON.stringify(row.hold_reason ?? ""),
          row.created_at,
        ].join(","),
      ),
    ].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `settlements-${Date.now()}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-black tracking-tight sm:text-3xl">Seller Payouts</h1>
          <p className="text-sm text-muted-foreground">
            Review seller-owned settlements and place or release documented holds. This screen does
            not initiate bank transfers or mark settlements paid.
          </p>
        </div>
        <Button variant="outline" onClick={exportCsv} className="gap-1">
          <Download className="h-4 w-4" />
          Export CSV
        </Button>
      </header>
      {q.isError && (
        <Card>
          <CardContent className="p-5 text-sm text-destructive">
            {adminErrorMessage(q.error, "Payouts could not be loaded.")}
          </CardContent>
        </Card>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <Kpi icon={Clock} label="Pending / processing" value={stats.pending} />
        <Kpi icon={Wallet} label="On hold" value={stats.held} />
        <Kpi icon={CheckCircle2} label="Recorded paid total" value={fmt(stats.paidAmount)} />
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Settlement history (latest 500)</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y divide-border">
            {q.isLoading ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                Loading settlements…
              </div>
            ) : !q.data?.length ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                No settlement records available.
              </div>
            ) : (
              q.data.map((settlement) => (
                <div key={settlement.id} className="space-y-3 px-4 py-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="mr-auto min-w-0">
                      <div className="truncate font-medium">
                        Settlement #{String(settlement.id).slice(0, 8)} · Seller #
                        {String(settlement.seller_id).slice(0, 8)}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Gross {fmt(settlement.gross_sales)} · Commission{" "}
                        {fmt(settlement.commission)} · GST on fees {fmt(settlement.gst_on_fees)} ·
                        Net {fmt(settlement.net_payout)}
                      </div>
                      {settlement.hold_reason && (
                        <div className="mt-1 text-xs text-amber-700">
                          Hold reason: {settlement.hold_reason}
                        </div>
                      )}
                    </div>
                    <Badge variant="outline" className="capitalize">
                      {settlement.status}
                    </Badge>
                    {settlement.paid_at && (
                      <span className="text-xs text-muted-foreground">
                        Paid {new Date(settlement.paid_at).toLocaleDateString("en-IN")}
                      </span>
                    )}
                  </div>
                  {canManage && settlement.status !== "paid" && (
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      {settlement.status !== "held" ? (
                        <>
                          <Input
                            aria-label="Reason for payout hold"
                            maxLength={1000}
                            placeholder="Required reason to place on hold"
                            value={reasons[settlement.id] ?? ""}
                            onChange={(event) =>
                              setReasons((current) => ({
                                ...current,
                                [settlement.id]: event.target.value,
                              }))
                            }
                            className="sm:max-w-md"
                          />
                          <Button
                            variant="outline"
                            disabled={!reasons[settlement.id]?.trim() || hold.isPending}
                            onClick={() => {
                              if (
                                window.confirm(
                                  "Place this seller settlement on hold? The reason will be recorded.",
                                )
                              )
                                hold.mutate({
                                  id: settlement.id,
                                  action: "hold",
                                  reason: reasons[settlement.id].trim(),
                                });
                            }}
                          >
                            Place on hold
                          </Button>
                        </>
                      ) : (
                        <Button
                          variant="outline"
                          disabled={hold.isPending}
                          onClick={() => {
                            if (
                              window.confirm(
                                "Release this settlement hold? Eligibility will be checked by the database.",
                              )
                            )
                              hold.mutate({
                                id: settlement.id,
                                action: "release",
                                reason: reasons[settlement.id]?.trim() || "Finance hold release",
                              });
                          }}
                        >
                          Release hold
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
          <p className="border-t px-4 py-3 text-xs text-muted-foreground">
            Payout eligibility and hold changes require the database RPC and payouts.manage
            permission. Actual payout processing remains outside this workflow.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function Kpi({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Wallet;
  label: string;
  value: string | number;
}) {
  return (
    <Card>
      <CardContent className="flex items-start gap-3 p-4">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="mt-0.5 text-xl font-black">{value}</div>
        </div>
      </CardContent>
    </Card>
  );
}
