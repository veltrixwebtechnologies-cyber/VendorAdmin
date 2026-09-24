import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  useDeleteLocalShoreOffer,
  useLocalShoreOffers,
  useUpsertLocalShoreOffer,
  type LocalShoreOffer,
} from "@/lib/admin-db";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/offers")({
  head: () => ({
    meta: [{ title: "LocalShore Offers — Admin" }, { name: "robots", content: "noindex" }],
  }),
  component: OffersPage,
});

const blankOffer: Partial<LocalShoreOffer> = {
  title: "",
  description: "",
  validity: "Valid till 31 Dec",
  action: "Explore shops",
  category: "all-shops",
  image_url: "/marketplace-ads/groceries-hero.png",
  accent: "#7c3aed",
  coupon: "",
  sort_order: 0,
  is_active: true,
};

function OffersPage() {
  const query = useLocalShoreOffers();
  const upsert = useUpsertLocalShoreOffer();
  const remove = useDeleteLocalShoreOffer();
  const [editing, setEditing] = useState<Partial<LocalShoreOffer> | null>(null);

  const save = () => {
    if (!editing?.title?.trim() || !editing.image_url?.trim()) {
      toast.error("Title and image URL are required.");
      return;
    }
    upsert.mutate(editing, {
      onSuccess: () => {
        toast.success("Offer saved and published.");
        setEditing(null);
      },
      onError: (error: any) => toast.error(error.message || "Could not save offer."),
    });
  };

  return (
    <div className="min-w-0 space-y-4 [overflow-wrap:anywhere] [&_button]:min-h-11">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black tracking-tight sm:text-3xl">LocalShore Offers</h1>
          <p className="text-sm text-muted-foreground">
            Control the four offer cards shown on the shopper homepage.
          </p>
        </div>
        <Button className="min-h-11 w-full sm:w-auto" onClick={() => setEditing({ ...blankOffer })}>
          <Plus className="mr-1.5 h-4 w-4" />
          New offer
        </Button>
      </div>
      {query.isLoading ? (
        <div className="h-24 animate-pulse rounded-xl bg-muted" />
      ) : (
        <div className="grid min-w-0 grid-cols-1 gap-3 xl:grid-cols-2">
          {(query.data ?? []).map((offer) => (
            <Card key={offer.id} className={!offer.is_active ? "opacity-60" : ""}>
              <CardContent className="flex min-w-0 flex-col gap-4 p-4 sm:flex-row">
                <img
                  src={offer.image_url}
                  alt=""
                  className="h-36 w-full shrink-0 rounded-lg object-cover sm:h-24 sm:w-28"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h2 className="font-bold whitespace-pre-line">{offer.title}</h2>
                      <p className="text-xs text-muted-foreground">{offer.description}</p>
                    </div>
                    {!offer.is_active && <Badge variant="secondary">Hidden</Badge>}
                  </div>
                  <p className="mt-2 text-xs">
                    {offer.coupon || "No coupon"} · order {offer.sort_order}
                  </p>
                  <div className="mt-2 flex gap-1">
                    <Button size="sm" variant="outline" onClick={() => setEditing(offer)}>
                      <Pencil className="mr-1 h-3.5 w-3.5" />
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        remove.mutate(offer.id, {
                          onSuccess: () => toast.success("Offer deleted."),
                        })
                      }
                    >
                      <Trash2 className="mr-1 h-3.5 w-3.5" />
                      Delete
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
          {!query.data?.length && (
            <Card>
              <CardContent className="py-16 text-center text-sm text-muted-foreground">
                No offers yet. Add the first card to publish it.
              </CardContent>
            </Card>
          )}
        </div>
      )}
      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-h-[90dvh] w-[calc(100%-2rem)] overflow-y-auto rounded-xl p-4 sm:max-w-2xl sm:p-6 [&_input]:min-w-0 [&_input]:text-base [&_textarea]:text-base [&_button]:min-h-11">
          <DialogHeader>
            <DialogTitle>
              {editing?.id ? "Edit LocalShore offer" : "New LocalShore offer"}
            </DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="grid min-w-0 gap-3 [&>div]:min-w-0 [&>div.grid]:grid-cols-1 sm:[&>div.grid]:grid-cols-2">
              <div>
                <Label>Title</Label>
                <Textarea
                  rows={2}
                  value={editing.title ?? ""}
                  onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                  placeholder={"Up to 40% Off\nat Local Shops"}
                />
              </div>
              <div>
                <Label>Description</Label>
                <Input
                  value={editing.description ?? ""}
                  onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Validity text</Label>
                  <Input
                    value={editing.validity ?? ""}
                    onChange={(e) => setEditing({ ...editing, validity: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Coupon code</Label>
                  <Input
                    value={editing.coupon ?? ""}
                    onChange={(e) =>
                      setEditing({ ...editing, coupon: e.target.value.toUpperCase() })
                    }
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Button label</Label>
                  <Input
                    value={editing.action ?? ""}
                    onChange={(e) => setEditing({ ...editing, action: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Search category</Label>
                  <Input
                    value={editing.category ?? ""}
                    onChange={(e) => setEditing({ ...editing, category: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <Label>Image URL or storage path</Label>
                <Input
                  value={editing.image_url ?? ""}
                  onChange={(e) => setEditing({ ...editing, image_url: e.target.value })}
                  placeholder="/marketplace-ads/groceries-hero.png"
                />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label>Accent color</Label>
                  <Input
                    value={editing.accent ?? "#7c3aed"}
                    onChange={(e) => setEditing({ ...editing, accent: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Display order</Label>
                  <Input
                    type="number"
                    value={editing.sort_order ?? 0}
                    onChange={(e) => setEditing({ ...editing, sort_order: Number(e.target.value) })}
                  />
                </div>
                <label className="flex items-center gap-2 pt-6 text-sm">
                  <input
                    type="checkbox"
                    checked={editing.is_active ?? true}
                    onChange={(e) => setEditing({ ...editing, is_active: e.target.checked })}
                  />{" "}
                  Published
                </label>
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={upsert.isPending}>
              {upsert.isPending ? "Saving…" : "Save offer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
