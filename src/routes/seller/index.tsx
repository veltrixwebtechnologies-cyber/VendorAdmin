import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { AlertTriangle, Box, CheckCircle2, Circle, Clock, Package, RefreshCw, ShoppingBag, Store } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";

import { getDataErrorMessage, useMySeller, useMyOrders, type Seller, type SellerStatus } from "@/lib/db";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listProducts, type ProductDto } from "@/lib/products.functions";
import { useAuth } from "@/lib/auth";
import { AnimatedNumber } from "@/components/motion/presets";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/seller/")({
  head: () => ({
    meta: [
      { title: "Dashboard — Seller Hub" },
      { name: "description", content: "Your seller dashboard overview." },
      { property: "og:title", content: "Dashboard — Seller Hub" },
      { property: "og:description", content: "Your seller dashboard overview." },
    ],
  }),
  component: SellerDashboard,
});

function SellerDashboard() {
  const sellerQ = useMySeller();
  const seller = sellerQ.data;

  if (sellerQ.isError) {
    return (
      <Card className="mx-auto max-w-5xl border-destructive/40">
        <CardContent className="space-y-3 py-8 text-center">
          <AlertTriangle className="mx-auto h-6 w-6 text-destructive" />
          <p className="font-medium">Seller dashboard could not load.</p>
          <p className="text-sm text-muted-foreground">
            {getDataErrorMessage(sellerQ.error)}
          </p>
          <Button variant="outline" onClick={() => void sellerQ.refetch()}>
            <RefreshCw className="h-4 w-4" /> Try again
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (sellerQ.isLoading || !seller) {
    return (
      <div className="mx-auto grid max-w-5xl gap-4">
        <Skeleton className="h-8 w-56" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-24" />)}
        </div>
        <Skeleton className="h-36" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 sm:flex sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-bold sm:text-2xl">{seller.business.shopName || "Your store"}</h1>
          <p className="truncate text-sm text-muted-foreground">Welcome back, {seller.account.fullName || seller.account.email || "seller"}.</p>
        </div>
        <StatusBadge status={seller.status} />
      </div>


      {seller.status === "draft" && (
        <Card>
          <CardHeader><CardTitle>Complete your verification</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Complete the 7-step registration and submit your application. Products, orders and seller tools unlock after admin approval.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => window.location.assign("/register")}>Continue registration</Button>
              <Link to="/seller/store"><Button variant="outline">Store setup</Button></Link>
            </div>
          </CardContent>
        </Card>
      )}
      {seller.status === "pending" && <PendingBanner />}
      {seller.status === "rejected" && <RejectedBanner reason={seller.reviewNote} />}
      {seller.status === "more_info" && <MoreInfoBanner message={seller.reviewNote} />}

      {seller.status === "approved" && <ApprovedStats />}
      {seller.status === "approved" && <ApprovedChecklist seller={seller} />}
    </div>
  );
}

function ApprovedStats() {
  const orders = useMyOrders().data ?? [];
  const { user } = useAuth();
  const list = useServerFn(listProducts);
  const productsQ = useQuery<ProductDto[]>({
    queryKey: ["products", user?.id],
    queryFn: () => list() as Promise<ProductDto[]>,
    enabled: !!user,
  });
  const products = productsQ.data ?? [];

  const stats = useMemo(() => {
    const active = products.filter((p) => p.status === "active").length;
    const lowStock = products.filter((p) => p.stock > 0 && p.stock <= p.lowStockAt).length;
    const outOfStock = products.filter((p) => p.stock === 0).length;
    const newOrders = orders.filter((o) => o.status === "new").length;
    const inProgress = orders.filter((o) => ["accepted","packed","ready_for_pickup","out_for_delivery","shipped"].includes(o.status)).length;
    const revenue = orders.filter((o) => o.status === "delivered").reduce((s, o) => s + o.total, 0);
    return { active, lowStock, outOfStock, newOrders, inProgress, revenue };
  }, [products, orders]);

  const tiles = [
    { to: "/seller/orders", label: "New orders", value: stats.newOrders, hint: `${stats.inProgress} in progress`, icon: ShoppingBag, tone: stats.newOrders > 0 ? "primary" : "muted" },
    { to: "/seller/products", label: "Active products", value: stats.active, hint: `${products.length} total`, icon: Package, tone: "muted" },
    { to: "/seller/inventory", label: "Low / out of stock", value: stats.lowStock + stats.outOfStock, hint: `${stats.outOfStock} out of stock`, icon: Box, tone: stats.outOfStock > 0 ? "destructive" : "muted" },
    { to: "/seller/settlements", label: "Delivered revenue", value: stats.revenue, currency: true, hint: "Payouts calculated weekly", icon: CheckCircle2, tone: "muted" },
  ] as const;

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 stagger">
        {tiles.map((t) => {
          const Icon = t.icon;
          return (
            <Link key={t.label} to={t.to} className="block">
              <Card className="h-full hover-lift hover:border-primary/50">
                <CardContent className="flex items-start justify-between py-4">
                  <div>
                    <div className="text-xs uppercase text-muted-foreground">{t.label}</div>
                    <div className={"mt-1 text-2xl font-bold " + (t.tone === "destructive" ? "text-destructive" : t.tone === "primary" ? "text-primary" : "")}>
                      <AnimatedNumber
                        value={t.value}
                        format={"currency" in t && t.currency
                          ? (value) => `₹${Math.round(value).toLocaleString("en-IN")}`
                          : undefined}
                      />
                    </div>
                    <div className="text-xs text-muted-foreground">{t.hint}</div>
                  </div>
                  <div className={"grid h-9 w-9 place-items-center rounded-lg " + (t.tone === "destructive" ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary")}>
                    <Icon className="h-4 w-4" />
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>

    </div>
  );
}

function StatusBadge({ status }: { status: SellerStatus }) {
  const map: Record<SellerStatus, { label: string; className: string }> = {
    draft: { label: "Not verified", className: "bg-muted text-muted-foreground" },
    pending: { label: "Pending verification", className: "bg-accent text-accent-foreground" },
    approved: { label: "Verified", className: "bg-success text-success-foreground" },
    rejected: { label: "Rejected", className: "bg-destructive text-destructive-foreground" },
    more_info: { label: "Info requested", className: "bg-accent text-accent-foreground" },
  };
  const m = map[status];
  return <Badge className={m.className}>{m.label}</Badge>;
}

function PendingBanner() {
  return (
    <Card><CardContent className="flex items-start gap-3 py-4">
      <Clock className="mt-0.5 h-5 w-5 text-primary" />
      <div>
        <div className="font-medium">Your application is under review</div>
        <p className="text-sm text-muted-foreground">An admin is verifying your business details and documents.</p>
      </div>
    </CardContent></Card>
  );
}
function RejectedBanner({ reason }: { reason?: string }) {
  return (
    <Card className="border-destructive"><CardContent className="flex items-start gap-3 py-4">
      <AlertTriangle className="mt-0.5 h-5 w-5 text-destructive" />
      <div className="flex-1">
        <div className="font-medium text-destructive">Application rejected</div>
        <p className="text-sm text-muted-foreground">{reason || "Your application was rejected. Please review and resubmit."}</p>
        <div className="mt-3"><Link to="/register" search={{ step: 6 }}><Button variant="outline"><RefreshCw className="h-4 w-4" /> Fix & resubmit</Button></Link></div>
      </div>
    </CardContent></Card>
  );
}
function MoreInfoBanner({ message }: { message?: string }) {
  return (
    <Card className="border-accent"><CardContent className="flex items-start gap-3 py-4">
      <AlertTriangle className="mt-0.5 h-5 w-5 text-accent-foreground" />
      <div className="flex-1">
        <div className="font-medium">Additional information requested</div>
        <p className="text-sm text-muted-foreground">{message || "Admin has requested more information about your application."}</p>
        <div className="mt-3"><Link to="/register" search={{ step: 6 }}><Button variant="outline"><RefreshCw className="h-4 w-4" /> Update & resubmit</Button></Link></div>
      </div>
    </CardContent></Card>
  );
}

function ApprovedChecklist({ seller }: { seller: Seller }) {
  const { user } = useAuth();
  const list = useServerFn(listProducts);
  const productsQ = useQuery<ProductDto[]>({
    queryKey: ["products", user?.id],
    queryFn: () => list() as Promise<ProductDto[]>,
    enabled: !!user,
  });
  const products = productsQ.data ?? [];
  const hasProduct = products.length > 0;
  const hasActiveProduct = products.some((product) => product.status === "active");
  const items = [
    { label: "Account created", done: true },
    { label: "Documents verified", done: true },
    { label: "Bank details added", done: !!seller.bank.accountNumber },
    { label: "Complete store profile", done: !!seller.business.description },
    { label: "Add first product", done: hasProduct },
    { label: "Start selling", done: hasActiveProduct },
  ];
  const done = items.filter((i) => i.done).length;
  const pct = (done / items.length) * 100;

  return (
    <>
      <Card className="border-success">
        <CardContent className="flex items-center gap-3 py-4">
          <CheckCircle2 className="h-6 w-6 text-success" />
          <div>
            <div className="font-medium">Congratulations! Your seller account has been approved.</div>
            <p className="text-sm text-muted-foreground">You can now set up your store and start listing products.</p>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Get your store ready</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div>
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Onboarding progress</span>
              <span className="font-medium">{done} / {items.length}</span>
            </div>
            <Progress value={pct} className="h-2" />
          </div>
          <ul className="grid gap-2">
            {items.map((i) => (
              <li key={i.label} className="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2">
                {i.done ? <CheckCircle2 className="h-4 w-4 text-success" /> : <Circle className="h-4 w-4 text-muted-foreground" />}
                <span className={i.done ? "text-foreground" : "text-muted-foreground"}>{i.label}</span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2 pt-2">
            <Link to="/seller/store"><Button variant="outline"><Store className="h-4 w-4" /> Complete store profile</Button></Link>
            <Link to="/seller/products"><Button>{hasProduct ? "Manage products" : "Add first product"}</Button></Link>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
