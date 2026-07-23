import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Wallet, Clock, CheckCircle2, Download } from "lucide-react";

export const Route = createFileRoute("/admin/payouts")({
  head: () => ({ meta: [{ title: "Vendor Payouts — Admin" }, { name: "robots", content: "noindex" }] }),
  component: PayoutsPage,
});

const fmt = (n: number) => `₹${Number(n||0).toLocaleString("en-IN")}`;

function PayoutsPage() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["admin","payouts"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("settlements").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Array<any>;
    },
  });
  const upd = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const patch: any = { status };
      if (status === "paid") patch.paid_at = new Date().toISOString();
      const { error } = await (supabase as any).from("settlements").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin","payouts"] }),
  });

  const stats = useMemo(() => {
    const s = q.data ?? [];
    return {
      pending: s.filter((x:any) => x.status === "pending"),
      paid: s.filter((x:any) => x.status === "paid"),
      total: s.reduce((a:number,x:any)=>a+Number(x.net_payout||0),0),
    };
  }, [q.data]);

  const exportCsv = () => {
    const rows = q.data ?? [];
    const csv = ["settlement_id,seller_id,gross_sales,commission,gst_on_fees,net_payout,status,created_at",
      ...rows.map((r:any)=>[r.id,r.seller_id,r.gross_sales,r.commission,r.gst_on_fees,r.net_payout,r.status,r.created_at].join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" }); const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `settlements-${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div><h1 className="text-2xl font-black tracking-tight sm:text-3xl">Vendor Payouts</h1><p className="text-sm text-muted-foreground">Release, hold and reconcile vendor settlements.</p></div>
        <Button variant="outline" onClick={exportCsv} className="gap-1"><Download className="h-4 w-4"/>Export CSV</Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-3 stagger">
        <Kpi icon={Clock} label="Pending settlements" value={stats.pending.length} tone="warn"/>
        <Kpi icon={CheckCircle2} label="Completed settlements" value={stats.paid.length} tone="ok"/>
        <Kpi icon={Wallet} label="Total settled" value={fmt(stats.total)} />
      </div>

      <Card><CardHeader><CardTitle className="text-base">Settlement history</CardTitle></CardHeader>
        <CardContent className="p-0"><div className="divide-y divide-border">
          {(q.data??[]).length===0 ? <div className="grid place-items-center py-10 text-sm text-muted-foreground">No settlements yet.</div>
          : (q.data ?? []).map((s:any) => (
            <div key={s.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 px-4 py-3 items-center">
              <div className="min-w-0">
                <div className="truncate font-medium">Settlement #{String(s.id).slice(0,8)}</div>
                <div className="text-xs text-muted-foreground">Gross {fmt(s.gross_sales)} · Fees {fmt(Number(s.commission||0)+Number(s.gst_on_fees||0))} · Net {fmt(s.net_payout)}</div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Badge variant="outline" className="capitalize">{s.status}</Badge>
                {s.status !== "paid" && <Button size="sm" onClick={()=>upd.mutate({id:s.id,status:"paid"},{onSuccess:()=>toast.success("Marked paid")})}>Release</Button>}
                {s.status !== "held" && s.status !== "paid" && <Button size="sm" variant="outline" onClick={()=>upd.mutate({id:s.id,status:"held"},{onSuccess:()=>toast.success("Held")})}>Hold</Button>}
              </div>
            </div>
          ))}
        </div></CardContent>
      </Card>
    </div>
  );
}

function Kpi({icon:Icon,label,value,tone="default"}:any) {
  const toneCls = tone==="warn"?"bg-accent/20 text-accent-foreground":tone==="ok"?"bg-success/15 text-success":"bg-primary/10 text-primary";
  return <Card className="hover-lift"><CardContent className="flex items-start gap-3 p-4">
    <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${toneCls}`}><Icon className="h-5 w-5"/></div>
    <div className="min-w-0"><div className="text-xs text-muted-foreground">{label}</div><div className="mt-0.5 text-xl font-black">{value}</div></div>
  </CardContent></Card>;
}
