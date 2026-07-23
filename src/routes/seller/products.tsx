import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { FileUp, ImageIcon, Loader2, Package, Pencil, Plus, Search, Trash2, Upload, X } from "lucide-react";
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
      toast.success(`Imported ${r.inserted} product${r.inserted === 1 ? "" : "s"} — sent for approval`);
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
      case "name_asc": sorted.sort((a, b) => a.name.localeCompare(b.name)); break;
      case "name_desc": sorted.sort((a, b) => b.name.localeCompare(a.name)); break;
      case "price_asc": sorted.sort((a, b) => a.price - b.price); break;
      case "price_desc": sorted.sort((a, b) => b.price - a.price); break;
      case "stock_asc": sorted.sort((a, b) => a.stock - b.stock); break;
      case "stock_desc": sorted.sort((a, b) => b.stock - a.stock); break;
      case "updated_asc":
        sorted.sort((a, b) => +new Date(a.updatedAt) - +new Date(b.updatedAt)); break;
      case "updated_desc":
      default:
        sorted.sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));
    }
    return sorted;
  }, [products, query, statusFilter, categoryFilter, sortBy]);

  const filtersActive =
    query.trim() !== "" || statusFilter !== "all" || categoryFilter !== "all" || sortBy !== "updated_desc";

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
              <SelectTrigger className="w-[180px]"><SelectValue placeholder="Category" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[170px]"><SelectValue /></SelectTrigger>
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
              <SelectTrigger className="w-[190px]"><SelectValue /></SelectTrigger>
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
                  setQuery(""); setStatusFilter("all"); setCategoryFilter("all"); setSortBy("updated_desc");
                }}
              >Clear</Button>
            )}
          </div>
          <div className="text-xs text-muted-foreground">
            Showing {filtered.length} of {products.length}
          </div>

          {productsQ.isLoading ? (
            <div className="space-y-2 py-4">
              {[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-full" />)}
            </div>
          ) : productsQ.isError ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
              Failed to load products. <button className="underline" onClick={() => productsQ.refetch()}>Retry</button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <div className="grid h-14 w-14 place-items-center rounded-2xl bg-primary/10 text-primary">
                <Package className="h-6 w-6" />
              </div>
              <div>
                <div className="font-medium">No products {products.length > 0 ? "match" : "yet"}</div>
                <p className="text-sm text-muted-foreground">
                  {products.length > 0 ? "Try clearing filters, or add another product." : "Add your first product to start selling."}
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
                        <TableCell><ProductThumb src={p.imageUrl ?? undefined} alt={p.name} /></TableCell>
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
                          <span className={low ? "text-destructive font-medium" : ""}>{p.stock}</span>
                        </TableCell>
                        <TableCell><Badge className={meta.className}>{meta.label}</Badge></TableCell>
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
            >Delete</AlertDialogAction>
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

  function set<K extends keyof ProductFormData>(k: K, v: ProductFormData[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function submit() {
    if (!form.name.trim()) return toast.error("Product name is required");
    if (!form.sku.trim()) return toast.error("SKU is required");
    if (form.price <= 0) return toast.error("Price must be greater than 0");
    if (form.mrp < form.price) return toast.error("MRP cannot be lower than price");
    if (!form.category) return toast.error("Choose a category");
    void onSubmit(form);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
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
              <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-2">
            <Label>Product image</Label>
            <ImagePicker value={form.imageUrl} onChange={(v) => set("imageUrl", v)} />
          </div>
          <div>
            <Label>MRP (₹)</Label>
            <Input type="number" min={0} value={form.mrp}
              onChange={(e) => set("mrp", Number(e.target.value))} />
          </div>
          <div>
            <Label>Selling price (₹)</Label>
            <Input type="number" min={0} value={form.price}
              onChange={(e) => set("price", Number(e.target.value))} />
          </div>
          <div>
            <Label>Stock</Label>
            <Input type="number" min={0} value={form.stock}
              onChange={(e) => set("stock", Number(e.target.value))} />
          </div>
          <div>
            <Label>Low-stock alert at</Label>
            <Input type="number" min={0} value={form.lowStockAt}
              onChange={(e) => set("lowStockAt", Number(e.target.value))} />
          </div>
          <div className="sm:col-span-2">
            <Label>Description</Label>
            <Textarea rows={3} value={form.description}
              onChange={(e) => set("description", e.target.value)} />
          </div>
        </div>

        <DialogFooter>
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
    name: "", sku: "", category: "", brand: "", description: "",
    mrp: 0, price: 0, stock: 0, lowStockAt: 5, imageUrl: "",
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
      onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
    />
  );
}

/**
 * Uploads to the private `product-images` Supabase bucket under
 * `${userId}/${uuid}.${ext}`, stores the storage path in `value`, and shows
 * a signed URL preview.
 */
function ImagePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<string>("");

  // Resolve current value to a preview URL.
  useEffect(() => {
    let cancelled = false;
    async function resolve() {
      if (!value) { setPreview(""); return; }
      if (/^(https?:|data:)/i.test(value)) { setPreview(value); return; }
      const { data } = await supabase.storage
        .from("product-images")
        .createSignedUrl(value, 60 * 60);
      if (!cancelled) setPreview(data?.signedUrl ?? "");
    }
    void resolve();
    return () => { cancelled = true; };
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
            <img src={preview} alt="Product preview" className="h-24 w-24 rounded-md border object-cover" />
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
              type="button" variant="outline" size="sm"
              onClick={() => inputRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {uploading ? "Uploading…" : "Upload image"}
            </Button>
          </div>
          <input
            ref={inputRef} type="file" accept="image/*" className="hidden"
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
