import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { IndianRupee, Clock, CheckCircle2, CircleX } from "lucide-react";
import { adminErrorMessage } from "@/shared/auth/admin-permissions";

export const Route = createFileRoute("/admin/payments")({
  head: () => ({ meta: [{ title: "Payments — Admin" }, { name: "robots", content: "noindex" }] }),
  component: PaymentsPage,
});

const fmt = (n: number) =>
  `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
type PaymentAttempt = {
  id: string;
  order_id: string | null;
  provider: string;
  provider_order_id: string;
  provider_payment_id: string | null;
  amount: number;
  status: string;
  created_at: string;
};

function PaymentsPage() {
  const q = useQuery({
    queryKey: ["admin", "payment-attempts"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("payment_attempts")
        .select(
          "id, order_id, provider, provider_order_id, provider_payment_id, amount, status, created_at",
        )
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as PaymentAttempt[];
    },
  });

  const stats = useMemo(() => {
    const rows = q.data ?? [];
    return {
      captured: rows
        .filter((p) => p.status === "captured")
        .reduce((n, p) => n + Number(p.amount || 0), 0),
      pending: rows.filter((p) => ["created", "pending", "authorized"].includes(p.status)).length,
      failed: rows.filter((p) => p.status === "failed").length,
      capturedCount: rows.filter((p) => p.status === "captured").length,
    };
  }, [q.data]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black tracking-tight sm:text-3xl">Payments</h1>
        <p className="text-sm text-muted-foreground">
          Gateway payment attempts. COD is recorded on orders and is not counted as a gateway
          capture.
        </p>
      </div>
      {q.isError ? (
        <Card>
          <CardContent className="p-5 text-sm text-destructive">
            {adminErrorMessage(q.error, "Payment attempts could not be loaded.")}
          </CardContent>
        </Card>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 stagger">
        <Kpi
          icon={IndianRupee}
          label="Captured in loaded records"
          value={fmt(stats.captured)}
          tone="ok"
        />
        <Kpi icon={Clock} label="Open payment attempts" value={stats.pending} tone="warn" />
        <Kpi icon={CircleX} label="Failed attempts" value={stats.failed} tone="danger" />
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent gateway attempts (latest 100)</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y divide-border">
            {q.isLoading ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                Loading payment attempts…
              </div>
            ) : !q.data?.length ? (
              <div className="grid place-items-center py-10 text-sm text-muted-foreground">
                No gateway payment attempts found.
              </div>
            ) : (
              q.data.map((p) => (
                <div
                  key={p.id}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium">
                      {p.provider.toUpperCase()} ·{" "}
                      {p.order_id ? `Order #${p.order_id.slice(0, 8)}` : "Order not linked"}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {p.provider_payment_id || p.provider_order_id} ·{" "}
                      {new Date(p.created_at).toLocaleString("en-IN")}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="capitalize">
                      {p.status}
                    </Badge>
                    <span className="font-semibold">{fmt(Number(p.amount))}</span>
                  </div>
                </div>
              ))
            )}
          </div>
          <p className="border-t px-4 py-3 text-xs text-muted-foreground">
            Captured totals reflect only the latest 100 visible payment attempts, not a full ledger
            reconciliation. Use Reconciliation for consistency checks.
          </p>
        </CardContent>
      </Card>
      <span className="sr-only">{stats.capturedCount} captured attempts</span>
    </div>
  );
}

function Kpi({
  icon: Icon,
  label,
  value,
  tone = "default",
}: {
  icon: typeof IndianRupee;
  label: string;
  value: string | number;
  tone?: string;
}) {
  const toneCls =
    tone === "warn"
      ? "bg-accent/20 text-accent-foreground"
      : tone === "danger"
        ? "bg-destructive/15 text-destructive"
        : tone === "ok"
          ? "bg-success/15 text-success"
          : "bg-primary/10 text-primary";
  return (
    <Card>
      <CardContent className="flex items-start gap-3 p-4">
        <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${toneCls}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="mt-0.5 text-xl font-black">{value}</div>
        </div>
      </CardContent>
    </Card>
  );
}
