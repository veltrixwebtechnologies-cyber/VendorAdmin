import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { Download, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useMySeller } from "@/lib/db";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

export const Route = createFileRoute("/seller/reports")({
  head: () => ({ meta: [{ title: "Reports — Seller Hub" }, { name: "description", content: "Downloadable sales, orders, inventory and payment reports." }] }),
  component: ReportsPage,
});

type Row = Record<string, string | number | null>;
function csv(rows: Row[]) {
  if (!rows.length) return "";
  const columns = Object.keys(rows[0]);
  const quote = (v: unknown) => `"${String(v ?? "").replaceAll('"', '""')}"`;
  return [columns.map(quote).join(","), ...rows.map(r => columns.map(c => quote(r[c])).join(","))].join("\n");
}
function download(name: string, rows: Row[]) {
  if (!rows.length) return toast.info("No data available for this report");
  const url = URL.createObjectURL(new Blob([csv(rows)], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a"); link.href = url; link.download = name; link.click(); URL.revokeObjectURL(url);
  toast.success("Report downloaded");
}

function ReportsPage() {
  const seller = useMySeller();
  const sellerId = seller.data?.id;
  const report = useQuery({
    queryKey: ["seller-reports", sellerId], enabled: !!sellerId,
    queryFn: async () => {
      const [orders, products] = await Promise.all([
        supabase.from("orders").select("id,order_number,status,subtotal,shipping_fee,total,payment_method,placed_at,delivered_at").eq("seller_id", sellerId!).order("placed_at", { ascending: false }),
        supabase.from("products").select("id,name,sku,category,selling_price,stock,status,updated_at").eq("seller_id", sellerId!).order("name"),
      ]);
      if (orders.error) throw orders.error; if (products.error) throw products.error;
      return { orders: orders.data ?? [], products: products.data ?? [] };
    },
  });
  const reports = useMemo(() => {
    const orders = report.data?.orders ?? [], products = report.data?.products ?? [];
    return [
      { name: "Sales report", rows: orders.map(o => ({ order_number: o.order_number, status: o.status, subtotal: o.subtotal, delivery_fee: o.shipping_fee, total: o.total, placed_at: o.placed_at })) },
      { name: "Orders report", rows: orders.map(o => ({ order_number: o.order_number, status: o.status, payment_method: o.payment_method, placed_at: o.placed_at, delivered_at: o.delivered_at })) },
      { name: "Inventory report", rows: products.map(p => ({ name: p.name, sku: p.sku, category: p.category, price: p.selling_price, stock: p.stock, status: p.status, updated_at: p.updated_at })) },
      { name: "Payment report", rows: orders.map(o => ({ order_number: o.order_number, payment_method: o.payment_method, amount: o.total, status: o.status, placed_at: o.placed_at })) },
    ];
  }, [report.data]);

  if (seller.isLoading || report.isLoading) return <div className="grid min-h-64 place-items-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  if (seller.error || report.error) return <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">Could not load reports. Refresh and try again.</p>;
  return <div className="space-y-4">
    <div><h1 className="text-2xl font-black tracking-tight sm:text-3xl">Reports</h1><p className="text-sm text-muted-foreground">Download your seller sales, orders, inventory and payment reports.</p></div>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {reports.map(r => <Card key={r.name} className="hover-lift"><CardHeader><CardTitle className="text-base">{r.name}</CardTitle></CardHeader><CardContent className="flex items-center justify-between"><span className="text-sm text-muted-foreground">{r.rows.length} rows</span><Button size="sm" variant="outline" className="gap-1" onClick={() => download(`${r.name.toLowerCase().replaceAll(" ", "-")}.csv`, r.rows)}><Download className="h-4 w-4" />CSV</Button></CardContent></Card>)}
    </div>
  </div>;
}
