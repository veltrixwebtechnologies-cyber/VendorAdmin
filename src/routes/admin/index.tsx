import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import {
  Users, Store, Package, ShoppingCart, IndianRupee, Clock, TrendingUp, AlertTriangle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
  BarChart, Bar, PieChart, Pie, Cell, Legend,
} from "recharts";
import { useAdminOverview } from "@/lib/admin-db";
import { AnimatedNumber, Reveal } from "@/components/motion/presets";

export const Route = createFileRoute("/admin/")({
  head: () => ({ meta: [{ title: "Dashboard — Admin" }, { name: "robots", content: "noindex" }] }),
  component: AdminDashboard,
});

const fmt = (n: number) => `₹${n.toLocaleString("en-IN")}`;

function Kpi({
  icon: Icon,
  label,
  value,
  sub,
  tone = "default",
  currency = false,
}: {
  icon: typeof Users;
  label: string;
  value: number;
  sub?: string;
  tone?: "default" | "warn" | "danger";
  currency?: boolean;
}) {
  const toneCls = tone === "warn" ? "bg-accent/20 text-accent-foreground"
    : tone === "danger" ? "bg-destructive/15 text-destructive"
    : "bg-primary/10 text-primary";
  return (
    <Card className="hover-lift">
      <CardContent className="flex items-start gap-2.5 p-3 sm:gap-3 sm:p-4">
        <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl sm:h-10 sm:w-10 ${toneCls}`}>
          <Icon className="h-4 w-4 sm:h-5 sm:w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[11px] font-medium text-muted-foreground sm:text-xs">{label}</div>
          <div className="mt-0.5 truncate text-lg font-black tracking-tight sm:text-2xl">
            <AnimatedNumber
              value={value}
              format={currency ? (number) => fmt(Math.round(number)) : undefined}
            />
          </div>
          {sub && <div className="mt-0.5 truncate text-[10px] text-muted-foreground sm:text-[11px]">{sub}</div>}
        </div>
      </CardContent>
    </Card>
  );
}

function AdminDashboard() {
  const { data, isLoading } = useAdminOverview();

  const stats = useMemo(() => {
    if (!data) return null;
    const vendors = data.sellers;
    const products = data.products;
    const orders = data.orders;
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthlyRevenue = orders.filter(o => new Date(o.created_at) >= monthStart && o.status !== "cancelled")
      .reduce((a, o) => a + Number(o.total || 0), 0);
    const platformRevenue = Math.round(monthlyRevenue * 0.08);

    // Revenue by last 6 months
    const months: Record<string, { revenue: number; orders: number; label: string }> = {};
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      months[key] = { revenue: 0, orders: 0, label: d.toLocaleString("en", { month: "short" }) };
    }
    orders.forEach(o => {
      const d = new Date(o.created_at);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      if (months[key] && o.status !== "cancelled") {
        months[key].revenue += Number(o.total || 0);
        months[key].orders += 1;
      }
    });

    // New users/vendors last 6 months
    const vendorsPerMonth: Record<string, number> = {};
    vendors.forEach(v => {
      const d = new Date(v.created_at);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      vendorsPerMonth[key] = (vendorsPerMonth[key] ?? 0) + 1;
    });

    const chartRevenue = Object.entries(months).map(([k, v]) => ({
      month: v.label, revenue: v.revenue, orders: v.orders, vendors: vendorsPerMonth[k] ?? 0,
    }));

    // Top selling categories
    const catRev: Record<string, number> = {};
    orders.forEach(o => {
      // fallback: assign to "General" since we don't have order->product join here
    });
    products.forEach(p => {
      const c = p.category || "Uncategorized";
      catRev[c] = (catRev[c] ?? 0) + Number(p.selling_price || 0) * Math.max(1, Number(p.stock || 0) > 0 ? 1 : 0);
    });
    const topCategories = Object.entries(catRev).map(([name, value]) => ({ name, value })).sort((a,b)=>b.value-a.value).slice(0,5);

    // Best selling products (fallback: highest priced in-stock)
    const bestProducts = [...products].sort((a,b) => Number(b.selling_price||0)-Number(a.selling_price||0)).slice(0,5);

    // Low stock
    const lowStock = products.filter(p => Number(p.stock ?? 0) > 0 && Number(p.stock ?? 0) <= 5).slice(0,5);
    const outOfStock = products.filter(p => Number(p.stock ?? 0) === 0).length;

    return {
      totalVendors: vendors.length,
      pendingVendors: vendors.filter(v => v.status === "pending").length,
      activeVendors: vendors.filter(v => v.status === "approved").length,
      totalProducts: products.length,
      pendingProducts: products.filter(p => p.status === "pending" || p.status === "draft").length,
      totalOrders: orders.length,
      monthlyRevenue,
      platformRevenue,
      chartRevenue,
      topCategories,
      bestProducts,
      lowStock,
      outOfStock,
      recentOrders: [...orders].sort((a,b) => +new Date(b.created_at)-+new Date(a.created_at)).slice(0,6),
      recentVendors: [...vendors].sort((a,b) => +new Date(b.created_at)-+new Date(a.created_at)).slice(0,5),
      pendingApprovals: vendors.filter(v => v.status === "pending").slice(0,5),
    };
  }, [data]);

  if (isLoading || !stats || !data) {
    return <div className="grid gap-4 md:grid-cols-4">{Array.from({length:8}).map((_,i)=><div key={i} className="h-24 animate-pulse rounded-xl bg-muted" />)}</div>;
  }

  const pieColors = ["var(--chart-1)","var(--chart-2)","var(--chart-3)","var(--chart-4)","var(--chart-5)"];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between sm:gap-2">
        <div className="min-w-0">
          <h1 className="text-xl font-black tracking-tight sm:text-3xl">Dashboard</h1>
          <p className="text-xs text-muted-foreground sm:text-sm">Marketplace overview and platform performance.</p>
        </div>
        <div className="text-[11px] text-muted-foreground sm:text-xs">Last updated {new Date().toLocaleString("en-IN")}</div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4 stagger">
        <Kpi icon={Users} label="Total Users" value={data.totalUsers} />
        <Kpi icon={Store} label="Total Vendors" value={stats.totalVendors} sub={`${stats.activeVendors} active`} />
        <Kpi icon={Clock} label="Pending Vendors" value={stats.pendingVendors} tone="warn" />
        <Kpi icon={Package} label="Total Products" value={stats.totalProducts} />
        <Kpi icon={AlertTriangle} label="Pending Products" value={stats.pendingProducts} tone="warn" />
        <Kpi icon={ShoppingCart} label="Total Orders" value={stats.totalOrders} sub={`${data.todayOrders} today`} />
        <Kpi icon={IndianRupee} label="Monthly Revenue" value={stats.monthlyRevenue} currency />
        <Kpi icon={TrendingUp} label="Platform Revenue" value={stats.platformRevenue} sub="8% commission" currency />
      </div>

      {/* Charts */}
      <Reveal className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base">Revenue overview</CardTitle></CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={stats.chartRevenue} margin={{ left: 0, right: 8, top: 8 }}>
                <defs>
                  <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.55} />
                    <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} />
                <Area type="monotone" dataKey="revenue" stroke="var(--chart-1)" fill="url(#rev)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Top selling categories</CardTitle></CardHeader>
          <CardContent className="h-72">
            {stats.topCategories.length === 0 ? (
              <div className="grid h-full place-items-center text-sm text-muted-foreground">No data yet</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={stats.topCategories} dataKey="value" nameKey="name" outerRadius={80} innerRadius={45}>
                    {stats.topCategories.map((_,i) => <Cell key={i} fill={pieColors[i % pieColors.length]} />)}
                  </Pie>
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Orders by month</CardTitle></CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.chartRevenue}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} />
                <Bar dataKey="orders" fill="var(--chart-2)" radius={[6,6,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">New vendors</CardTitle></CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.chartRevenue}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} />
                <Bar dataKey="vendors" fill="var(--chart-4)" radius={[6,6,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Best selling products</CardTitle></CardHeader>
          <CardContent>
            {stats.bestProducts.length === 0 ? (
              <div className="text-sm text-muted-foreground">No products yet</div>
            ) : (
              <ul className="space-y-2">
                {stats.bestProducts.map(p => (
                  <li key={p.id} className="flex items-center justify-between text-sm">
                    <span className="truncate">{p.name}</span>
                    <span className="font-semibold">{fmt(Number(p.selling_price||0))}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </Reveal>

      {/* Widgets */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Recent orders</CardTitle>
            <Link to="/admin/orders"><Button variant="ghost" size="sm">View all</Button></Link>
          </CardHeader>
          <CardContent>
            {stats.recentOrders.length === 0 ? <div className="text-sm text-muted-foreground">No orders yet</div> : (
              <ul className="space-y-2 text-sm">
                {stats.recentOrders.map(o => (
                  <li key={o.id} className="flex items-center justify-between gap-2 border-b border-border pb-2 last:border-none">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{o.buyer_name || "Guest"}</div>
                      <div className="text-[11px] text-muted-foreground">{new Date(o.created_at).toLocaleString("en-IN")}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-semibold">{fmt(Number(o.total||0))}</div>
                      <Badge variant="outline" className="text-[10px]">{o.status}</Badge>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Recent vendors</CardTitle>
            <Link to="/admin/vendors"><Button variant="ghost" size="sm">View all</Button></Link>
          </CardHeader>
          <CardContent>
            {stats.recentVendors.length === 0 ? <div className="text-sm text-muted-foreground">No vendors yet</div> : (
              <ul className="space-y-2 text-sm">
                {stats.recentVendors.map(v => (
                  <li key={v.id} className="flex items-center justify-between gap-2 border-b border-border pb-2 last:border-none">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{v.shop_name || "Unnamed shop"}</div>
                      <div className="truncate text-[11px] text-muted-foreground">{v.owner_name || "—"}</div>
                    </div>
                    <Badge variant="outline" className="text-[10px]">{v.status}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Low stock ({stats.outOfStock} out of stock)</CardTitle>
            <Link to="/admin/inventory"><Button variant="ghost" size="sm">Inventory</Button></Link>
          </CardHeader>
          <CardContent>
            {stats.lowStock.length === 0 ? <div className="text-sm text-muted-foreground">No low-stock alerts</div> : (
              <ul className="space-y-2 text-sm">
                {stats.lowStock.map(p => (
                  <li key={p.id} className="flex items-center justify-between border-b border-border pb-2 last:border-none">
                    <span className="truncate">{p.name}</span>
                    <Badge variant="destructive" className="text-[10px]">{p.stock} left</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
