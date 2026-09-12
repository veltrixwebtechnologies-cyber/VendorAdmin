import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft,
  CheckCircle2,
  Loader2,
  MessageCircleQuestion,
  XCircle,
  Package,
  ShoppingCart,
  Wallet,
  TrendingUp,
  Trash2,
  Maximize2,
  SlidersHorizontal,
  ZoomIn,
  RotateCcw,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

import { supabase } from "@/integrations/supabase/client";
import { signedDocUrl, useDeleteSeller, useReviewSeller, useSellerById } from "@/lib/db";

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

interface DocRow {
  id: string;
  doc_type: string;
  file_name: string | null;
  file_url: string | null;
  file_size: number | null;
}

function AdminSellerDetail() {
  const { sellerId } = Route.useParams();
  const q = useSellerById(sellerId);
  const seller = q.data;
  const review = useReviewSeller();
  const deleteSeller = useDeleteSeller();
  const navigate = useNavigate();
  const [dialog, setDialog] = useState<"reject" | "info" | "delete" | null>(null);
  const [note, setNote] = useState("");

  const [docs, setDocs] = useState<DocRow[]>([]);
  useEffect(() => {
    if (!sellerId) return;
    supabase
      .from("seller_documents")
      .select("*")
      .eq("seller_id", sellerId)
      .then(({ data }) => setDocs((data as any) ?? []));
  }, [sellerId]);

  if (q.isLoading)
    return (
      <div className="py-12 text-center">
        <Loader2 className="mx-auto h-5 w-5 animate-spin" />
      </div>
    );
  if (!seller) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="text-sm text-muted-foreground">Application not found.</p>
          <Link to="/admin" className="mt-3 inline-block">
            <Button variant="outline">Back to list</Button>
          </Link>
        </CardContent>
      </Card>
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
    toast.success(
      action === "approve" ? "Approved" : action === "reject" ? "Rejected" : "Info requested",
    );
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
          <Link to="/admin">
            <Button variant="ghost" size="sm" className="mb-2">
              <ArrowLeft className="h-4 w-4" /> Back
            </Button>
          </Link>
          <h1 className="text-2xl font-bold">{seller.business.shopName || "Unnamed shop"}</h1>
          <p className="text-sm text-muted-foreground">
            {seller.account.fullName} · {seller.account.email}
          </p>
        </div>
        <Badge className="bg-accent text-accent-foreground">{seller.status}</Badge>
      </div>

      <StorefrontPreview docs={docs} shopName={seller.business.shopName || "Shop"} />

      {seller.status === "approved" ? (
        <VendorActivity userId={seller.userId} />
      ) : (
        <Card className="border-amber-200 bg-amber-50/50 dark:border-amber-950 dark:bg-amber-950/20">
          <CardContent className="py-3 text-sm text-amber-800 dark:text-amber-300">
            This seller application is currently{" "}
            <strong className="capitalize">{seller.status}</strong>. Product listing, orders, and
            payouts are disabled until approved.
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="business">
        <TabsList className="flex-wrap">
          <TabsTrigger value="business">Business</TabsTrigger>
          <TabsTrigger value="address">Address</TabsTrigger>
          <TabsTrigger value="bank">Bank</TabsTrigger>
          <TabsTrigger value="tax">Tax</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          {seller.status === "approved" && (
            <>
              <TabsTrigger value="products">Products</TabsTrigger>
              <TabsTrigger value="orders">Orders</TabsTrigger>
              <TabsTrigger value="payouts">Payouts</TabsTrigger>
            </>
          )}
        </TabsList>
        <TabsContent value="business">
          <InfoCard
            rows={[
              ["Shop name", seller.business.shopName],
              ["Owner", seller.business.ownerName],
              ["Business type", seller.business.businessType],
              ["Category", seller.business.category],
              ["Description", seller.business.description],
            ]}
          />
        </TabsContent>
        <TabsContent value="address">
          <InfoCard
            rows={[
              ["Shop address", seller.address.shopAddress],
              ["City / State", `${seller.address.city}, ${seller.address.state}`],
              ["Pincode", seller.address.pincode],
              ["Landmark", seller.address.landmark || "—"],
              [
                "Pickup",
                seller.address.pickupSame
                  ? "Same as shop"
                  : `${seller.address.pickupAddress}, ${seller.address.pickupCity}, ${seller.address.pickupState} - ${seller.address.pickupPincode}`,
              ],
              [
                "Pickup coordinates",
                seller.address.pickupCoordinates
                  ? `${seller.address.pickupCoordinates.lat.toFixed(6)}, ${seller.address.pickupCoordinates.lng.toFixed(6)}`
                  : "Not confirmed",
              ],
              [
                "Location status",
                seller.address.locationConfirmationRequired ? "Needs confirmation" : "Confirmed",
              ],
            ]}
          />
        </TabsContent>
        <TabsContent value="bank">
          <InfoCard
            rows={[
              ["Account holder", seller.bank.holderName],
              ["Bank", seller.bank.bankName],
              ["Account #", seller.bank.accountNumber],
              ["IFSC", seller.bank.ifsc],
              ["UPI", seller.bank.upi || "—"],
            ]}
          />
        </TabsContent>
        <TabsContent value="tax">
          <InfoCard
            rows={[
              ["PAN", seller.tax.pan],
              ["GST", seller.tax.gst || "—"],
              ["Business Reg #", seller.tax.businessRegNumber || "—"],
            ]}
          />
        </TabsContent>
        <TabsContent value="documents">
          <DocumentsCard docs={docs} />
        </TabsContent>
        {seller.status === "approved" && (
          <>
            <TabsContent value="products">
              <VendorProducts userId={seller.userId} />
            </TabsContent>
            <TabsContent value="orders">
              <VendorOrders userId={seller.userId} />
            </TabsContent>
            <TabsContent value="payouts">
              <VendorPayouts userId={seller.userId} />
            </TabsContent>
          </>
        )}
      </Tabs>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-base">Decision & Management</CardTitle>
          <span className="text-xs text-muted-foreground">Admin actions</span>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => doAction("approve")} disabled={review.isPending}>
              <CheckCircle2 className="h-4 w-4" /> Approve
            </Button>
            <Button variant="outline" onClick={() => setDialog("info")}>
              <MessageCircleQuestion className="h-4 w-4" /> Request more info
            </Button>
            <Button
              variant="outline"
              className="border-destructive/40 text-destructive hover:bg-destructive/10"
              onClick={() => setDialog("reject")}
            >
              <XCircle className="h-4 w-4" /> Reject
            </Button>
          </div>
          <Button
            variant="destructive"
            onClick={() => setDialog("delete")}
            disabled={deleteSeller.isPending}
            className="gap-1.5 ml-auto"
          >
            <Trash2 className="h-4 w-4" /> Delete Shop
          </Button>
        </CardContent>
      </Card>

      <Dialog open={dialog !== null} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          {dialog === "delete" ? (
            <>
              <DialogHeader>
                <DialogTitle className="text-destructive flex items-center gap-2">
                  <Trash2 className="h-5 w-5" /> Delete Shop
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-3 py-2">
                <p className="text-sm text-foreground">
                  Are you sure you want to delete{" "}
                  <strong className="font-bold underline">
                    {seller.business.shopName || "Unnamed shop"}
                  </strong>
                  ?
                </p>
                <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
                  <strong>Warning:</strong> This will permanently delete the shop profile, uploaded
                  documents, catalog listings, and seller records. This action cannot be undone.
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDialog(null)}>
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={async () => {
                    try {
                      await deleteSeller.mutateAsync(seller.id);
                      toast.success(
                        `Shop "${seller.business.shopName || "Shop"}" has been deleted.`,
                      );
                      setDialog(null);
                      navigate({ to: "/admin/vendors" });
                    } catch (err: any) {
                      toast.error(err?.message || "Failed to delete shop.");
                    }
                  }}
                  disabled={deleteSeller.isPending}
                  className="gap-1.5"
                >
                  {deleteSeller.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                  Confirm Deletion
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>
                  {dialog === "reject" ? "Reject application" : "Request more information"}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-2">
                <Label>
                  {dialog === "reject" ? "Reason for rejection" : "Message to the seller"}
                </Label>
                <Textarea
                  rows={4}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={
                    dialog === "reject"
                      ? "e.g. Documents are unclear. Please re-upload a legible PAN."
                      : "e.g. Please upload a recent GST certificate."
                  }
                />
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setDialog(null)}>
                  Cancel
                </Button>
                <Button
                  variant={dialog === "reject" ? "destructive" : "default"}
                  onClick={submitDialog}
                  disabled={review.isPending}
                >
                  Send
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StorefrontPreview({ docs, shopName }: { docs: DocRow[]; shopName: string }) {
  const [images, setImages] = useState<{ logo?: string; banner?: string }>({});
  const [fitMode, setFitMode] = useState<"cover" | "contain" | "fill">("cover");
  const [heightClass, setHeightClass] = useState<string>("h-40 sm:h-52");
  const [positionMode, setPositionMode] = useState<"center" | "top" | "bottom">("center");
  const [lightbox, setLightbox] = useState<{ url: string; title: string } | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const logo = docs.find((document) => document.doc_type === "shopLogo" && document.file_url);
      const banner = docs.find(
        (document) => document.doc_type === "shopBanner" && document.file_url,
      );
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

  const fitClass =
    fitMode === "cover" ? "object-cover" : fitMode === "contain" ? "object-contain" : "object-fill";

  const posClass =
    positionMode === "top"
      ? "object-top"
      : positionMode === "bottom"
        ? "object-bottom"
        : "object-center";

  return (
    <Card className="overflow-hidden border shadow-xs">
      {/* Adjustable Controls Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/40 px-4 py-2 text-xs">
        <div className="flex items-center gap-2 font-medium">
          <SlidersHorizontal className="h-3.5 w-3.5 text-primary" />
          <span>Adjust Image Display</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Fit Controls */}
          <div className="flex items-center rounded-md border bg-background p-0.5 shadow-2xs">
            <span className="px-1.5 text-[11px] text-muted-foreground">Fit:</span>
            {(["cover", "contain", "fill"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setFitMode(m)}
                className={`px-2 py-0.5 text-[11px] font-medium capitalize rounded transition-colors ${
                  fitMode === m
                    ? "bg-primary text-primary-foreground shadow-2xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {m}
              </button>
            ))}
          </div>

          {/* Position Controls */}
          <div className="flex items-center rounded-md border bg-background p-0.5 shadow-2xs">
            <span className="px-1.5 text-[11px] text-muted-foreground">Pos:</span>
            {(["top", "center", "bottom"] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPositionMode(p)}
                className={`px-2 py-0.5 text-[11px] font-medium capitalize rounded transition-colors ${
                  positionMode === p
                    ? "bg-primary text-primary-foreground shadow-2xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {p}
              </button>
            ))}
          </div>

          {/* Height Controls */}
          <div className="flex items-center rounded-md border bg-background p-0.5 shadow-2xs">
            <span className="px-1.5 text-[11px] text-muted-foreground">Height:</span>
            {[
              { label: "Sm", class: "h-28 sm:h-36" },
              { label: "Md", class: "h-40 sm:h-52" },
              { label: "Lg", class: "h-56 sm:h-72" },
            ].map((h) => (
              <button
                key={h.label}
                type="button"
                onClick={() => setHeightClass(h.class)}
                className={`px-2 py-0.5 text-[11px] font-medium rounded transition-colors ${
                  heightClass === h.class
                    ? "bg-primary text-primary-foreground shadow-2xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {h.label}
              </button>
            ))}
          </div>

          {/* Reset button */}
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            title="Reset display controls"
            onClick={() => {
              setFitMode("cover");
              setHeightClass("h-40 sm:h-52");
              setPositionMode("center");
            }}
          >
            <RotateCcw className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Media Canvas */}
      <div
        className={`relative ${heightClass} bg-slate-950/90 dark:bg-slate-900 transition-all duration-200`}
      >
        {images.banner ? (
          <div
            className="group relative h-full w-full cursor-pointer overflow-hidden"
            onClick={() => setLightbox({ url: images.banner!, title: `${shopName} Shop Banner` })}
          >
            <img
              src={images.banner}
              alt={`${shopName} storefront`}
              className={`h-full w-full ${fitClass} ${posClass} transition-all duration-200`}
            />
            <div className="absolute inset-0 bg-black/30 opacity-0 transition-opacity group-hover:opacity-100 flex items-center justify-center gap-2 text-white text-xs font-semibold">
              <ZoomIn className="h-4 w-4" /> Click to Inspect Banner
            </div>
          </div>
        ) : (
          <div className="grid h-full place-items-center text-sm text-muted-foreground">
            Shop banner missing
          </div>
        )}
        <div className="absolute bottom-3 left-4 flex items-end gap-3 z-10">
          <div
            className="group relative grid h-16 w-16 place-items-center overflow-hidden rounded-lg border-2 border-background bg-card shadow-md cursor-pointer"
            onClick={() =>
              images.logo && setLightbox({ url: images.logo, title: `${shopName} Shop Logo` })
            }
          >
            {images.logo ? (
              <>
                <img
                  src={images.logo}
                  alt={`${shopName} logo`}
                  className={`h-full w-full ${fitClass} ${posClass}`}
                />
                <div className="absolute inset-0 bg-black/40 opacity-0 transition-opacity group-hover:opacity-100 flex items-center justify-center text-white">
                  <ZoomIn className="h-3.5 w-3.5" />
                </div>
              </>
            ) : (
              <span className="text-xl font-bold text-primary">
                {shopName.slice(0, 1).toUpperCase()}
              </span>
            )}
          </div>
          <span className="rounded-md bg-background/90 px-2.5 py-1 text-xs font-semibold shadow-sm backdrop-blur border">
            Customer storefront preview
          </span>
        </div>
      </div>

      {/* Lightbox Dialog */}
      <Dialog open={lightbox !== null} onOpenChange={(open) => !open && setLightbox(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between pr-4">
              <span>{lightbox?.title}</span>
              {lightbox?.url && (
                <a
                  href={lightbox.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-primary hover:underline flex items-center gap-1 font-normal"
                >
                  Open Original <Maximize2 className="h-3 w-3" />
                </a>
              )}
            </DialogTitle>
          </DialogHeader>
          <div className="grid place-items-center overflow-hidden rounded-lg bg-black/95 p-4 min-h-[300px]">
            {lightbox?.url && (
              <img
                src={lightbox.url}
                alt={lightbox.title}
                className="max-h-[70vh] w-auto max-w-full object-contain rounded"
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function InfoCard({ rows }: { rows: Array<[string, string]> }) {
  return (
    <Card>
      <CardContent className="py-6">
        <dl className="grid gap-2 text-sm sm:grid-cols-[180px_1fr]">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="font-medium break-words">{v || "—"}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
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

  if (docs.length === 0)
    return (
      <div className="rounded-md border p-6 text-center text-sm text-muted-foreground">
        No documents uploaded.
      </div>
    );
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {docs.map((d) => (
        <Card key={d.id}>
          <CardContent className="flex items-center gap-3 py-4">
            <div className="grid h-16 w-16 place-items-center rounded-md border border-border bg-muted text-xs text-muted-foreground">
              {(d.file_name || "").match(/\.(png|jpe?g|webp|gif)$/i) && urls[d.id] ? (
                <img src={urls[d.id]} className="h-full w-full rounded object-cover" alt="" />
              ) : (
                "FILE"
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium capitalize">
                {d.doc_type.replace(/([A-Z])/g, " $1")}
              </div>
              <div className="truncate text-xs text-muted-foreground">{d.file_name}</div>
              {urls[d.id] && (
                <a
                  href={urls[d.id]}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-primary hover:underline"
                >
                  Open
                </a>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function fmt(n: number) {
  return "₹" + Math.round(n).toLocaleString("en-IN");
}

function VendorActivity({ userId }: { userId: string }) {
  const q = useQuery({
    queryKey: ["vendor-activity", userId],
    queryFn: async () => {
      const [prod, ord, set] = await Promise.all([
        supabase
          .from("products")
          .select("id, status, stock", { count: "exact" })
          .eq("user_id", userId),
        supabase.from("orders").select("id, total, status, created_at").eq("user_id", userId),
        supabase.from("settlements").select("net_payout, status").eq("user_id", userId),
      ]);
      const products = prod.data ?? [];
      const orders = ord.data ?? [];
      const settlements = set.data ?? [];
      const revenue = orders.reduce((s, o: any) => s + Number(o.total || 0), 0);
      const pending = settlements
        .filter((s: any) => s.status !== "paid")
        .reduce((a, s: any) => a + Number(s.net_payout || 0), 0);
      const paid = settlements
        .filter((s: any) => s.status === "paid")
        .reduce((a, s: any) => a + Number(s.net_payout || 0), 0);
      const low = products.filter((p: any) => Number(p.stock || 0) <= 5).length;
      return { products: products.length, low, orders: orders.length, revenue, pending, paid };
    },
  });
  const d = q.data;
  const tiles = [
    {
      icon: Package,
      label: "Products",
      value: d ? String(d.products) : "—",
      sub: d ? `${d.low} low stock` : "",
    },
    { icon: ShoppingCart, label: "Orders", value: d ? String(d.orders) : "—", sub: "" },
    { icon: TrendingUp, label: "Revenue", value: d ? fmt(d.revenue) : "—", sub: "" },
    {
      icon: Wallet,
      label: "Payouts",
      value: d ? fmt(d.paid) : "—",
      sub: d ? `${fmt(d.pending)} pending` : "",
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {tiles.map((t) => (
        <Card key={t.label}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{t.label}</span>
              <t.icon className="h-4 w-4 text-primary" />
            </div>
            <div className="mt-2 text-xl font-bold">{t.value}</div>
            {t.sub && <div className="mt-1 text-[11px] text-muted-foreground">{t.sub}</div>}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function VendorProducts({ userId }: { userId: string }) {
  const q = useQuery({
    queryKey: ["vendor-products", userId],
    queryFn: async () => {
      const { data } = await supabase
        .from("products")
        .select("id, name, sku, selling_price, stock, status, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(50);
      return data ?? [];
    },
  });
  if (q.isLoading)
    return <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>;
  const rows = q.data ?? [];
  if (rows.length === 0)
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          No products yet.
        </CardContent>
      </Card>
    );
  return (
    <Card>
      <CardContent className="p-0">
        <div className="divide-y divide-border">
          {rows.map((p: any) => (
            <div
              key={p.id}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3"
            >
              <div className="min-w-0">
                <div className="truncate font-medium">{p.name}</div>
                <div className="truncate text-xs text-muted-foreground">
                  SKU {p.sku || "—"} · Stock {p.stock ?? 0}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="capitalize">
                  {p.status}
                </Badge>
                <span className="text-sm font-semibold">{fmt(Number(p.selling_price || 0))}</span>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function VendorOrders({ userId }: { userId: string }) {
  const q = useQuery({
    queryKey: ["vendor-orders", userId],
    queryFn: async () => {
      const { data } = await supabase
        .from("orders")
        .select("id, buyer_name, total, status, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(50);
      return data ?? [];
    },
  });
  if (q.isLoading)
    return <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>;
  const rows = q.data ?? [];
  if (rows.length === 0)
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          No orders yet.
        </CardContent>
      </Card>
    );
  return (
    <Card>
      <CardContent className="p-0">
        <div className="divide-y divide-border">
          {rows.map((o: any) => (
            <div
              key={o.id}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3"
            >
              <div className="min-w-0">
                <div className="truncate font-medium">{o.buyer_name || "Customer"}</div>
                <div className="truncate text-xs text-muted-foreground">
                  #{String(o.id).slice(0, 8)} · {new Date(o.created_at).toLocaleString()}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="capitalize">
                  {o.status}
                </Badge>
                <span className="text-sm font-semibold">{fmt(Number(o.total || 0))}</span>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function VendorPayouts({ userId }: { userId: string }) {
  const q = useQuery({
    queryKey: ["vendor-payouts", userId],
    queryFn: async () => {
      const { data } = await supabase
        .from("settlements")
        .select(
          "id, cycle_start, cycle_end, gross_sales, commission, net_payout, status, created_at",
        )
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(50);
      return data ?? [];
    },
  });
  if (q.isLoading)
    return <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>;
  const rows = q.data ?? [];
  if (rows.length === 0)
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          No payouts yet.
        </CardContent>
      </Card>
    );
  return (
    <Card>
      <CardContent className="p-0">
        <div className="divide-y divide-border">
          {rows.map((s: any) => (
            <div
              key={s.id}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3"
            >
              <div className="min-w-0">
                <div className="truncate font-medium">{fmt(Number(s.net_payout || 0))} net</div>
                <div className="truncate text-xs text-muted-foreground">
                  Gross {fmt(Number(s.gross_sales || 0))} · Fee {fmt(Number(s.commission || 0))}
                </div>
              </div>
              <Badge variant="outline" className="capitalize">
                {s.status}
              </Badge>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
