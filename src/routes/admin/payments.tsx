import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { IndianRupee, Clock, CheckCircle2, RotateCcw } from "lucide-react";

export const Route = createFileRoute("/admin/payments")({
  head: () => ({ meta: [{ title: "Payments — Admin" }, { name: "robots", content: "noindex" }] }),
  component: PaymentsPage,
});

const fmt = (n: number) => `₹${Number(n||0).toLocaleString("en-IN")}`;

function PaymentsPage() {
  const q = useQuery({
    queryKey: ["admin","payments"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("orders").select("id, buyer_name, total, status, created_at, seller_id").order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Array<{ id:string; buyer_name:string|null; total:number; status:string; created_at:string; seller_id:string }>;
    },
  });

  const stats = useMemo(() => {
    const list = q.data ?? [];
    const done = list.filter(o => o.status === "delivered");
    const pending = list.filter(o => ["new","accepted","packed","shipped"].includes(o.status));
    const refunds = list.filter(o => ["cancelled","returned"].includes(o.status));
    const total = done.reduce((a,o)=>a+Number(o.total||0),0);
    return { total, pending: pending.reduce((a,o)=>a+Number(o.total||0),0), refunds: refunds.reduce((a,o)=>a+Number(o.total||0),0), rows: list.slice(0,50) };
  }, [q.data]);

  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-black tracking-tight sm:text-3xl">Payments</h1><p className="text-sm text-muted-foreground">Marketplace transactions across all vendors.</p></div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 stagger">
        <Kpi icon={IndianRupee} label="Total Revenue" value={fmt(stats.total)} />
        <Kpi icon={Clock} label="Pending Payments" value={fmt(stats.pending)} tone="warn"/>
        <Kpi icon={CheckCircle2} label="Completed" value={fmt(stats.total)} tone="ok"/>
        <Kpi icon={RotateCcw} label="Refunds" value={fmt(stats.refunds)} tone="danger"/>
      </div>
      <Card><CardHeader><CardTitle className="text-base">Recent transactions</CardTitle></CardHeader>
        <CardContent className="p-0"><div className="divide-y divide-border">
          {stats.rows.length===0 ? <div className="grid place-items-center py-10 text-sm text-muted-foreground">No transactions yet.</div>
          : stats.rows.map(t => (
            <div key={t.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 px-4 py-3 items-center">
              <div className="min-w-0">
                <div className="truncate font-medium">{t.buyer_name || "Guest"} · #{t.id.slice(0,8)}</div>
                <div className="text-xs text-muted-foreground">{new Date(t.created_at).toLocaleString("en-IN")}</div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <Badge variant="outline" className="capitalize">{t.status}</Badge>
                <span className="font-semibold">{fmt(t.total)}</span>
              </div>
            </div>
          ))}
        </div></CardContent>
      </Card>
    </div>
  );
}

function Kpi({icon:Icon,label,value,tone="default"}:any) {
  const toneCls = tone==="warn"?"bg-accent/20 text-accent-foreground":tone==="danger"?"bg-destructive/15 text-destructive":tone==="ok"?"bg-success/15 text-success":"bg-primary/10 text-primary";
  return <Card className="hover-lift"><CardContent className="flex items-start gap-3 p-4">
    <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${toneCls}`}><Icon className="h-5 w-5"/></div>
    <div className="min-w-0"><div className="text-xs text-muted-foreground">{label}</div><div className="mt-0.5 text-xl font-black">{value}</div></div>
  </CardContent></Card>;
}
