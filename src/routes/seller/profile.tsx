import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getDataErrorMessage, useMySeller } from "@/lib/db";

export const Route = createFileRoute("/seller/profile")({
  head: () => ({
    meta: [
      { title: "Profile — Seller Hub" },
      { name: "description", content: "Review your seller profile and submitted details." },
      { property: "og:title", content: "Profile — Seller Hub" },
      { property: "og:description", content: "Review your seller profile and submitted details." },
    ],
  }),
  component: ProfilePage,
});

function ProfilePage() {
  const q = useMySeller();
  const seller = q.data;
  if (q.isError) {
    return (
      <Card className="mx-auto max-w-4xl border-destructive/40">
        <CardContent className="space-y-3 py-8 text-center">
          <AlertTriangle className="mx-auto h-6 w-6 text-destructive" />
          <p className="font-medium">Profile could not load.</p>
          <p className="text-sm text-muted-foreground">{getDataErrorMessage(q.error)}</p>
          <Button variant="outline" onClick={() => void q.refetch()}>
            <RefreshCw className="h-4 w-4" /> Try again
          </Button>
        </CardContent>
      </Card>
    );
  }
  if (q.isLoading || !seller)
    return (
      <div className="py-12 text-center">
        <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );

  const sections: Array<[string, Array<[string, string]>]> = [
    [
      "Account",
      [
        ["Full name", seller.account.fullName],
        ["Email", seller.account.email + (seller.account.emailVerified ? " (verified)" : "")],
        ["Mobile", seller.account.mobile + (seller.account.mobileVerified ? " (verified)" : "")],
      ],
    ],
    [
      "Business",
      [
        ["Shop", seller.business.shopName],
        ["Owner", seller.business.ownerName],
        ["Type", seller.business.businessType],
        ["Category", seller.business.category],
        ["Description", seller.business.description],
      ],
    ],
    [
      "Address",
      [
        [
          "Shop address",
          `${seller.address.shopAddress}, ${seller.address.city}, ${seller.address.state} - ${seller.address.pincode}`,
        ],
        ["Landmark", seller.address.landmark || "—"],
      ],
    ],
    [
      "Bank",
      [
        ["Holder", seller.bank.holderName],
        ["Bank", seller.bank.bankName],
        ["Account", seller.bank.accountNumber.replace(/.(?=.{4})/g, "•")],
        ["IFSC", seller.bank.ifsc],
      ],
    ],
    [
      "Tax",
      [
        ["PAN", seller.tax.pan],
        ["GST", seller.tax.gst || "—"],
      ],
    ],
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Profile</h1>
          <p className="text-sm text-muted-foreground">Status: {seller.status}</p>
        </div>
        <Link to="/register">
          <Button variant="outline">Edit registration</Button>
        </Link>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {sections.map(([title, rows]) => (
          <Card key={title}>
            <CardHeader>
              <CardTitle className="text-base">{title}</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-1 text-sm sm:grid-cols-[130px_1fr]">
                {rows.map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd className="font-medium break-words">{v || "—"}</dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
