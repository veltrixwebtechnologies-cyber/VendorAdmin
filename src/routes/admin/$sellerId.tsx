import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, CheckCircle2, Loader2, MessageCircleQuestion, XCircle, Package, ShoppingCart, Wallet, TrendingUp } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

import { supabase } from "@/integrations/supabase/client";
import { signedDocUrl, useReviewSeller, useSellerById } from "@/lib/db";

export const Route = createFileRoute("/admin/$sellerId")({
  head: () => ({
    meta: [
      { title: "Application review — Admin" },
      { name: "description", content: "Review a seller application." },
      { property: "og:title", content: "Application review — Admin" },
      { property: "og:description", content: "Review a seller application." },
    ],
  }),
  component: AdminSellerDetail,
});

interface DocRow { id: string; doc_type: string; file_name: string | null; file_url: string | null; file_size: number | null }

function AdminSellerDetail() {
  const { sellerId } = Route.useParams();
  const q = useSellerById(sellerId);
  const seller = q.data;
  const review = useReviewSeller();
  const navigate = useNavigate();
  const [dialog, setDialog] = useState<"reject" | "info" | null>(null);
  const [note, setNote] = useState("");

  const [docs, setDocs] = useState<DocRow[]>([]);
  useEffect(() => {
    if (!sellerId) return;
    supabase.from("seller_documents").select("*").eq("seller_id", sellerId).then(({ data }) => setDocs((data as any) ?? []));
  }, [sellerId]);

  if (q.isLoading) return <div className="py-12 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></div>;
  if (!seller) {
    return (
      <Card><CardContent className="py-8 text-center">
        <p className="text-sm text-muted-foreground">Application not found.</p>
        <Link to="/admin" className="mt-3 inline-block"><Button variant="outline">Back to list</Button></Link>
      </CardContent></Card>
    );
  }

  const doAction = async (action: "approve" | "reject" | "more_info", reason?: string) => {
    if (action === "approve") {
      const documentTypes = new Set(docs.map((document) => document.doc_type));
      const missingStorefrontMedia = [
        !documentTypes.has("shopLogo") && "shop logo",
        !documentTypes.has("shopBanner") && "shop banner",
      ].filter(Boolean);
      if (missingStorefrontMedia.length > 0) {
        toast.error(`Cannot approve: missing ${missingStorefrontMedia.join(" and ")}.`);
        return;
      }
    }
    await review.mutateAsync({ id: seller.id, action, note: reason });
    toast.success(action === "approve" ? "Approved" : action === "reject" ? "Rejected" : "Info requested");
    navigate({ to: "/admin" });
  };

  const submitDialog = async () => {
    if (!note.trim()) return toast.error("Please add a message");
    await doAction(dialog === "reject" ? "reject" : "more_info", note.trim());
    setDialog(null);
    setNote("");
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link to="/admin"><Button variant="ghost" size="sm" className="mb-2"><ArrowLeft className="h-4 w-4" /> Back</Button></Link>
          <h1 className="text-2xl font-bold">{seller.business.shopName || "Unnamed shop"}</h1>
          <p className="text-sm text-muted-foreground">{seller.account.fullName} · {seller.account.email}</p>
        </div>
        <Badge className="bg-accent text-accent-foreground">{seller.status}</Badge>
      </div>

      <StorefrontPreview docs={docs} shopName={seller.business.shopName || "Shop"} />

      <VendorActivity userId={seller.userId} />

      <Tabs defaultValue="business">
        <TabsList className="flex-wrap">
          <TabsTrigger value="business">Business</TabsTrigger>
          <TabsTrigger value="address">Address</TabsTrigger>
          <TabsTrigger value="bank">Bank</TabsTrigger>
          <TabsTrigger value="tax">Tax</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="products">Products</TabsTrigger>
          <TabsTrigger value="orders">Orders</TabsTrigger>
          <TabsTrigger value="payouts">Payouts</TabsTrigger>
        </TabsList>
        <TabsContent value="business">
          <InfoCard rows={[
            ["Shop name", seller.business.shopName],
            ["Owner", seller.business.ownerName],
            ["Business type", seller.business.businessType],
            ["Category", seller.business.category],
            ["Description", seller.business.description],
          ]} />
        </TabsContent>
        <TabsContent value="address">
          <InfoCard rows={[
            ["Shop address", seller.address.shopAddress],
            ["City / State", `${seller.address.city}, ${seller.address.state}`],
            ["Pincode", seller.address.pincode],
            ["Landmark", seller.address.landmark || "—"],
            ["Pickup", seller.address.pickupSame ? "Same as shop" :
              `${seller.address.pickupAddress}, ${seller.address.pickupCity}, ${seller.address.pickupState} - ${seller.address.pickupPincode}`],
          ]} />
        </TabsContent>
        <TabsContent value="bank">
          <InfoCard rows={[
            ["Account holder", seller.bank.holderName],
            ["Bank", seller.bank.bankName],
            ["Account #", seller.bank.accountNumber],
            ["IFSC", seller.bank.ifsc],
            ["UPI", seller.bank.upi || "—"],
          ]} />
        </TabsContent>
        <TabsContent value="tax">
          <InfoCard rows={[
            ["PAN", seller.tax.pan],
            ["GST", seller.tax.gst || "—"],
            ["Business Reg #", seller.tax.businessRegNumber || "—"],
          ]} />
        </TabsContent>
        <TabsContent value="documents">
          <DocumentsCard docs={docs} />
        </TabsContent>
        <TabsContent value="products"><VendorProducts userId={seller.userId} /></TabsContent>
        <TabsContent value="orders"><VendorOrders userId={seller.userId} /></TabsContent>
        <TabsContent value="payouts"><VendorPayouts userId={seller.userId} /></TabsContent>
      </Tabs>

      <Card>
        <CardHeader><CardTitle className="text-base">Decision</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button onClick={() => doAction("approve")} disabled={review.isPending}>
            <CheckCircle2 className="h-4 w-4" /> Approve
          </Button>
          <Button variant="outline" onClick={() => setDialog("info")}>
            <MessageCircleQuestion className="h-4 w-4" /> Request more info
          </Button>
          <Button variant="destructive" onClick={() => setDialog("reject")}>
            <XCircle className="h-4 w-4" /> Reject
          </Button>
        </CardContent>
      </Card>

      <Dialog open={dialog !== null} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialog === "reject" ? "Reject application" : "Request more information"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label>{dialog === "reject" ? "Reason for rejection" : "Message to the seller"}</Label>
            <Textarea rows={4} value={note} onChange={(e) => setNote(e.target.value)}
              placeholder={dialog === "reject" ? "e.g. Documents are unclear. Please re-upload a legible PAN." : "e.g. Please upload a recent GST certificate."} />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialog(null)}>Cancel</Button>
            <Button variant={dialog === "reject" ? "destructive" : "default"} onClick={submitDialog} disabled={review.isPending}>
              Send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StorefrontPreview({ docs, shopName }: { docs: DocRow[]; shopName: string }) {
  const [images, setImages] = useState<{ logo?: string; banner?: string }>({});

  useEffect(() => {
    let active = true;
    const load = async () => {
      const logo = docs.find((document) => document.doc_type === "shopLogo" && document.file_url);
      const banner = docs.find((document) => document.doc_type === "shopBanner" && document.file_url);
      const [logoUrl, bannerUrl] = await Promise.all([
        logo?.file_url ? signedDocUrl(logo.file_url) : null,
        banner?.file_url ? signedDocUrl(banner.file_url) : null,
      ]);
      if (active) setImages({ logo: logoUrl ?? undefined, banner: bannerUrl ?? undefined });
    };
    void load();
    return () => {
      active = false;
    };
  }, [docs]);

  return (
    <Card className="overflow-hidden">
      <div className="relative h-40 bg-muted sm:h-52">
        {images.banner ? (
          <img src={images.banner} alt={`${shopName} storefront`} className="h-full w-full object-cover" />
        ) : (
          <div className="grid h-full place-items-center text-sm text-muted-foreground">Shop banner missing</div>
        )}
        <div className="absolute bottom-3 left-4 flex items-end gap-3">
          <div className="grid h-16 w-16 place-items-center overflow-hidden rounded-lg border-2 border-background bg-card shadow">
            {images.logo ? (
              <img src={images.logo} alt={`${shopName} logo`} className="h-full w-full object-cover" />
            ) : (
              <span className="text-xl font-bold text-primary">{shopName.slice(0, 1).toUpperCase()}</span>
            )}
          </div>
          <span className="rounded-md bg-background/90 px-2 py-1 text-sm font-semibold shadow-sm backdrop-blur">
            Customer storefront preview
          </span>
        </div>
      </div>
    </Card>
  );
}

function InfoCard({ rows }: { rows: Array<[string, string]> }) {
  return (
    <Card><CardContent className="py-6">
      <dl className="grid gap-2 text-sm sm:grid-cols-[180px_1fr]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="font-medium break-words">{v || "—"}</dd>
          </div>
        ))}
      </dl>
    </CardContent></Card>
  );
}

function DocumentsCard({ docs }: { docs: DocRow[] }) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    (async () => {
      const out: Record<string, string> = {};
      for (const d of docs) {
        if (d.file_url) {
          const u = await signedDocUrl(d.file_url);
          if (u) out[d.id] = u;
        }
      }
      setUrls(out);
    })();
  }, [docs]);

  if (docs.length === 0) return <div className="rounded-md border p-6 text-center text-sm text-muted-foreground">No documents uploaded.</div>;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {docs.map((d) => (
        <Card key={d.id}><CardContent className="flex items-center gap-3 py-4">
          <div className="grid h-16 w-16 place-items-center rounded-md border border-border bg-muted text-xs text-muted-foreground">
            {(d.file_name || "").match(/\.(png|jpe?g|webp|gif)$/i) && urls[d.id]
              ? <img src={urls[d.id]} className="h-full w-full rounded object-cover" alt="" />
              : "FILE"}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium capitalize">{d.doc_type.replace(/([A-Z])/g, " $1")}</div>
            <div className="truncate text-xs text-muted-foreground">{d.file_name}</div>
            {urls[d.id] && <a href={urls[d.id]} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">Open</a>}
          </div>
        </CardContent></Card>
      ))}
    </div>
  );
}

function fmt(n: number) { return "₹" + Math.round(n).toLocaleString("en-IN"); }

function VendorActivity({ userId }: { userId: string }) {
  const q = useQuery({
    queryKey: ["vendor-activity", userId],
    queryFn: async () => {
      const [prod, ord, set] = await Promise.all([
        supabase.from("products").select("id, status, stock", { count: "exact" }).eq("user_id", userId),
        supabase.from("orders").select("id, total, status, created_at").eq("user_id", userId),
        supabase.from("settlements").select("net_payout, status").eq("user_id", userId),
      ]);
      const products = prod.data ?? [];
      const orders = ord.data ?? [];
      const settlements = set.data ?? [];
      const revenue = orders.reduce((s, o: any) => s + Number(o.total || 0), 0);
      const pending = settlements.filter((s: any) => s.status !== "paid").reduce((a, s: any) => a + Number(s.net_payout || 0), 0);
      const paid = settlements.filter((s: any) => s.status === "paid").reduce((a, s: any) => a + Number(s.net_payout || 0), 0);
      const low = products.filter((p: any) => Number(p.stock || 0) <= 5).length;
      return { products: products.length, low, orders: orders.length, revenue, pending, paid };
    },
  });
  const d = q.data;
  const tiles = [
    { icon: Package, label: "Products", value: d ? String(d.products) : "—", sub: d ? `${d.low} low stock` : "" },
    { icon: ShoppingCart, label: "Orders", value: d ? String(d.orders) : "—", sub: "" },
    { icon: TrendingUp, label: "Revenue", value: d ? fmt(d.revenue) : "—", sub: "" },
    { icon: Wallet, label: "Payouts", value: d ? fmt(d.paid) : "—", sub: d ? `${fmt(d.pending)} pending` : "" },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {tiles.map((t) => (
        <Card key={t.label}><CardContent className="p-4">
          <div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">{t.label}</span><t.icon className="h-4 w-4 text-primary" /></div>
          <div className="mt-2 text-xl font-bold">{t.value}</div>
          {t.sub && <div className="mt-1 text-[11px] text-muted-foreground">{t.sub}</div>}
        </CardContent></Card>
      ))}
    </div>
  );
}

function VendorProducts({ userId }: { userId: string }) {
  const q = useQuery({
    queryKey: ["vendor-products", userId],
    queryFn: async () => {
      const { data } = await supabase.from("products").select("id, name, sku, selling_price, stock, status, created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(50);
      return data ?? [];
    },
  });
  if (q.isLoading) return <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>;
  const rows = q.data ?? [];
  if (rows.length === 0) return <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">No products yet.</CardContent></Card>;
  return (
    <Card><CardContent className="p-0"><div className="divide-y divide-border">
      {rows.map((p: any) => (
        <div key={p.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3">
          <div className="min-w-0">
            <div className="truncate font-medium">{p.name}</div>
            <div className="truncate text-xs text-muted-foreground">SKU {p.sku || "—"} · Stock {p.stock ?? 0}</div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="capitalize">{p.status}</Badge>
            <span className="text-sm font-semibold">{fmt(Number(p.selling_price || 0))}</span>
          </div>
        </div>
      ))}
    </div></CardContent></Card>
  );
}

function VendorOrders({ userId }: { userId: string }) {
  const q = useQuery({
    queryKey: ["vendor-orders", userId],
    queryFn: async () => {
      const { data } = await supabase.from("orders").select("id, buyer_name, total, status, created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(50);
      return data ?? [];
    },
  });
  if (q.isLoading) return <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>;
  const rows = q.data ?? [];
  if (rows.length === 0) return <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">No orders yet.</CardContent></Card>;
  return (
    <Card><CardContent className="p-0"><div className="divide-y divide-border">
      {rows.map((o: any) => (
        <div key={o.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3">
          <div className="min-w-0">
            <div className="truncate font-medium">{o.buyer_name || "Customer"}</div>
            <div className="truncate text-xs text-muted-foreground">#{String(o.id).slice(0, 8)} · {new Date(o.created_at).toLocaleString()}</div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="capitalize">{o.status}</Badge>
            <span className="text-sm font-semibold">{fmt(Number(o.total || 0))}</span>
          </div>
        </div>
      ))}
    </div></CardContent></Card>
  );
}

function VendorPayouts({ userId }: { userId: string }) {
  const q = useQuery({
    queryKey: ["vendor-payouts", userId],
    queryFn: async () => {
      const { data } = await supabase.from("settlements").select("id, cycle_start, cycle_end, gross_sales, commission, net_payout, status, created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(50);
      return data ?? [];
    },
  });
  if (q.isLoading) return <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>;
  const rows = q.data ?? [];
  if (rows.length === 0) return <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">No payouts yet.</CardContent></Card>;
  return (
    <Card><CardContent className="p-0"><div className="divide-y divide-border">
      {rows.map((s: any) => (
        <div key={s.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3">
          <div className="min-w-0">
            <div className="truncate font-medium">{fmt(Number(s.net_payout || 0))} net</div>
            <div className="truncate text-xs text-muted-foreground">Gross {fmt(Number(s.gross_sales || 0))} · Fee {fmt(Number(s.commission || 0))}</div>
          </div>
          <Badge variant="outline" className="capitalize">{s.status}</Badge>
        </div>
      ))}
    </div></CardContent></Card>
  );
}
