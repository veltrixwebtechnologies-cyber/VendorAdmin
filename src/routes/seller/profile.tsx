import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { AlertTriangle, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { getDataErrorMessage, useMySeller, useDeleteMyAccount } from "@/lib/db";

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
  const navigate = useNavigate();
  const q = useMySeller();
  const deleteMyAccount = useDeleteMyAccount();
  const [deleteOpen, setDeleteOpen] = useState(false);
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

  const handleDelete = () => {
    deleteMyAccount.mutate(seller.id, {
      onSuccess: () => {
        toast.success("Your seller account and shop profile have been completely deleted.");
        setDeleteOpen(false);
        navigate({ to: "/seller", replace: true });
      },
      onError: (err) => {
        toast.error("Failed to delete account: " + getDataErrorMessage(err));
      },
    });
  };

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

      {/* Danger Zone */}
      <Card className="border-destructive/30 bg-destructive/5">
        <CardHeader>
          <CardTitle className="text-base font-bold text-destructive flex items-center gap-2">
            <Trash2 className="h-4 w-4" /> Danger Zone
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h4 className="font-medium text-foreground text-sm">Delete Seller Account & Shop</h4>
            <p className="text-xs text-muted-foreground">
              Permanently delete your shop profile, products, availability hours, and document records.
            </p>
          </div>
          <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
            <DialogTrigger asChild>
              <Button variant="destructive" size="sm" className="shrink-0 font-semibold">
                <Trash2 className="mr-2 h-4 w-4" /> Delete Account
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle className="text-destructive flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5" /> Delete Account Permanently?
                </DialogTitle>
                <DialogDescription className="pt-2 text-sm leading-relaxed">
                  Are you sure you want to delete <strong>{seller.business.shopName || "your shop"}</strong>?
                  All products, business details, operating hours, and uploaded documents will be permanently removed.
                  This action cannot be undone.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="gap-2 sm:gap-0 pt-4">
                <Button variant="outline" onClick={() => setDeleteOpen(false)}>
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleDelete}
                  disabled={deleteMyAccount.isPending}
                >
                  {deleteMyAccount.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Deleting…
                    </>
                  ) : (
                    "Confirm & Delete"
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardContent>
      </Card>
    </div>
  );
}
