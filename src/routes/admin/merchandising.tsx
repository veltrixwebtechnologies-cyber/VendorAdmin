import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Plus, Star } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  useBrands,
  useFeatureBrand,
  useFlashSales,
  useGiftCollections,
  useSeasonalCollections,
  useSetProductClearance,
  useUpsertCollection,
  useUpsertFlashSale,
  useUnfeatureBrand,
  type Collection,
  type FlashSale,
} from "@/lib/admin-db";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/merchandising")({
  head: () => ({
    meta: [{ title: "Merchandising — Admin" }, { name: "robots", content: "noindex" }],
  }),
  component: MerchandisingPage,
});

function MerchandisingPage() {
  const brands = useBrands();
  const sales = useFlashSales();
  const gifts = useGiftCollections();
  const seasons = useSeasonalCollections();
  const feature = useFeatureBrand();
  const unfeature = useUnfeatureBrand();
  const upsertSale = useUpsertFlashSale();
  const upsertGift = useUpsertCollection("gift_collections");
  const upsertSeason = useUpsertCollection("seasonal_collections");
  const [sale, setSale] = useState<(Partial<FlashSale> & { product_ids?: string[] }) | null>(null);
  const [collection, setCollection] = useState<{
    table: "gift_collections" | "seasonal_collections";
    value: Partial<Collection>;
  } | null>(null);
  const [brandId, setBrandId] = useState("");
  const [brandOrder, setBrandOrder] = useState(0);
  const products = useQuery({
    queryKey: ["products", "merchandising"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("products")
        .select("id,name,clearance,status,stock")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data ?? [];
    },
  });
  const featured = useQuery({
    queryKey: ["featured_brands", "admin"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("featured_brands")
        .select("brand_id,display_order,brands(name)")
        .order("display_order");
      if (error) throw error;
      return data ?? [];
    },
  });
  const setClearance = useSetProductClearance();
  const save = (
    promise: { mutate: (value: any, options?: any) => void },
    value: any,
    message: string,
    close: () => void,
  ) =>
    promise.mutate(value, {
      onSuccess: () => {
        toast.success(message);
        close();
      },
      onError: (error: Error) => toast.error(error.message),
    });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black tracking-tight sm:text-3xl">Merchandising</h1>
        <p className="text-sm text-muted-foreground">
          Manage featured brands, collections, flash sales, and clearance flags.
        </p>
      </div>
      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardContent className="space-y-3 p-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Featured brands</h2>
              <Star className="h-4 w-4 text-primary" />
            </div>
            <div className="flex gap-2">
              <select
                value={brandId}
                onChange={(e) => setBrandId(e.target.value)}
                className="h-10 flex-1 rounded-md border bg-background px-3 text-sm"
              >
                <option value="">Choose a brand</option>
                {(brands.data ?? []).map((brand) => (
                  <option key={brand.id} value={brand.id}>
                    {brand.name}
                  </option>
                ))}
              </select>
              <Input
                className="w-20"
                type="number"
                value={brandOrder}
                onChange={(e) => setBrandOrder(Number(e.target.value))}
                aria-label="Display order"
              />
              <Button
                disabled={!brandId || feature.isPending}
                onClick={() =>
                  save(
                    feature,
                    { brand_id: brandId, display_order: brandOrder },
                    "Brand featured",
                    () => setBrandId(""),
                  )
                }
              >
                Feature
              </Button>
            </div>
            {(featured.data ?? []).map((item: any) => (
              <div
                key={item.brand_id}
                className="flex items-center justify-between rounded-md border p-2 text-sm"
              >
                <span>{item.brands?.name}</span>
                <Button size="sm" variant="outline" onClick={() => unfeature.mutate(item.brand_id)}>
                  Remove
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-3 p-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Flash sales</h2>
              <Button
                size="sm"
                onClick={() =>
                  setSale({
                    title: "",
                    discount_type: "percent",
                    discount_value: 10,
                    starts_at: new Date().toISOString(),
                    ends_at: new Date(Date.now() + 86400000).toISOString(),
                    is_active: true,
                    product_ids: [],
                  })
                }
              >
                <Plus className="mr-1 h-4 w-4" />
                New
              </Button>
            </div>
            {(sales.data ?? []).slice(0, 5).map((item) => (
              <button
                key={item.id}
                onClick={() => setSale(item)}
                className="flex w-full justify-between rounded-md border p-2 text-left text-sm"
              >
                <span>{item.title}</span>
                <span className="text-muted-foreground">
                  {item.discount_value}
                  {item.discount_type === "percent" ? "%" : "₹"}
                </span>
              </button>
            ))}
            {!sales.data?.length && (
              <p className="text-sm text-muted-foreground">No flash sales yet.</p>
            )}
          </CardContent>
        </Card>
      </section>
      <section className="grid gap-4 lg:grid-cols-2">
        <CollectionList
          title="Gift collections"
          items={gifts.data}
          onAdd={() =>
            setCollection({
              table: "gift_collections",
              value: { name: "", slug: "", is_active: true, display_order: 0 },
            })
          }
          onEdit={(value) => setCollection({ table: "gift_collections", value })}
        />
        <CollectionList
          title="Seasonal collections"
          items={seasons.data}
          onAdd={() =>
            setCollection({
              table: "seasonal_collections",
              value: { name: "", slug: "", is_active: true, display_order: 0 },
            })
          }
          onEdit={(value) => setCollection({ table: "seasonal_collections", value })}
        />
      </section>
      <Card>
        <CardContent className="p-4">
          <h2 className="mb-3 font-semibold">Clearance products</h2>
          <div className="grid gap-2">
            {(products.data ?? [])
              .filter((item: any) => item.status === "approved" || item.status === "active")
              .map((item: any) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between rounded-md border p-2 text-sm"
                >
                  <span>{item.name}</span>
                  <label className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Clearance</span>
                    <input
                      type="checkbox"
                      checked={Boolean(item.clearance)}
                      onChange={(e) =>
                        setClearance.mutate({ id: item.id, clearance: e.target.checked })
                      }
                    />
                  </label>
                </div>
              ))}
          </div>
        </CardContent>
      </Card>
      <Dialog open={!!sale} onOpenChange={(open) => !open && setSale(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{sale?.id ? "Edit flash sale" : "New flash sale"}</DialogTitle>
          </DialogHeader>
          {sale && (
            <div className="grid gap-3">
              <div>
                <Label>Title</Label>
                <Input
                  value={sale.title ?? ""}
                  onChange={(e) => setSale({ ...sale, title: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label>Discount type</Label>
                  <select
                    value={sale.discount_type}
                    onChange={(e) => setSale({ ...sale, discount_type: e.target.value as any })}
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                  >
                    <option value="percent">Percent</option>
                    <option value="flat">Flat</option>
                  </select>
                </div>
                <div>
                  <Label>Value</Label>
                  <Input
                    type="number"
                    value={sale.discount_value ?? 0}
                    onChange={(e) => setSale({ ...sale, discount_value: Number(e.target.value) })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label>Starts</Label>
                  <Input
                    type="datetime-local"
                    value={sale.starts_at?.slice(0, 16) ?? ""}
                    onChange={(e) =>
                      setSale({ ...sale, starts_at: new Date(e.target.value).toISOString() })
                    }
                  />
                </div>
                <div>
                  <Label>Ends</Label>
                  <Input
                    type="datetime-local"
                    value={sale.ends_at?.slice(0, 16) ?? ""}
                    onChange={(e) =>
                      setSale({ ...sale, ends_at: new Date(e.target.value).toISOString() })
                    }
                  />
                </div>
              </div>
              <div>
                <Label>Products</Label>
                <div className="max-h-36 space-y-1 overflow-auto rounded-md border p-2">
                  {(products.data ?? [])
                    .filter((item: any) => item.status === "approved" || item.status === "active")
                    .map((item: any) => (
                      <label key={item.id} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={sale.product_ids?.includes(item.id) ?? false}
                          onChange={(e) =>
                            setSale({
                              ...sale,
                              product_ids: e.target.checked
                                ? [...(sale.product_ids ?? []), item.id]
                                : (sale.product_ids ?? []).filter((id) => id !== item.id),
                            })
                          }
                        />
                        {item.name}
                      </label>
                    ))}
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSale(null)}>
              Cancel
            </Button>
            <Button
              onClick={() =>
                sale && save(upsertSale, sale, "Flash sale saved", () => setSale(null))
              }
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!collection} onOpenChange={(open) => !open && setCollection(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Collection</DialogTitle>
          </DialogHeader>
          {collection && (
            <div className="grid gap-3">
              <div>
                <Label>Name</Label>
                <Input
                  value={collection.value.name ?? ""}
                  onChange={(e) =>
                    setCollection({
                      ...collection,
                      value: {
                        ...collection.value,
                        name: e.target.value,
                        slug: e.target.value.toLowerCase().trim().replace(/\s+/g, "-"),
                      },
                    })
                  }
                />
              </div>
              <div>
                <Label>Description</Label>
                <Input
                  value={collection.value.description ?? ""}
                  onChange={(e) =>
                    setCollection({
                      ...collection,
                      value: { ...collection.value, description: e.target.value },
                    })
                  }
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCollection(null)}>
              Cancel
            </Button>
            <Button
              onClick={() =>
                collection &&
                save(
                  collection.table === "gift_collections" ? upsertGift : upsertSeason,
                  collection.value,
                  "Collection saved",
                  () => setCollection(null),
                )
              }
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CollectionList({
  title,
  items,
  onAdd,
  onEdit,
}: {
  title: string;
  items: Collection[] | undefined;
  onAdd: () => void;
  onEdit: (value: Collection) => void;
}) {
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">{title}</h2>
          <Button size="sm" onClick={onAdd}>
            <Plus className="mr-1 h-4 w-4" />
            New
          </Button>
        </div>
        {(items ?? []).map((item) => (
          <button
            key={item.id}
            onClick={() => onEdit(item)}
            className="block w-full rounded-md border p-2 text-left text-sm"
          >
            {item.name}
          </button>
        ))}
        {!items?.length && <p className="text-sm text-muted-foreground">No collections yet.</p>}
      </CardContent>
    </Card>
  );
}
