import { createFileRoute, Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  BadgeCheck,
  Building2,
  CheckCircle2,
  Clock,
  CreditCard,
  ExternalLink,
  Loader2,
  MapPin,
  Package,
  Pencil,
  Phone,
  RefreshCw,
  ShoppingBag,
  Store,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getDataErrorMessage, useMySeller, type SellerStatus } from "@/lib/db";

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
