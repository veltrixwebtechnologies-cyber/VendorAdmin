import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  BadgeCheck,
  Building2,
  CheckCircle2,
  Clock,
  CreditCard,
  ExternalLink,
  ImageIcon,
  Loader2,
  MapPin,
  Package,
  Pencil,
  Phone,
  RefreshCw,
  Save,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Star,
  Store,
  Upload,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { getDataErrorMessage, useMySeller, useUpdateMySeller, type SellerStatus } from "@/lib/db";

const PRESET_BANNERS = [
  {
    name: "Grocery & Kirana",
    url: "https://images.unsplash.com/photo-1604719312566-8912e9227c6a?auto=format&fit=crop&w=1200&q=80",
  },
  {
    name: "Bakery & Sweets",
    url: "https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&w=1200&q=80",
  },
  {
    name: "Kitchen Utensils & Cookware",
    url: "https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?auto=format&fit=crop&w=1200&q=80",
  },
  {
    name: "Individual Fashion",
    url: "https://images.unsplash.com/photo-1489987707025-afc232f7ea0f?auto=format&fit=crop&w=1200&q=80",
  },
  {
    name: "Electronics & Showroom",
    url: "https://images.unsplash.com/photo-1593359677879-a4bb92f829d1?auto=format&fit=crop&w=1200&q=80",
  },
  {
    name: "Pharmacy & Wellness",
    url: "https://images.unsplash.com/photo-1587854692152-cbe660dbde88?auto=format&fit=crop&w=1200&q=80",
  },
  {
    name: "Palamuthir Fruits & Veg",
    url: "https://images.unsplash.com/photo-1610832958506-aa56368176cf?auto=format&fit=crop&w=1200&q=80",
  },
];

export const Route = createFileRoute("/seller/store")({
  head: () => ({
    meta: [
      { title: "Store Profile — Seller Hub" },
      { name: "description", content: "View and manage your storefront profile." },
      { property: "og:title", content: "Store Profile — Seller Hub" },
      { property: "og:description", content: "View and manage your storefront profile." },
    ],
  }),
  component: StoreSetupPage,
});

function StoreSetupPage() {
  const sellerQ = useMySeller();
  if (sellerQ.isError) {
    return (
      <Card className="mx-auto max-w-4xl border-destructive/40">
        <CardContent className="space-y-3 py-8 text-center">
          <AlertTriangle className="mx-auto h-6 w-6 text-destructive" />
          <p className="font-medium">Store profile could not load.</p>
          <p className="text-sm text-muted-foreground">{getDataErrorMessage(sellerQ.error)}</p>
          <Button variant="outline" onClick={() => void sellerQ.refetch()}>
            <RefreshCw className="h-4 w-4" /> Try again
          </Button>
        </CardContent>
      </Card>
    );
  }
  if (sellerQ.isLoading || !sellerQ.data) {
    return (
      <div className="grid min-h-[40vh] place-items-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  const seller = sellerQ.data;
  const isApproved = seller.status === "approved";

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Store Setup & Profile</h1>
          <p className="text-sm text-muted-foreground">
            {isApproved
              ? "Your store account is active and verified on LocalShore."
              : "Review and update your storefront details."}
          </p>
        </div>
        <StatusBadge status={seller.status} />
      </div>

      {isApproved ? (
        <Card className="border-success/40 bg-success/5">
          <CardContent className="flex flex-wrap items-center justify-between gap-4 py-4">
            <div className="flex items-center gap-3">
              <BadgeCheck className="h-6 w-6 text-success shrink-0" />
              <div>
                <p className="font-semibold text-foreground">Verified & Active Seller Account</p>
                <p className="text-xs text-muted-foreground">
                  Your store profile is live. Customers in your area can browse your products.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link to="/seller/products">
                <Button size="sm" className="gap-1.5 font-semibold">
                  <Package className="h-4 w-4" /> Manage products
                </Button>
              </Link>
              <Link to="/seller/hours">
                <Button size="sm" variant="outline" className="gap-1.5 font-semibold">
                  <Clock className="h-4 w-4" /> Shop hours
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      ) : seller.status === "pending" ? (
        <Card className="border-amber-500/40 bg-amber-500/10">
          <CardContent className="flex flex-wrap items-center justify-between gap-4 py-4">
            <div className="flex items-center gap-3">
              <Clock className="h-6 w-6 text-amber-600 dark:text-amber-400 shrink-0 animate-pulse" />
              <div>
                <p className="font-semibold text-foreground">Store Application Under Review</p>
                <p className="text-xs text-muted-foreground">
                  Verification takes up to 24 hours. Your details have been submitted for review.
                </p>
              </div>
            </div>
            <Link to="/register" search={{ step: 7 }}>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 font-semibold border-amber-500/40"
              >
                <ExternalLink className="h-4 w-4" /> View application
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : seller.status === "more_info" || seller.status === "rejected" ? (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="flex flex-wrap items-center justify-between gap-4 py-4">
            <div className="flex items-center gap-3">
              <AlertTriangle className="h-6 w-6 text-destructive shrink-0" />
              <div>
                <p className="font-semibold text-foreground">Action Required on Registration</p>
                <p className="text-xs text-muted-foreground">
                  {seller.reviewNote || "Please update your application details and resubmit."}
                </p>
              </div>
            </div>
            <Link to="/register" search={{ step: 6 }}>
              <Button size="sm" variant="destructive" className="gap-1.5 font-semibold">
                <RefreshCw className="h-4 w-4" /> Fix & resubmit
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-primary/40 bg-primary/5">
          <CardContent className="flex flex-wrap items-center justify-between gap-4 py-4">
            <div className="flex items-center gap-3">
              <Store className="h-6 w-6 text-primary shrink-0" />
              <div>
                <p className="font-semibold text-foreground">Incomplete Registration</p>
                <p className="text-xs text-muted-foreground">
                  Complete registration to submit your store for verification.
                </p>
              </div>
            </div>
            <Button
              size="sm"
              onClick={() => window.location.assign("/register")}
              className="gap-1.5 font-semibold"
            >
              Continue registration
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Storefront Hero Banner & Design Customizer */}
      <StorefrontCustomizer seller={seller} />

      {/* Store Information Details Card */}
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-4 border-b border-border/60">
          <CardTitle className="flex items-center gap-2 text-base">
            <Store className="h-5 w-5 text-primary" /> Business Details
          </CardTitle>
          <Link to="/register" search={{ step: 1 }}>
            <Button size="sm" variant="ghost" className="gap-1.5 text-xs">
              <Pencil className="h-3.5 w-3.5" /> Edit details
            </Button>
          </Link>
        </CardHeader>
        <CardContent className="pt-5 space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-xs text-muted-foreground uppercase font-semibold">
                Store / Shop Name
              </p>
              <p className="mt-1 text-sm font-bold text-foreground">
                {seller.business.shopName || "Not provided"}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase font-semibold">Owner Name</p>
              <p className="mt-1 text-sm font-bold text-foreground">
                {seller.business.ownerName || seller.account.fullName || "Not provided"}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase font-semibold">Category</p>
              <p className="mt-1 text-sm font-semibold text-foreground capitalize">
                {seller.business.category || "General"}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase font-semibold">Business Type</p>
              <p className="mt-1 text-sm font-semibold text-foreground capitalize">
                {seller.business.businessType || "Retail"}
              </p>
            </div>
          </div>

          <div>
            <p className="text-xs text-muted-foreground uppercase font-semibold">
              Store Description
            </p>
            <p className="mt-1 text-sm text-foreground/90 leading-relaxed bg-muted/30 p-3 rounded-lg border border-border/50">
              {seller.business.description || "No description provided."}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Address & Contact Details Card */}
      <div className="grid gap-6 sm:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-3 border-b border-border/60">
            <CardTitle className="flex items-center gap-2 text-sm font-bold">
              <MapPin className="h-4 w-4 text-primary" /> Store Location
            </CardTitle>
            <Link to="/register" search={{ step: 3 }}>
              <Button size="sm" variant="ghost" className="h-7 text-xs px-2">
                <Pencil className="h-3 w-3" /> Edit
              </Button>
            </Link>
          </CardHeader>
          <CardContent className="pt-4 space-y-2 text-xs">
            <p className="font-semibold text-foreground text-sm">{seller.business.shopName}</p>
            <p className="text-muted-foreground leading-relaxed">
              {seller.address.shopAddress || "No address line"}
            </p>
            <p className="text-muted-foreground">
              {[seller.address.city, seller.address.state, seller.address.pincode]
                .filter(Boolean)
                .join(", ")}
            </p>
            {seller.address.pickupSame === false && (
              <div className="mt-3 pt-2 border-t border-border/60">
                <p className="font-semibold text-foreground">Separate Pickup Address:</p>
                <p className="text-muted-foreground">
                  {[
                    seller.address.pickupAddress,
                    seller.address.pickupCity,
                    seller.address.pickupState,
                    seller.address.pickupPincode,
                  ]
                    .filter(Boolean)
                    .join(", ")}
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-3 border-b border-border/60">
            <CardTitle className="flex items-center gap-2 text-sm font-bold">
              <Phone className="h-4 w-4 text-primary" /> Contact & Account
            </CardTitle>
            <Link to="/register" search={{ step: 2 }}>
              <Button size="sm" variant="ghost" className="h-7 text-xs px-2">
                <Pencil className="h-3 w-3" /> Edit
              </Button>
            </Link>
          </CardHeader>
          <CardContent className="pt-4 space-y-3 text-xs">
            <div>
              <p className="text-muted-foreground">Registered Email:</p>
              <p className="font-medium text-foreground">{seller.account.email}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Contact Phone:</p>
              <p className="font-medium text-foreground">
                {seller.account.mobile || "Not provided"}
              </p>
            </div>
            {seller.tax.gst && (
              <div>
                <p className="text-muted-foreground">GSTIN:</p>
                <p className="font-mono text-foreground font-semibold">{seller.tax.gst}</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Bank & Payout Details Card */}
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-3 border-b border-border/60">
          <CardTitle className="flex items-center gap-2 text-sm font-bold">
            <CreditCard className="h-4 w-4 text-primary" /> Bank & Settlement Account
          </CardTitle>
          <Link to="/register" search={{ step: 5 }}>
            <Button size="sm" variant="ghost" className="h-7 text-xs px-2">
              <Pencil className="h-3 w-3" /> Edit
            </Button>
          </Link>
        </CardHeader>
        <CardContent className="pt-4">
          <div className="grid gap-4 sm:grid-cols-3 text-xs">
            <div>
              <p className="text-muted-foreground">Account Holder</p>
              <p className="font-semibold text-foreground mt-0.5">
                {seller.bank.holderName || "Not set"}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Bank Name</p>
              <p className="font-semibold text-foreground mt-0.5">
                {seller.bank.bankName || "Not set"}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Account Number / IFSC</p>
              <p className="font-mono font-semibold text-foreground mt-0.5">
                {seller.bank.accountNumber
                  ? `•••• ${seller.bank.accountNumber.slice(-4)} (${seller.bank.ifsc})`
                  : "Not set"}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function StatusBadge({ status }: { status: SellerStatus }) {
  const map: Record<SellerStatus, { label: string; className: string }> = {
    draft: { label: "Draft", className: "bg-muted text-muted-foreground" },
    pending: {
      label: "Pending Verification",
      className: "bg-amber-500/10 text-amber-600 border border-amber-500/30",
    },
    approved: {
      label: "Verified Store",
      className: "bg-success/15 text-success border border-success/30 font-bold",
    },
    rejected: {
      label: "Rejected",
      className: "bg-destructive/15 text-destructive border border-destructive/30",
    },
    more_info: {
      label: "Info Requested",
      className: "bg-amber-500/10 text-amber-600 border border-amber-500/30",
    },
  };
  const m = map[status];
  return <Badge className={m.className}>{m.label}</Badge>;
}

function StorefrontCustomizer({ seller }: { seller: any }) {
  const updateSeller = useUpdateMySeller();
  const [shopName, setShopName] = useState(seller.business.shopName || "");
  const [tagline, setTagline] = useState(
    seller.business.description || "Daily fresh groceries, staples, cooking oil, snacks & household ration",
  );
  const [category, setCategory] = useState(seller.business.category || "Grocery");
  const [bannerUrl, setBannerUrl] = useState(
    seller.documents?.shopBanner?.url ||
      seller.documents?.shopBanner?.dataUrl ||
      PRESET_BANNERS[0].url,
  );

  const handleSave = async () => {
    try {
      await updateSeller.mutateAsync({
        business: {
          ...seller.business,
          shopName,
          category,
          description: tagline,
        },
        documents: {
          ...seller.documents,
          shopBanner: {
            name: "banner.jpg",
            size: 0,
            type: "image/jpeg",
            url: bannerUrl,
          },
        },
      });
      toast.success("Storefront banner and details updated successfully!");
    } catch (err: any) {
      toast.error(err.message || "Failed to update storefront settings.");
    }
  };

  const currentBanner = bannerUrl || PRESET_BANNERS[0].url;

  return (
    <Card className="border-amber-300/80 shadow-md overflow-hidden">
      <CardHeader className="border-b border-border/60 pb-4 bg-amber-50/30 dark:bg-amber-950/10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg font-extrabold text-foreground">
              <Sparkles className="h-5 w-5 text-amber-500 fill-amber-400/30" />
              <span>Storefront Hero Banner & Design Customizer</span>
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              Sellers can customize their hero banner image, tagline, emblem logo & store category in real-time.
            </p>
          </div>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={updateSeller.isPending}
            className="bg-[#981495] hover:bg-purple-800 text-white font-bold gap-1.5 shadow-sm"
          >
            {updateSeller.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            <span>Save Storefront</span>
          </Button>
        </div>
      </CardHeader>

      <CardContent className="pt-5 space-y-6">
        {/* LIVE STORE HERO BANNER PREVIEW (Matching Shopper View Exact Design) */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <Label className="text-xs uppercase font-extrabold text-muted-foreground tracking-wider">
              Live Shopper App Preview (Store Header)
            </Label>
            <span className="text-[11px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
              ● Live Real-time Sync
            </span>
          </div>

          <div className="relative overflow-hidden rounded-3xl bg-slate-900 gold-metallic-border-dark gold-glow-md shadow-xl min-h-[210px] flex items-center group">
            {/* Full-width Background Image */}
            <img
              src={currentBanner}
              alt="Store hero banner"
              className="absolute inset-0 h-full w-full object-cover object-center opacity-95 transition-transform duration-700"
            />

            {/* Smooth Light Fade Gradient on Left */}
            <div className="absolute inset-0 bg-gradient-to-r from-[#fdfbf9] via-[#fdfbf9]/95 via-80% to-transparent w-full md:w-[62%] z-10" />

            {/* Verified Store Top-Right Badge */}
            <div className="absolute top-4 right-4 z-20">
              <div className="inline-flex items-center gap-1.5 rounded-full bg-white/95 backdrop-blur-md px-3.5 py-1.5 text-xs font-black text-slate-900 shadow-xl border border-amber-300/80">
                <ShieldCheck className="h-4 w-4 text-[#981495]" />
                <span>Verified Store</span>
              </div>
            </div>

            {/* Bottom Right Handwritten Watermark */}
            <div className="absolute bottom-4 right-6 z-20 text-right hidden sm:block">
              <p className="font-['Caveat'] text-2xl font-extrabold text-amber-200 tracking-wide drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]">
                Traditional Elegance
              </p>
              <p className="font-['Caveat'] text-xl font-bold text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]">
                Modern Living
              </p>
            </div>

            {/* Left Content Area (Logo Box + Store Details) */}
            <div className="relative z-20 p-5 sm:p-7 md:p-8 max-w-3xl flex flex-col sm:flex-row items-start sm:items-center gap-4.5">
              {/* Store Brand Emblem Logo Box */}
              <div className="h-20 w-20 rounded-2xl bg-[#310938] text-[#f5d061] flex flex-col items-center justify-center gold-metallic-border-dark gold-glow-sm shrink-0">
                <Sparkles className="h-7 w-7 text-amber-400 fill-amber-400/30 mb-0.5" />
                <span className="font-mono font-black text-[9px] uppercase tracking-widest text-amber-200">
                  STORE
                </span>
              </div>

              {/* Store Info & Ratings */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="inline-flex items-center gap-1 rounded-full bg-purple-100 px-2.5 py-0.5 text-[10px] font-bold text-[#981495] border border-purple-200">
                    Verified Shoreline Merchant
                  </span>
                </div>

                <h1 className="font-extrabold text-xl sm:text-2xl text-slate-900 leading-tight tracking-tight">
                  {shopName || "Your Store Name"}
                </h1>

                <p className="text-xs sm:text-sm font-semibold text-slate-600 truncate mt-0.5">
                  {tagline || "Your store tagline & description"}
                </p>

                {/* Info Badges Row */}
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-bold text-slate-700">
                  <div className="flex items-center gap-1 text-slate-600 bg-white/80 px-2.5 py-1 rounded-full border border-slate-200 shadow-2xs">
                    <MapPin className="h-3.5 w-3.5 text-[#981495] shrink-0" />
                    <span className="truncate max-w-[220px]">
                      {seller.address?.shopAddress || "Store location"}
                    </span>
                  </div>

                  <div className="flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-amber-900 border border-amber-200 shadow-2xs">
                    <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                    <span>4.9</span>
                    <span className="text-amber-700 font-normal">(150+ reviews)</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* EDIT FIELDS */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="shopName" className="text-xs font-bold text-foreground">
              Shop Name (As displayed on Shopper App)
            </Label>
            <Input
              id="shopName"
              value={shopName}
              onChange={(e) => setShopName(e.target.value)}
              placeholder="e.g. Kovilmedu Supermarket & Kirana"
              className="mt-1 font-semibold"
            />
          </div>

          <div>
            <Label htmlFor="category" className="text-xs font-bold text-foreground">
              Store Category
            </Label>
            <Input
              id="category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="e.g. Grocery, Bakery, Kitchen Appliances"
              className="mt-1 font-semibold"
            />
          </div>
        </div>

        <div>
          <Label htmlFor="tagline" className="text-xs font-bold text-foreground">
            Store Tagline / Subtitle (Appears on Hero Banner)
          </Label>
          <Textarea
            id="tagline"
            value={tagline}
            onChange={(e) => setTagline(e.target.value)}
            rows={2}
            placeholder="e.g. Daily fresh groceries, staples, cooking oil, snacks & household ration"
            className="mt-1 font-medium text-sm"
          />
        </div>

        {/* BANNER SELECTION PRESETS */}
        <div>
          <Label className="text-xs font-bold text-foreground block mb-2">
            Select Hero Banner Preset (or Enter Custom Image URL below)
          </Label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            {PRESET_BANNERS.map((preset) => (
              <button
                key={preset.name}
                type="button"
                onClick={() => setBannerUrl(preset.url)}
                className={`group relative overflow-hidden rounded-xl border-2 p-1 text-left transition-all ${
                  bannerUrl === preset.url
                    ? "border-[#981495] ring-2 ring-purple-500/20 bg-purple-50/50"
                    : "border-border/60 hover:border-amber-300"
                }`}
              >
                <div className="aspect-[16/9] w-full overflow-hidden rounded-lg bg-muted">
                  <img
                    src={preset.url}
                    alt={preset.name}
                    className="h-full w-full object-cover group-hover:scale-105 transition-transform"
                  />
                </div>
                <p className="mt-1 text-[11px] font-bold text-foreground truncate px-1">
                  {preset.name}
                </p>
              </button>
            ))}
          </div>

          <div className="mt-3">
            <Label htmlFor="bannerUrl" className="text-xs font-medium text-muted-foreground">
              Custom Hero Banner Image URL
            </Label>
            <div className="flex flex-wrap gap-2 mt-1">
              <Input
                id="bannerUrl"
                value={bannerUrl}
                onChange={(e) => setBannerUrl(e.target.value)}
                placeholder="https://images.unsplash.com/..."
                className="font-mono text-xs flex-1 min-w-[200px]"
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  const targetUrl = bannerUrl.trim() || PRESET_BANNERS[0].url;
                  setBannerUrl(targetUrl);
                  document.getElementById("live-shopper-preview")?.scrollIntoView({ behavior: "smooth" });
                  toast.success("Live preview updated! Scroll up to view your store hero banner.");
                }}
                className="text-xs font-bold shrink-0 bg-purple-50 text-[#981495] hover:bg-purple-100 border-purple-200"
              >
                <ImageIcon className="h-3.5 w-3.5 mr-1" /> Live Preview
              </Button>

              <a
                href={`http://localhost:3000/store/${seller.id}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md bg-amber-400 hover:bg-amber-300 px-3 py-2 text-xs font-black text-slate-950 shadow-xs transition-all shrink-0"
              >
                <span>View Live Store ↗</span>
              </a>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
