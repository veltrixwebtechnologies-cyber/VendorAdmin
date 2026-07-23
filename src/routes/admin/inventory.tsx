import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Boxes, AlertTriangle, TrendingDown, Search } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/inventory")({
  head: () => ({ meta: [{ title: "Inventory — Admin" }, { name: "robots", content: "noindex" }] }),
  component: InventoryPage,
});

function InventoryPage() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["admin","inventory"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("products").select("id, name, category, stock, status, low_stock_threshold").order("stock", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Array<{ id:string; name:string; category:string|null; stock:number; status:string; low_stock_threshold:number|null }>;
    },
  });
  const upd = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Record<string, any> }) => {
      const { error } = await (supabase as any).from("products").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin","inventory"] }),
  });

  const [search, setSearch] = useState("");
  const rows = useMemo(() => {
    let r = q.data ?? [];
    if (search.trim()) { const s = search.toLowerCase(); r = r.filter(p => p.name.toLowerCase().includes(s)); }
    return r;
  }, [q.data, search]);
  const total = (q.data??[]).reduce((a,p)=>a+Number(p.stock||0),0);
  const low = (q.data??[]).filter(p => Number(p.stock||0) > 0 && Number(p.stock||0) <= (Number(p.low_stock_threshold||5))).length;
  const out = (q.data??[]).filter(p => Number(p.stock||0) === 0).length;

  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-black tracking-tight sm:text-3xl">Inventory</h1><p className="text-sm text-muted-foreground">Stock levels across every listing.</p></div>
      <div className="grid gap-3 sm:grid-cols-3 stagger">
        <Kpi icon={Boxes} label="Total stock units" value={total.toLocaleString("en-IN")} />
        <Kpi icon={AlertTriangle} label="Low stock products" value={low} tone="warn"/>
        <Kpi icon={TrendingDown} label="Out of stock" value={out} tone="danger"/>
      </div>
      <div className="relative w-full sm:max-w-xs">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground"/>
        <Input placeholder="Search product" value={search} onChange={e=>setSearch(e.target.value)} className="pl-8 h-9"/>
      </div>
      <Card><CardContent className="p-0"><div className="divide-y divide-border">
        {q.isLoading ? <div className="grid gap-2 p-3">{Array.from({length:4}).map((_,i)=><div key={i} className="h-14 animate-pulse rounded-xl bg-muted"/>)}</div>
        : rows.length===0 ? <div className="grid place-items-center py-10 text-sm text-muted-foreground">No products.</div>
        : rows.map(p => {
          const isOut = Number(p.stock||0)===0;
          const isLow = !isOut && Number(p.stock||0) <= Number(p.low_stock_threshold||5);
          return (
            <div key={p.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 px-4 py-3 items-center">
              <div className="min-w-0">
                <div className="truncate font-medium">{p.name}</div>
                <div className="text-xs text-muted-foreground">{p.category || "Uncategorized"}</div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {isOut && <Badge variant="destructive">Out</Badge>}
                {isLow && <Badge variant="outline" className="border-accent text-accent-foreground">Low</Badge>}
                <Input type="number" defaultValue={p.stock ?? 0} className="h-8 w-20" onBlur={e=>{
                  const n = Number(e.target.value);
                  if (n !== p.stock) upd.mutate({id:p.id, patch:{stock:n}},{onSuccess:()=>toast.success("Stock updated")});
                }} />
                <Button size="sm" variant="outline" onClick={()=>upd.mutate({id:p.id, patch:{status: p.status==="hidden"?"approved":"hidden"}},{onSuccess:()=>toast.success(p.status==="hidden"?"Enabled":"Disabled")})}>
                  {p.status==="hidden" ? "Enable" : "Disable"}
                </Button>
              </div>
            </div>
          );
        })}
      </div></CardContent></Card>
    </div>
  );
}

function Kpi({icon:Icon,label,value,tone="default"}:any) {
  const toneCls = tone==="warn"?"bg-accent/20 text-accent-foreground":tone==="danger"?"bg-destructive/15 text-destructive":"bg-primary/10 text-primary";
  return <Card className="hover-lift"><CardContent className="flex items-start gap-3 p-4">
    <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${toneCls}`}><Icon className="h-5 w-5"/></div>
    <div className="min-w-0"><div className="text-xs text-muted-foreground">{label}</div><div className="mt-0.5 text-xl font-black">{value}</div></div>
  </CardContent></Card>;
}
