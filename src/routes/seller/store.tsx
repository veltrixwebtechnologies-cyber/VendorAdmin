import { createFileRoute, Link } from "@tanstack/react-router";
import { Loader2, Store } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useMySeller } from "@/lib/db";

export const Route = createFileRoute("/seller/store")({
  head: () => ({
    meta: [
      { title: "Store Setup — Seller Hub" },
      { name: "description", content: "Configure your storefront." },
      { property: "og:title", content: "Store Setup — Seller Hub" },
      { property: "og:description", content: "Configure your storefront." },
    ],
  }),
  component: StoreSetupPage,
});

function StoreSetupPage() {
  const sellerQ = useMySeller();
  if (sellerQ.isLoading || !sellerQ.data) {
    return <div className="grid min-h-[40vh] place-items-center"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>;
  }

  const seller = sellerQ.data;
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Store Setup</h1>
        <p className="text-sm text-muted-foreground">Complete your store details as part of the seller application.</p>
      </div>
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Store className="h-5 w-5 text-primary" /> {seller.business.shopName || "Your store"}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Store profile, address, bank details and documents are completed in the registration steps. Current status: <span className="font-medium text-foreground">{seller.status}</span>.
          </p>
          <Button onClick={() => window.location.assign("/register")}>Continue registration</Button>
        </CardContent>
      </Card>
    </div>
  );
}
