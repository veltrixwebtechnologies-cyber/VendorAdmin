import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/orders")({
  head: () => ({ meta: [{ title: "Orders — Admin" }, { name: "robots", content: "noindex" }] }),
  component: AdminOrders,
});

type Row = { id: string; buyer_name: string | null; total: number; status: string; created_at: string; seller_id: string; user_id: string; subtotal: number; shipping_fee: number };

function useAllOrders() {
  const qc = useQueryClient();
  const query = useQuery<Row[]>({
    queryKey: ["admin","orders"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("orders").select("id, buyer_name, total, subtotal, shipping_fee, status, created_at, seller_id, user_id").order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: 5_000,
  });

  useEffect(() => {
    const channel = supabase
      .channel("admin-orders")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => {
        void qc.invalidateQueries({ queryKey: ["admin", "orders"] });
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [qc]);

  return query;
}

function AdminOrders() {
  const q = useAllOrders();
  const qc = useQueryClient();
  const upd = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { data, error } = await (supabase as any).rpc("admin_advance_order", { _order_id: id, _next_status: status });
      if (error) throw error;
      if (!data) throw new Error("Order status was not updated");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin","orders"] }),
  });
  const [status, setStatus] = useState<"all"|"new"|"accepted"|"packed"|"shipped"|"delivered"|"cancelled"|"returned">("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const perPage = 15;

  const rows = useMemo(() => {
    let r = q.data ?? [];
    if (status !== "all") r = r.filter(o => o.status === status);
    if (search.trim()) { const s = search.toLowerCase(); r = r.filter(o => (o.buyer_name??"").toLowerCase().includes(s) || o.id.toLowerCase().includes(s)); }
    return r;
  }, [q.data, status, search]);
  const pages = Math.max(1, Math.ceil(rows.length/perPage));
  const p = Math.min(page, pages);
  const paged = rows.slice((p-1)*perPage, p*perPage);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-black tracking-tight sm:text-3xl">Orders</h1>
        <p className="text-sm text-muted-foreground">Every order across every vendor.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {(["all","new","accepted","packed","shipped","delivered","cancelled","returned"] as const).map(f => (
          <Button key={f} size="sm" variant={status===f?"default":"outline"} onClick={()=>{setStatus(f);setPage(1);}} className="rounded-full capitalize">{f}</Button>
        ))}
        <div className="relative ml-auto w-full sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground"/>
          <Input placeholder="Search buyer or order id" value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}} className="pl-8 h-9"/>
        </div>
      </div>

      {q.isLoading ? <div className="grid gap-2">{Array.from({length:5}).map((_,i)=><div key={i} className="h-14 animate-pulse rounded-xl bg-muted"/>)}</div>
      : paged.length===0 ? <Card><CardContent className="grid place-items-center py-16 text-sm text-muted-foreground">No orders yet.</CardContent></Card>
      : (
        <Card><CardContent className="p-0"><div className="divide-y divide-border">
          {paged.map(o => (
            <div key={o.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-3 sm:px-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-medium">{o.buyer_name || "Guest"}</span>
                  <Badge variant="outline" className="text-[10px] capitalize">{o.status}</Badge>
                </div>
                <div className="truncate text-xs text-muted-foreground">#{o.id.slice(0,8)} · {new Date(o.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} · ₹{Number(o.total||0).toLocaleString("en-IN")}</div>
              </div>
              <div className="flex flex-wrap gap-1">
                {o.status === "new" && <Button size="sm" variant="outline" onClick={()=>upd.mutate({id:o.id,status:"accepted"},{onSuccess:()=>toast.success("Accepted")})}>Accept</Button>}
                {o.status === "accepted" && <Button size="sm" variant="outline" onClick={()=>upd.mutate({id:o.id,status:"packed"},{onSuccess:()=>toast.success("Packed")})}>Pack</Button>}
                {o.status === "packed" && <Button size="sm" variant="outline" onClick={()=>upd.mutate({id:o.id,status:"ready_for_pickup"},{onSuccess:()=>toast.success("Ready for pickup")})}>Ready</Button>}
                {o.status === "out_for_delivery" && <Button size="sm" variant="outline" onClick={()=>upd.mutate({id:o.id,status:"delivered"},{onSuccess:()=>toast.success("Delivered")})}>Deliver</Button>}
                {!['cancelled','returned','delivered'].includes(o.status) && <Button size="sm" variant="outline" onClick={()=>upd.mutate({id:o.id,status:"cancelled"},{onSuccess:()=>toast.success("Cancelled")})}>Cancel</Button>}
                {o.status === "delivered" && <Button size="sm" variant="outline" onClick={()=>upd.mutate({id:o.id,status:"returned"},{onSuccess:()=>toast.success("Marked returned; refund requires payment-provider processing")})}>Return</Button>}
              </div>
            </div>
          ))}
        </div></CardContent></Card>
      )}

      {rows.length > perPage && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Showing {(p-1)*perPage+1}-{Math.min(p*perPage, rows.length)} of {rows.length}</span>
          <div className="flex gap-1">
            <Button size="sm" variant="outline" disabled={p<=1} onClick={()=>setPage(p-1)}>Previous</Button>
            <Button size="sm" variant="outline" disabled={p>=pages} onClick={()=>setPage(p+1)}>Next</Button>
          </div>
        </div>
      )}
    </div>
  );
}
