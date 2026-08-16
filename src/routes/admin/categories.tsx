import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  useCategories,
  useUpsertCategory,
  useDeleteCategory,
  useBrands,
  useUpsertBrand,
  useDeleteBrand,
  type Category,
  type Brand,
} from "@/lib/admin-db";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/categories")({
  head: () => ({ meta: [{ title: "Categories — Admin" }, { name: "robots", content: "noindex" }] }),
  component: CategoriesPage,
});

function slugify(s: string) {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function CategoriesPage() {
  const cats = useCategories();
  const brands = useBrands();
  const upsertCat = useUpsertCategory();
  const delCat = useDeleteCategory();
  const upsertBrand = useUpsertBrand();
  const delBrand = useDeleteBrand();

  const [editingCat, setEditingCat] = useState<Partial<Category> | null>(null);
  const [editingBrand, setEditingBrand] = useState<Partial<Brand> | null>(null);

  const roots = useMemo(() => (cats.data ?? []).filter((c) => !c.parent_id), [cats.data]);
  const children = (id: string) => (cats.data ?? []).filter((c) => c.parent_id === id);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-black tracking-tight sm:text-3xl">Categories & Brands</h1>
          <p className="text-sm text-muted-foreground">Organize the storefront taxonomy.</p>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={() => setEditingCat({ name: "", slug: "", is_active: true, sort_order: 0 })}
            className="gap-1"
          >
            <Plus className="h-4 w-4" /> Category
          </Button>
          <Button
            variant="outline"
            onClick={() => setEditingBrand({ name: "", slug: "", is_active: true })}
            className="gap-1"
          >
            <Plus className="h-4 w-4" /> Brand
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardContent className="p-4 space-y-2">
            <div className="text-sm font-semibold">Categories</div>
            {cats.isLoading ? (
              <div className="h-24 animate-pulse rounded-lg bg-muted" />
            ) : roots.length === 0 ? (
              <div className="text-sm text-muted-foreground py-6 text-center">
                No categories yet
              </div>
            ) : (
              <ul className="space-y-1">
                {roots.map((c) => (
                  <li key={c.id}>
                    <div className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-muted">
                      <div className="min-w-0">
                        <span className="truncate font-medium">{c.name}</span>
                        <span className="ml-2 text-xs text-muted-foreground">/{c.slug}</span>
                        {!c.is_active && (
                          <Badge variant="outline" className="ml-2 text-[10px]">
                            Inactive
                          </Badge>
                        )}
                      </div>
                      <div className="flex gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => setEditingCat({ ...c, parent_id: c.id })}
                          title="Add subcategory"
                        >
                          <Plus className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => setEditingCat(c)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => {
                            if (confirm("Delete category?"))
                              delCat.mutate(c.id, { onSuccess: () => toast.success("Deleted") });
                          }}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </div>
                    {children(c.id).length > 0 && (
                      <ul className="ml-6 border-l border-border pl-2 space-y-1">
                        {children(c.id).map((sub) => (
                          <li
                            key={sub.id}
                            className="flex items-center justify-between gap-2 rounded-lg px-2 py-1 hover:bg-muted"
                          >
                            <div className="min-w-0">
                              <span className="truncate">{sub.name}</span>
                              <span className="ml-2 text-xs text-muted-foreground">
                                /{sub.slug}
                              </span>
                            </div>
                            <div className="flex gap-1">
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => setEditingCat(sub)}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => {
                                  if (confirm("Delete?")) delCat.mutate(sub.id);
                                }}
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 space-y-2">
            <div className="text-sm font-semibold">Brands</div>
            {brands.isLoading ? (
              <div className="h-24 animate-pulse rounded-lg bg-muted" />
            ) : (brands.data ?? []).length === 0 ? (
              <div className="text-sm text-muted-foreground py-6 text-center">No brands yet</div>
            ) : (
              <ul className="space-y-1">
                {(brands.data ?? []).map((b) => (
                  <li
                    key={b.id}
                    className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-muted"
                  >
                    <div className="min-w-0">
                      <span className="truncate font-medium">{b.name}</span>
                      {!b.is_active && (
                        <Badge variant="outline" className="ml-2 text-[10px]">
                          Inactive
                        </Badge>
                      )}
                    </div>
                    <div className="flex gap-1">
                      <Button size="icon" variant="ghost" onClick={() => setEditingBrand(b)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => {
                          if (confirm("Delete brand?"))
                            delBrand.mutate(b.id, { onSuccess: () => toast.success("Deleted") });
                        }}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Category dialog */}
      <Dialog
        open={!!editingCat}
        onOpenChange={(o) => {
          if (!o) setEditingCat(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingCat?.id ? "Edit category" : "New category"}</DialogTitle>
            <DialogDescription>Categories organize your storefront.</DialogDescription>
          </DialogHeader>
          {editingCat && (
            <div className="grid gap-3">
              <div>
                <Label>Name</Label>
                <Input
                  value={editingCat.name || ""}
                  onChange={(e) =>
                    setEditingCat({
                      ...editingCat,
                      name: e.target.value,
                      slug: editingCat.slug || slugify(e.target.value),
                    })
                  }
                />
              </div>
              <div>
                <Label>Slug</Label>
                <Input
                  value={editingCat.slug || ""}
                  onChange={(e) => setEditingCat({ ...editingCat, slug: slugify(e.target.value) })}
                />
              </div>
              <div>
                <Label>Sort order</Label>
                <Input
                  type="number"
                  value={editingCat.sort_order ?? 0}
                  onChange={(e) =>
                    setEditingCat({ ...editingCat, sort_order: Number(e.target.value) })
                  }
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  id="ca"
                  type="checkbox"
                  checked={editingCat.is_active ?? true}
                  onChange={(e) => setEditingCat({ ...editingCat, is_active: e.target.checked })}
                />
                <Label htmlFor="ca">Active</Label>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingCat(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!editingCat?.name || !editingCat.slug) return;
                upsertCat.mutate(editingCat as any, {
                  onSuccess: () => {
                    toast.success("Saved");
                    setEditingCat(null);
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

      {/* Brand dialog */}
      <Dialog
        open={!!editingBrand}
        onOpenChange={(o) => {
          if (!o) setEditingBrand(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingBrand?.id ? "Edit brand" : "New brand"}</DialogTitle>
          </DialogHeader>
          {editingBrand && (
            <div className="grid gap-3">
              <div>
                <Label>Name</Label>
                <Input
                  value={editingBrand.name || ""}
                  onChange={(e) =>
                    setEditingBrand({
                      ...editingBrand,
                      name: e.target.value,
                      slug: editingBrand.slug || slugify(e.target.value),
                    })
                  }
                />
              </div>
              <div>
                <Label>Slug</Label>
                <Input
                  value={editingBrand.slug || ""}
                  onChange={(e) =>
                    setEditingBrand({ ...editingBrand, slug: slugify(e.target.value) })
                  }
                />
              </div>
              <div>
                <Label>Logo URL</Label>
                <Input
                  value={editingBrand.logo_url || ""}
                  onChange={(e) => setEditingBrand({ ...editingBrand, logo_url: e.target.value })}
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  id="ba"
                  type="checkbox"
                  checked={editingBrand.is_active ?? true}
                  onChange={(e) =>
                    setEditingBrand({ ...editingBrand, is_active: e.target.checked })
                  }
                />
                <Label htmlFor="ba">Active</Label>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingBrand(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!editingBrand?.name || !editingBrand.slug) return;
                upsertBrand.mutate(editingBrand as any, {
                  onSuccess: () => {
                    toast.success("Saved");
                    setEditingBrand(null);
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
