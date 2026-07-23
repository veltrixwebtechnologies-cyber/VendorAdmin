import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { TrendingUp, ShoppingBag, Package, IndianRupee, Percent } from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
  BarChart, Bar, PieChart, Pie, Cell, Legend,
} from "recharts";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/lib/auth";
import { listProducts, type ProductDto } from "@/lib/products.functions";
import { useMyOrders } from "@/lib/db";

export const Route = createFileRoute("/seller/analytics")({
  head: () => ({
    meta: [
      { title: "Analytics — Seller Hub" },
      { name: "description", content: "Sales trend, top products, fulfilment funnel and seller performance." },
      { property: "og:title", content: "Analytics — Seller Hub" },
      { property: "og:description", content: "Sales trend, top products, fulfilment funnel and seller performance." },
    ],
  }),
  component: AnalyticsPage,
});

const INR = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");

function AnalyticsPage() {
  const { user } = useAuth();
  const list = useServerFn(listProducts);
  const productsQ = useQuery<ProductDto[]>({ queryKey: ["products", user?.id], queryFn: () => list() as Promise<ProductDto[]>, enabled: !!user });
  const orders = useMyOrders().data ?? [];
  const products = productsQ.data ?? [];

  const kpi = useMemo(() => {
    const delivered = orders.filter((o) => o.status === "delivered");
    const cancelled = orders.filter((o) => o.status === "cancelled");
    const revenue = delivered.reduce((s, o) => s + o.total, 0);
    const units = delivered.reduce((s, o) => s + o.items.reduce((n, i) => n + i.qty, 0), 0);
    const aov = delivered.length ? revenue / delivered.length : 0;
    const cancelRate = orders.length ? (cancelled.length / orders.length) * 100 : 0;
    return { revenue, units, aov, cancelRate, orders: orders.length, delivered: delivered.length };
  }, [orders]);

  const trend = useMemo(() => {
    const days = 14;
    const buckets: { day: string; revenue: number; orders: number }[] = [];
    const now = new Date(); now.setHours(0, 0, 0, 0);
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now); d.setDate(d.getDate() - i);
      buckets.push({ day: d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }), revenue: 0, orders: 0 });
    }
    const map = new Map(buckets.map((b, i) => [b.day, i]));
    for (const o of orders) {
      const d = new Date(o.createdAt); d.setHours(0, 0, 0, 0);
      const key = d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
      const i = map.get(key); if (i === undefined) continue;
      buckets[i].orders += 1;
      if (o.status === "delivered") buckets[i].revenue += o.total;
    }
    return buckets;
  }, [orders]);

  const topProducts = useMemo(() => {
    const agg = new Map<string, { name: string; units: number; revenue: number }>();
    for (const o of orders.filter((x) => x.status === "delivered")) {
      for (const it of o.items) {
        const key = it.productId ?? it.name;
        const cur = agg.get(key) ?? { name: it.name, units: 0, revenue: 0 };
        cur.units += it.qty; cur.revenue += it.qty * it.price; agg.set(key, cur);
      }
    }
    return Array.from(agg.values()).sort((a, b) => b.revenue - a.revenue).slice(0, 5);
  }, [orders]);

  const statusMix = useMemo(() => {
    const c: Record<string, number> = {};
    for (const o of orders) c[o.status] = (c[o.status] ?? 0) + 1;
    return Object.entries(c).map(([name, value]) => ({ name, value }));
  }, [orders]);

  const catMix = useMemo(() => {
    const c: Record<string, number> = {};
    for (const p of products) c[p.category] = (c[p.category] ?? 0) + 1;
    return Object.entries(c).map(([name, value]) => ({ name, value }));
  }, [products]);

  const perf = useMemo(() => {
    const onTime = orders.filter((o) => o.status === "delivered").length;
    const cancelPenalty = Math.min(kpi.cancelRate, 20);
    const listingScore = products.length ? (products.filter((p) => p.status === "active").length / products.length) * 100 : 0;
    const spf = Math.max(0, Math.min(100, 60 + onTime * 2 - cancelPenalty + listingScore * 0.15));
    return { spf: Math.round(spf), onTime, listingScore: Math.round(listingScore) };
  }, [orders, products, kpi.cancelRate]);

  return (
    <div className="mx-auto max-w-6xl space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold">Performance & Analytics</h1>
        <p className="text-sm text-muted-foreground">Last 14 days across your catalog and orders.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 stagger">
        <Kpi label="Revenue" value={INR(kpi.revenue)} icon={<IndianRupee className="h-4 w-4" />} />
        <Kpi label="Orders" value={String(kpi.orders)} hint={`${kpi.delivered} delivered`} icon={<ShoppingBag className="h-4 w-4" />} />
        <Kpi label="Units sold" value={String(kpi.units)} icon={<Package className="h-4 w-4" />} />
        <Kpi label="Avg order value" value={INR(kpi.aov)} icon={<TrendingUp className="h-4 w-4" />} />
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Sales trend</CardTitle></CardHeader>
        <CardContent className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={trend} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="day" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                formatter={(v: number, k: string) => (k === "revenue" ? INR(v) : v)} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="revenue" stroke="oklch(0.55 0.19 285)" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="orders" stroke="oklch(0.62 0.15 190)" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Top products</CardTitle></CardHeader>
          <CardContent className="h-72">
            {topProducts.length === 0 ? <EmptyChart label="No sales yet" /> : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topProducts} layout="vertical" margin={{ top: 5, right: 20, left: 10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={110} />
                  <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} formatter={(v: number) => INR(v)} />
                  <Bar dataKey="revenue" fill="oklch(0.55 0.19 285)" radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Order status mix</CardTitle></CardHeader>
          <CardContent className="h-72">
            {statusMix.length === 0 ? <EmptyChart label="No orders yet" /> : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={statusMix} dataKey="value" nameKey="name" innerRadius={50} outerRadius={90} paddingAngle={2}>
                    {statusMix.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
                  </Pie>
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Catalog by category</CardTitle></CardHeader>
          <CardContent className="h-64">
            {catMix.length === 0 ? <EmptyChart label="Add products to see categories" /> : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={catMix} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                  <Bar dataKey="value" fill="oklch(0.62 0.15 190)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Seller performance</CardTitle></CardHeader>
          <CardContent>
            <div className="flex items-end justify-between gap-6">
              <div>
                <div className="text-xs uppercase text-muted-foreground">Seller performance score</div>
                <div className="text-4xl font-black text-primary">{perf.spf}</div>
                <div className="text-xs text-muted-foreground">out of 100</div>
              </div>
              <div className="grid gap-2 text-sm">
                <PerfRow label="Cancellation rate" value={kpi.cancelRate.toFixed(1) + "%"} good={kpi.cancelRate < 5} />
                <PerfRow label="Listing quality" value={perf.listingScore + "%"} good={perf.listingScore >= 80} />
                <PerfRow label="Delivered orders" value={String(perf.onTime)} good={perf.onTime > 0} />
              </div>
            </div>
            <p className="mt-4 text-xs text-muted-foreground"><Percent className="mr-1 inline h-3 w-3" />Combines fulfilment, cancellation and catalog health.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

const PALETTE = ["oklch(0.55 0.19 285)","oklch(0.62 0.15 190)","oklch(0.78 0.15 85)","oklch(0.7 0.2 25)","oklch(0.55 0.15 145)","oklch(0.5 0.12 260)","oklch(0.75 0.12 55)"];
function Kpi({ label, value, hint, icon }: { label: string; value: string; hint?: string; icon: React.ReactNode }) {
  return (
    <Card className="hover-lift"><CardContent className="flex items-start justify-between py-4">
      <div>
        <div className="text-xs uppercase text-muted-foreground">{label}</div>
        <div className="mt-1 text-2xl font-bold">{value}</div>
        {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
      </div>
      <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary/10 text-primary">{icon}</div>
    </CardContent></Card>
  );
}
function PerfRow({ label, value, good }: { label: string; value: string; good: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-md border px-3 py-2">
      <span className="text-muted-foreground">{label}</span>
      <span className={"font-medium " + (good ? "text-success" : "text-destructive")}>{value}</span>
    </div>
  );
}
function EmptyChart({ label }: { label: string }) {
  return <div className="grid h-full place-items-center text-sm text-muted-foreground">{label}</div>;
}
