import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCoupons, useUpsertCoupon, useDeleteCoupon, type Coupon } from "@/lib/admin-db";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/coupons")({
  head: () => ({ meta: [{ title: "Coupons — Admin" }, { name: "robots", content: "noindex" }] }),
  component: CouponsPage,
});

function CouponsPage() {
  const q = useCoupons();
  const upsert = useUpsertCoupon();
  const del = useDeleteCoupon();
  const [editing, setEditing] = useState<Partial<Coupon> | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-black tracking-tight sm:text-3xl">Coupons & Promotions</h1>
          <p className="text-sm text-muted-foreground">
            Flash sales, festival offers, free shipping.
          </p>
        </div>
        <Button
          onClick={() =>
            setEditing({
              code: "",
              discount_type: "percent",
              discount_value: 10,
              is_active: true,
              min_order: 0,
              used_count: 0,
            })
          }
          className="gap-1"
        >
          <Plus className="h-4 w-4" />
          New coupon
        </Button>
      </div>
      {q.isLoading ? (
        <div className="h-24 animate-pulse rounded-xl bg-muted" />
      ) : (q.data ?? []).length === 0 ? (
        <Card>
          <CardContent className="grid place-items-center py-16 text-sm text-muted-foreground">
            No coupons yet.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-2 stagger">
          {(q.data ?? []).map((c) => (
            <Card key={c.id}>
              <CardContent className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 p-4 items-center">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono font-bold">{c.code}</span>
                    <Badge variant="outline">
                      {c.discount_type === "percent"
                        ? `${c.discount_value}%`
                        : c.discount_type === "flat"
                          ? `₹${c.discount_value}`
                          : "Free shipping"}
                    </Badge>
                    {!c.is_active && <Badge variant="secondary">Inactive</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Used {c.used_count}
                    {c.usage_limit ? `/${c.usage_limit}` : ""} · Min ₹{c.min_order}{" "}
                    {c.expires_at ? `· Expires ${new Date(c.expires_at).toLocaleDateString()}` : ""}
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button size="icon" variant="ghost" onClick={() => setEditing(c)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => {
                      if (confirm("Delete coupon?"))
                        del.mutate(c.id, { onSuccess: () => toast.success("Deleted") });
                    }}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog
        open={!!editing}
        onOpenChange={(o) => {
          if (!o) setEditing(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Edit coupon" : "New coupon"}</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="grid gap-3">
              <div>
                <Label>Code</Label>
                <Input
                  value={editing.code || ""}
                  onChange={(e) => setEditing({ ...editing, code: e.target.value.toUpperCase() })}
                />
              </div>
              <div>
                <Label>Description</Label>
                <Textarea
                  value={editing.description || ""}
                  onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label>Type</Label>
                  <Select
                    value={editing.discount_type}
                    onValueChange={(v) => setEditing({ ...editing, discount_type: v as any })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="percent">Percent</SelectItem>
                      <SelectItem value="flat">Flat ₹</SelectItem>
                      <SelectItem value="free_shipping">Free shipping</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Value</Label>
                  <Input
                    type="number"
                    value={editing.discount_value ?? 0}
                    onChange={(e) =>
                      setEditing({ ...editing, discount_value: Number(e.target.value) })
                    }
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label>Min order</Label>
                  <Input
                    type="number"
                    value={editing.min_order ?? 0}
                    onChange={(e) => setEditing({ ...editing, min_order: Number(e.target.value) })}
                  />
                </div>
                <div>
                  <Label>Usage limit</Label>
                  <Input
                    type="number"
                    value={editing.usage_limit ?? ""}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        usage_limit: e.target.value ? Number(e.target.value) : null,
                      })
                    }
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label>Starts</Label>
                  <Input
                    type="datetime-local"
                    value={editing.starts_at?.slice(0, 16) || ""}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        starts_at: e.target.value ? new Date(e.target.value).toISOString() : null,
                      })
                    }
                  />
                </div>
                <div>
                  <Label>Expires</Label>
                  <Input
                    type="datetime-local"
                    value={editing.expires_at?.slice(0, 16) || ""}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        expires_at: e.target.value ? new Date(e.target.value).toISOString() : null,
                      })
                    }
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  id="ac"
                  type="checkbox"
                  checked={editing.is_active ?? true}
                  onChange={(e) => setEditing({ ...editing, is_active: e.target.checked })}
                />
                <Label htmlFor="ac">Active</Label>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!editing?.code) return;
                upsert.mutate(editing as any, {
                  onSuccess: () => {
                    toast.success("Saved");
                    setEditing(null);
                  },
                  onError: (e: any) => toast.error(e.message),
                });
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
