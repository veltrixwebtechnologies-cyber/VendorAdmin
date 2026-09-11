import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  FileUp,
  ImageIcon,
  Loader2,
  Package,
  Pencil,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { ProductsCsvImport } from "@/components/products-csv-import";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";

import { CATEGORIES } from "@/lib/catalog-store";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import {
  bulkCreateProductsFn,
  createProductFn,
  deleteProductFn,
  listProducts,
  updateProductFn,
  type ProductDto,
} from "@/lib/products.functions";

export const Route = createFileRoute("/seller/products")({
  head: () => ({
    meta: [
      { title: "Products — Seller Hub" },
      { name: "description", content: "Manage your product catalog." },
      { property: "og:title", content: "Products — Seller Hub" },
      { property: "og:description", content: "Manage your product catalog." },
    ],
  }),
  component: ProductsPage,
});

const STATUS_META: Record<string, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-muted text-muted-foreground" },
  pending: { label: "Pending", className: "bg-accent text-accent-foreground" },
  active: { label: "Active", className: "bg-success text-success-foreground" },
  approved: { label: "Approved", className: "bg-success text-success-foreground" },
  rejected: { label: "Rejected", className: "bg-destructive text-destructive-foreground" },
  inactive: { label: "Inactive", className: "bg-muted text-muted-foreground" },
};

type SortKey =
  | "updated_desc"
  | "updated_asc"
  | "name_asc"
  | "name_desc"
  | "price_asc"
  | "price_desc"
  | "stock_asc"
  | "stock_desc";

function ProductsPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const list = useServerFn(listProducts);
  const create = useServerFn(createProductFn);
  const update = useServerFn(updateProductFn);
  const del = useServerFn(deleteProductFn);
  const bulk = useServerFn(bulkCreateProductsFn);

  const productsQ = useQuery<ProductDto[]>({
    queryKey: ["products", user?.id],
    queryFn: () => list() as Promise<ProductDto[]>,
    enabled: !!user,
  });

  const products: ProductDto[] = productsQ.data ?? [];

  const createMut = useMutation({
    mutationFn: (data: ProductFormData) => create({ data: normalize(data) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["products"] });
      toast.success("Product created and sent for approval");
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to create product"),
  });

  const updateMut = useMutation({
    mutationFn: (v: { id: string; data: ProductFormData }) =>
      update({ data: { id: v.id, patch: normalize(v.data) } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["products"] });
      toast.success("Product updated");
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to update product"),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => del({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["products"] });
      toast.success("Product deleted");
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to delete product"),
  });

  const bulkMut = useMutation({
    mutationFn: (rows: Array<Partial<ProductFormData> & Omit<ProductFormData, "imageUrl">>) =>
      bulk({ data: { rows: rows.map((r) => normalize({ ...blank(), ...r })) } }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["products"] });
      toast.success(
        `Imported ${r.inserted} product${r.inserted === 1 ? "" : "s"} — sent for approval`,
      );
    },
    onError: (e: any) => toast.error(e?.message ?? "Import failed"),
  });

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<SortKey>("updated_desc");
  const [editing, setEditing] = useState<ProductDto | null>(null);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ProductDto | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = products.filter((p) => {
      const matchesQ =
        !q ||
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        p.brand.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q);
      const matchesS = statusFilter === "all" || p.status === statusFilter;
      const matchesC = categoryFilter === "all" || p.category === categoryFilter;
      return matchesQ && matchesS && matchesC;
    });
    const sorted = [...list];
    switch (sortBy) {
      case "name_asc":
        sorted.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case "name_desc":
        sorted.sort((a, b) => b.name.localeCompare(a.name));
        break;
      case "price_asc":
        sorted.sort((a, b) => a.price - b.price);
        break;
      case "price_desc":
        sorted.sort((a, b) => b.price - a.price);
        break;
      case "stock_asc":
        sorted.sort((a, b) => a.stock - b.stock);
        break;
      case "stock_desc":
        sorted.sort((a, b) => b.stock - a.stock);
        break;
      case "updated_asc":
        sorted.sort((a, b) => +new Date(a.updatedAt) - +new Date(b.updatedAt));
        break;
      case "updated_desc":
      default:
        sorted.sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));
    }
    return sorted;
  }, [products, query, statusFilter, categoryFilter, sortBy]);

  const filtersActive =
    query.trim() !== "" ||
    statusFilter !== "all" ||
    categoryFilter !== "all" ||
    sortBy !== "updated_desc";

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Products</h1>
          <p className="text-sm text-muted-foreground">
            {products.length} total • {products.filter((p) => p.status === "active").length} active
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setImporting(true)}>
            <FileUp className="h-4 w-4" /> Bulk import CSV
          </Button>
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> Add product
          </Button>
        </div>
      </div>

      <ProductsCsvImport
        open={importing}
        onOpenChange={setImporting}
        onImport={async (rows) => {
          await bulkMut.mutateAsync(rows);
        }}
      />

      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search by name, SKU, brand or category"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[170px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="pending">Pending approval</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortKey)}>
              <SelectTrigger className="w-[190px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="updated_desc">Recently updated</SelectItem>
                <SelectItem value="updated_asc">Oldest updated</SelectItem>
                <SelectItem value="name_asc">Name (A–Z)</SelectItem>
                <SelectItem value="name_desc">Name (Z–A)</SelectItem>
                <SelectItem value="price_asc">Price (low → high)</SelectItem>
                <SelectItem value="price_desc">Price (high → low)</SelectItem>
                <SelectItem value="stock_asc">Stock (low → high)</SelectItem>
                <SelectItem value="stock_desc">Stock (high → low)</SelectItem>
              </SelectContent>
            </Select>
            {filtersActive && (
              <Button
                variant="ghost"
                onClick={() => {
                  setQuery("");
                  setStatusFilter("all");
                  setCategoryFilter("all");
                  setSortBy("updated_desc");
                }}
              >
                Clear
              </Button>
            )}
          </div>
          <div className="text-xs text-muted-foreground">
            Showing {filtered.length} of {products.length}
          </div>

          {productsQ.isLoading ? (
            <div className="space-y-2 py-4">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : productsQ.isError ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
              Failed to load products.{" "}
              <button className="underline" onClick={() => productsQ.refetch()}>
                Retry
              </button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <div className="grid h-14 w-14 place-items-center rounded-2xl bg-primary/10 text-primary">
                <Package className="h-6 w-6" />
              </div>
              <div>
                <div className="font-medium">
                  No products {products.length > 0 ? "match" : "yet"}
                </div>
                <p className="text-sm text-muted-foreground">
                  {products.length > 0
                    ? "Try clearing filters, or add another product."
                    : "Add your first product to start selling."}
                </p>
              </div>
              <Button onClick={() => setCreating(true)}>
                <Plus className="h-4 w-4" /> Add product
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">Image</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">Price</TableHead>
                    <TableHead className="text-right">Stock</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((p) => {
                    const meta = STATUS_META[p.status] ?? STATUS_META.pending;
                    const low = p.stock <= p.lowStockAt;
                    return (
                      <TableRow key={p.id} className="animate-fade-in">
                        <TableCell>
                          <ProductThumb src={p.imageUrl ?? undefined} alt={p.name} />
                        </TableCell>
                        <TableCell>
                          <div className="font-medium">{p.name}</div>
                          <div className="text-xs text-muted-foreground">{p.brand}</div>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{p.sku}</TableCell>
                        <TableCell>{p.category}</TableCell>
                        <TableCell className="text-right">
                          <div className="font-medium">₹{p.price.toLocaleString("en-IN")}</div>
                          {p.mrp > p.price && (
                            <div className="text-xs text-muted-foreground line-through">
                              ₹{p.mrp.toLocaleString("en-IN")}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <span className={low ? "text-destructive font-medium" : ""}>
                            {p.stock}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Badge className={meta.className}>{meta.label}</Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button variant="ghost" size="icon" onClick={() => setEditing(p)}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => setPendingDelete(p)}>
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <ProductFormDialog
        open={creating}
        onOpenChange={setCreating}
        busy={createMut.isPending}
        onSubmit={async (data) => {
          await createMut.mutateAsync(data);
          setCreating(false);
        }}
      />

      <ProductFormDialog
        open={!!editing}
        initial={editing ?? undefined}
        busy={updateMut.isPending}
        onOpenChange={(o) => !o && setEditing(null)}
        onSubmit={async (data) => {
          if (!editing) return;
          await updateMut.mutateAsync({ id: editing.id, data });
          setEditing(null);
        }}
      />

      <AlertDialog open={!!pendingDelete} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this product?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete?.name} will be permanently removed from your catalog.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (pendingDelete) {
                  await deleteMut.mutateAsync(pendingDelete.id);
                  setPendingDelete(null);
                }
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

type ProductFormData = {
  name: string;
  sku: string;
  category: string;
  brand: string;
  description: string;
  mrp: number;
  price: number;
  stock: number;
  lowStockAt: number;
  imageUrl: string;
  attributes?: Record<string, any>;
};

function normalize(f: ProductFormData) {
  return { ...f, imageUrl: f.imageUrl || null };
}

function ProductFormDialog({
  open,
  onOpenChange,
  onSubmit,
  initial,
  busy,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: ProductFormData) => void | Promise<void>;
  initial?: ProductDto;
  busy?: boolean;
}) {
  const [form, setForm] = useState<ProductFormData>(blank());

  useEffect(() => {
    if (open) setForm(initial ? extract(initial) : blank());
  }, [open, initial]);

  const applicableDefsQ = useQuery({
    queryKey: ["seller-applicable-defs", form.category],
    enabled: !!form.category,
    queryFn: async () => {
      try {
        const { data, error } = await (supabase as any).rpc("get_applicable_filters", {
          p_category_slug: form.category.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        });
        if (!error && Array.isArray(data) && data.length > 0) {
          return data;
        }
      } catch (e) {
        // Fallback to local taxonomy definitions below
      }
      return getFallbackFilterDefs(form.category);
    },
  });

  const filterDefs = applicableDefsQ.data ?? [];

  function set<K extends keyof ProductFormData>(k: K, v: ProductFormData[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function setAttributeValue(key: string, val: any) {
    setForm((f) => ({
      ...f,
      attributes: {
        ...f.attributes,
        [key]: val,
      },
    }));
  }

  function submit() {
    if (!form.name.trim()) return toast.error("Product name is required");
    if (!form.sku.trim()) return toast.error("SKU is required");
    if (form.price <= 0) return toast.error("Price must be greater than 0");
    if (form.mrp < form.price) return toast.error("MRP cannot be lower than price");
    if (!form.category) return toast.error("Choose a category");
    if (!form.description.trim()) return toast.error("Product description is required");

    // Validate required & normalize filter definitions
    const normalizedAttributes: Record<string, any> = { ...(form.attributes || {}) };

    for (const def of filterDefs) {
      const val = normalizedAttributes[def.key];

      if (def.is_required) {
        if (
          val === undefined ||
          val === null ||
          (Array.isArray(val) && val.length === 0) ||
          (typeof val === "string" && !val.trim())
        ) {
          return toast.error(`Attribute "${def.label}" is required for this product type`);
        }
      }

      // Strict numeric attribute normalization (convert "6.7" -> 6.7 JSON number)
      if (def.type === "number" || def.type === "range") {
        if (val !== undefined && val !== null && val !== "") {
          const strVal = String(val).trim();
          if (strVal !== "") {
            const numVal = Number(strVal);
            if (isNaN(numVal) || !/^-?\d+(\.\d+)?$/.test(strVal)) {
              return toast.error(`Attribute "${def.label}" must be a valid number`);
            }
            normalizedAttributes[def.key] = numVal;
          } else {
            delete normalizedAttributes[def.key];
          }
        } else {
          delete normalizedAttributes[def.key];
        }
      }
    }

    void onSubmit({ ...form, attributes: normalizedAttributes });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit product" : "Add new product"}</DialogTitle>
          <DialogDescription>
            {initial
              ? "Update product details. Changes are saved immediately."
              : "New products are submitted for admin approval before going live."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label>Product name</Label>
            <Input value={form.name} onChange={(e) => set("name", e.target.value)} />
          </div>
          <div>
            <Label>SKU</Label>
            <Input value={form.sku} onChange={(e) => set("sku", e.target.value.toUpperCase())} />
          </div>
          <div>
            <Label>Brand</Label>
            <Input value={form.brand} onChange={(e) => set("brand", e.target.value)} />
          </div>
          <div>
            <Label>Category</Label>
            <Select value={form.category} onValueChange={(v) => set("category", v)}>
              <SelectTrigger>
                <SelectValue placeholder="Select category" />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-2">
            <Label>Product image</Label>
            <ImagePicker value={form.imageUrl} onChange={(v) => set("imageUrl", v)} />
          </div>
          <div>
            <Label>MRP (₹)</Label>
            <Input
              type="number"
              min={0}
              value={form.mrp}
              onChange={(e) => set("mrp", Number(e.target.value))}
            />
          </div>
          <div>
            <Label>Selling price (₹)</Label>
            <Input
              type="number"
              min={0}
              value={form.price}
              onChange={(e) => set("price", Number(e.target.value))}
            />
          </div>
          <div>
            <Label>Stock</Label>
            <Input
              type="number"
              min={0}
              value={form.stock}
              onChange={(e) => set("stock", Number(e.target.value))}
            />
          </div>
          <div>
            <Label>Low-stock alert at</Label>
            <Input
              type="number"
              min={0}
              value={form.lowStockAt}
              onChange={(e) => set("lowStockAt", Number(e.target.value))}
            />
          </div>
          <div className="sm:col-span-2">
            <Label>
              Description <span className="text-destructive">*</span>
            </Label>
            <Textarea
              rows={3}
              placeholder="Provide a detailed description of the product..."
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
            />
          </div>

          {/* Dynamic Attribute Fields based on filter_definitions */}
          {filterDefs.length > 0 && (
            <div className="sm:col-span-2 space-y-4 border-t pt-4 mt-2">
              <h4 className="text-sm font-bold text-foreground">
                Category Attributes & Specifications
              </h4>
              <div className="grid gap-4 sm:grid-cols-2">
                {filterDefs.map((def: any) => {
                  if (def.key === "brand" || def.key === "price" || def.key === "rating") return null;

                  const val = form.attributes[def.key];
                  const options = def.options || [];

                  return (
                    <div key={def.id} className="space-y-1.5">
                      <Label className="text-xs font-semibold flex items-center justify-between">
                        <span>
                          {def.label} {def.unit ? `(${def.unit})` : ""}
                        </span>
                        {def.is_required && (
                          <span className="text-[10px] text-destructive font-bold">Required</span>
                        )}
                      </Label>

                      {def.type === "multi_select" || def.type === "color" ? (
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          {options.map((opt: any) => {
                            const selected = Array.isArray(val) && val.includes(opt.value);
                            return (
                              <button
                                key={opt.id}
                                type="button"
                                onClick={() => {
                                  const current = Array.isArray(val) ? val : [];
                                  const next = selected
                                    ? current.filter((v: string) => v !== opt.value)
                                    : [...current, opt.value];
                                  setAttributeValue(def.key, next);
                                }}
                                className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
                                  selected
                                    ? "bg-primary text-primary-foreground border-primary"
                                    : "bg-muted text-muted-foreground border-border hover:bg-muted/80"
                                }`}
                              >
                                {opt.label}
                              </button>
                            );
                          })}
                        </div>
                      ) : def.type === "single_select" ? (
                        <Select
                          value={typeof val === "string" ? val : ""}
                          onValueChange={(v) => setAttributeValue(def.key, v)}
                        >
                          <SelectTrigger className="h-9 text-xs">
                            <SelectValue placeholder={`Select ${def.label}`} />
                          </SelectTrigger>
                          <SelectContent>
                            {options.map((opt: any) => (
                              <SelectItem key={opt.id} value={opt.value} className="text-xs">
                                {opt.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Input
                          type={def.type === "number" || def.type === "range" ? "number" : "text"}
                          step={def.type === "number" || def.type === "range" ? "any" : undefined}
                          value={val !== undefined && val !== null ? (typeof val === "string" ? val : Array.isArray(val) ? val.join(", ") : String(val)) : ""}
                          onChange={(e) => setAttributeValue(def.key, e.target.value)}
                          placeholder={`Enter ${def.label}`}
                          className="h-9 text-xs"
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {initial ? "Save changes" : "Create product"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function blank(): ProductFormData {
  return {
    name: "",
    sku: "",
    category: "",
    brand: "",
    description: "",
    mrp: 0,
    price: 0,
    stock: 0,
    lowStockAt: 5,
    imageUrl: "",
    attributes: {},
  };
}

function extract(p: ProductDto): ProductFormData {
  return {
    name: p.name,
    sku: p.sku,
    category: p.category,
    brand: p.brand,
    description: p.description,
    mrp: p.mrp,
    price: p.price,
    stock: p.stock,
    lowStockAt: p.lowStockAt,
    imageUrl: p.imagePath ?? "",
    attributes: p.attributes || {},
  };
}

function ProductThumb({ src, alt }: { src?: string; alt: string }) {
  if (!src) {
    return (
      <div className="grid h-12 w-12 place-items-center rounded-md border bg-muted text-muted-foreground">
        <ImageIcon className="h-5 w-5" />
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      className="h-12 w-12 rounded-md border object-cover"
      onError={(e) => {
        (e.currentTarget as HTMLImageElement).style.display = "none";
      }}
    />
  );
}

function ImagePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    async function resolve() {
      if (!value) {
        setPreview("");
        return;
      }
      if (/^(https?:|data:)/i.test(value)) {
        setPreview(value);
        return;
      }
      const { data } = await supabase.storage
        .from("product-images")
        .createSignedUrl(value, 60 * 60);
      if (!cancelled) setPreview(data?.signedUrl ?? "");
    }
    void resolve();
    return () => {
      cancelled = true;
    };
  }, [value]);

  async function handleFile(file: File) {
    if (!file.type.startsWith("image/")) return toast.error("Please choose an image file");
    if (file.size > 5 * 1024 * 1024) return toast.error("Image must be under 5 MB");
    setUploading(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const userId = auth.user?.id;
      if (!userId) throw new Error("Not signed in");
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
      const key = `${userId}/${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage.from("product-images").upload(key, file, {
        cacheControl: "3600",
        upsert: false,
        contentType: file.type,
      });
      if (error) throw error;
      onChange(key);
      toast.success("Image uploaded");
    } catch (e: any) {
      toast.error(e?.message ?? "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-start gap-3">
        {preview ? (
          <div className="relative">
            <img
              src={preview}
              alt="Product preview"
              className="h-24 w-24 rounded-md border object-cover"
            />
            <button
              type="button"
              onClick={() => onChange("")}
              className="absolute -right-2 -top-2 grid h-6 w-6 place-items-center rounded-full border bg-background text-muted-foreground shadow-sm hover:text-destructive"
              aria-label="Remove image"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <div className="grid h-24 w-24 place-items-center rounded-md border border-dashed bg-muted text-muted-foreground">
            <ImageIcon className="h-6 w-6" />
          </div>
        )}
        <div className="flex flex-1 flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => inputRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              {uploading ? "Uploading…" : "Upload image"}
            </Button>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
              e.target.value = "";
            }}
          />
          <p className="text-xs text-muted-foreground">
            PNG, JPG or WEBP up to 5 MB. Stored securely and shown on your storefront.
          </p>
        </div>
      </div>
    </div>
  );
}

function getFallbackFilterDefs(category: string) {
  const cat = (category || "").toLowerCase();

  if (cat.includes("fashion") || cat.includes("boutique") || cat.includes("clothing")) {
    return [
      {
        id: "f_size",
        key: "size",
        label: "Size",
        type: "multi_select",
        options: [
          { id: "s1", label: "XS", value: "XS" },
          { id: "s2", label: "S", value: "S" },
          { id: "s3", label: "M", value: "M" },
          { id: "s4", label: "L", value: "L" },
          { id: "s5", label: "XL", value: "XL" },
          { id: "s6", label: "XXL", value: "XXL" },
          { id: "s7", label: "3XL", value: "3XL" },
        ],
      },
      {
        id: "f_color",
        key: "color",
        label: "Color",
        type: "multi_select",
        options: [
          { id: "c1", label: "Black", value: "Black" },
          { id: "c2", label: "White", value: "White" },
          { id: "c3", label: "Blue", value: "Blue" },
          { id: "c4", label: "Red", value: "Red" },
          { id: "c5", label: "Green", value: "Green" },
          { id: "c6", label: "Yellow", value: "Yellow" },
          { id: "c7", label: "Pink", value: "Pink" },
          { id: "c8", label: "Beige", value: "Beige" },
        ],
      },
      {
        id: "f_fabric",
        key: "fabric",
        label: "Fabric / Material",
        type: "multi_select",
        options: [
          { id: "fb1", label: "Cotton", value: "Cotton" },
          { id: "fb2", label: "Linen", value: "Linen" },
          { id: "fb3", label: "Silk", value: "Silk" },
          { id: "fb4", label: "Denim", value: "Denim" },
          { id: "fb5", label: "Polyester", value: "Polyester" },
          { id: "fb6", label: "Rayon", value: "Rayon" },
        ],
      },
      {
        id: "f_fit",
        key: "fit",
        label: "Fit",
        type: "single_select",
        options: [
          { id: "fit1", label: "Regular Fit", value: "Regular" },
          { id: "fit2", label: "Slim Fit", value: "Slim" },
          { id: "fit3", label: "Oversized", value: "Oversized" },
          { id: "fit4", label: "Relaxed Fit", value: "Relaxed" },
        ],
      },
    ];
  }

  if (cat.includes("footwear")) {
    return [
      {
        id: "fw_size",
        key: "shoe_size",
        label: "Shoe Size (UK)",
        type: "multi_select",
        options: [
          { id: "fs1", label: "UK 6", value: "UK 6" },
          { id: "fs2", label: "UK 7", value: "UK 7" },
          { id: "fs3", label: "UK 8", value: "UK 8" },
          { id: "fs4", label: "UK 9", value: "UK 9" },
          { id: "fs5", label: "UK 10", value: "UK 10" },
          { id: "fs6", label: "UK 11", value: "UK 11" },
        ],
      },
      {
        id: "fw_color",
        key: "color",
        label: "Color",
        type: "multi_select",
        options: [
          { id: "fc1", label: "Black", value: "Black" },
          { id: "fc2", label: "White", value: "White" },
          { id: "fc3", label: "Brown", value: "Brown" },
          { id: "fc4", label: "Tan", value: "Tan" },
          { id: "fc5", label: "Grey", value: "Grey" },
        ],
      },
    ];
  }

  if (cat.includes("electronic") || cat.includes("mobile")) {
    return [
      {
        id: "el_ram",
        key: "ram",
        label: "RAM",
        type: "multi_select",
        options: [
          { id: "r1", label: "4 GB", value: "4 GB" },
          { id: "r2", label: "6 GB", value: "6 GB" },
          { id: "r3", label: "8 GB", value: "8 GB" },
          { id: "r4", label: "12 GB", value: "12 GB" },
          { id: "r5", label: "16 GB", value: "16 GB" },
        ],
      },
      {
        id: "el_storage",
        key: "storage",
        label: "Internal Storage",
        type: "multi_select",
        options: [
          { id: "st1", label: "64 GB", value: "64 GB" },
          { id: "st2", label: "128 GB", value: "128 GB" },
          { id: "st3", label: "256 GB", value: "256 GB" },
          { id: "st4", label: "512 GB", value: "512 GB" },
          { id: "st5", label: "1 TB", value: "1 TB" },
        ],
      },
      {
        id: "el_os",
        key: "os",
        label: "Operating System",
        type: "single_select",
        options: [
          { id: "os1", label: "Android", value: "Android" },
          { id: "os2", label: "iOS", value: "iOS" },
          { id: "os3", label: "Windows", value: "Windows" },
        ],
      },
    ];
  }

  if (cat.includes("kirana") || cat.includes("grocery") || cat.includes("supermarket")) {
    return [
      {
        id: "gr_dietary",
        key: "dietary",
        label: "Dietary & Prep",
        type: "multi_select",
        options: [
          { id: "d1", label: "Vegetarian", value: "veg" },
          { id: "d2", label: "Vegan", value: "vegan" },
          { id: "d3", label: "Organic", value: "organic" },
          { id: "d4", label: "Sugar-Free", value: "sugar_free" },
          { id: "d5", label: "Gluten-Free", value: "gluten_free" },
        ],
      },
      {
        id: "gr_pack",
        key: "pack_size",
        label: "Pack Size / Weight",
        type: "single_select",
        options: [
          { id: "ps1", label: "250g", value: "250g" },
          { id: "ps2", label: "500g", value: "500g" },
          { id: "ps3", label: "1 kg", value: "1kg" },
          { id: "ps4", label: "5 kg", value: "5kg" },
          { id: "ps5", label: "10 kg", value: "10kg" },
        ],
      },
    ];
  }

  if (cat.includes("meat") || cat.includes("fish")) {
    return [
      {
        id: "mf_cut",
        key: "cut_type",
        label: "Cut & Cleaning Option",
        type: "multi_select",
        options: [
          { id: "ct1", label: "Curry Cut", value: "curry_cut" },
          { id: "ct2", label: "Biryani Cut", value: "biryani_cut" },
          { id: "ct3", label: "Boneless", value: "boneless" },
          { id: "ct4", label: "Skinless", value: "skinless" },
          { id: "ct5", label: "Fillet", value: "fillet" },
          { id: "ct6", label: "Whole Cleaned", value: "whole_cleaned" },
        ],
      },
      {
        id: "mf_freshness",
        key: "freshness",
        label: "Freshness State",
        type: "single_select",
        options: [
          { id: "fr1", label: "Fresh Catch Daily", value: "fresh" },
          { id: "fr2", label: "Frozen / Chilled", value: "frozen" },
        ],
      },
    ];
  }

  if (cat.includes("bakery") || cat.includes("sweet")) {
    return [
      {
        id: "bk_egg",
        key: "dietary_egg",
        label: "Egg / Eggless",
        type: "single_select",
        options: [
          { id: "eg1", label: "Eggless (100% Veg)", value: "eggless" },
          { id: "eg2", label: "Contains Egg", value: "egg" },
        ],
      },
      {
        id: "bk_flavor",
        key: "cake_flavor",
        label: "Flavor",
        type: "multi_select",
        options: [
          { id: "fl1", label: "Chocolate / Truffle", value: "chocolate" },
          { id: "fl2", label: "Black Forest", value: "black_forest" },
          { id: "fl3", label: "Butterscotch", value: "butterscotch" },
          { id: "fl4", label: "Red Velvet", value: "red_velvet" },
          { id: "fl5", label: "Vanilla", value: "vanilla" },
        ],
      },
    ];
  }

  return [];
}
