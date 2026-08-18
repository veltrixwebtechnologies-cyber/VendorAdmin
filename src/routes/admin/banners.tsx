import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Plus, Pencil, Trash2, Upload, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { useBanners, useUpsertBanner, useDeleteBanner, type Banner } from "@/lib/admin-db";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/banners")({
  head: () => ({ meta: [{ title: "Banners — Admin" }, { name: "robots", content: "noindex" }] }),
  component: BannersPage,
});

function resolveBannerImage(imageUrl: string) {
  if (/^(https?:|data:|blob:)/i.test(imageUrl) || imageUrl.startsWith("/")) return imageUrl;
  return supabase.storage.from("banner-images").getPublicUrl(imageUrl).data.publicUrl;
}

function BannersPage() {
  const q = useBanners();
  const upsert = useUpsertBanner();
  const del = useDeleteBanner();
  const [editing, setEditing] = useState<Partial<Banner> | null>(null);
  const [uploading, setUploading] = useState(false);

  const uploadImage = async (file: File) => {
    setUploading(true);
    try {
      const path = `${crypto.randomUUID()}-${file.name}`;
      const { error } = await supabase.storage
        .from("banner-images")
        .upload(path, file, { upsert: false });
      if (error) throw error;
      setEditing((e) => (e ? { ...e, image_url: path } : e));
      toast.success("Uploaded");
    } catch (e: any) {
      toast.error(e.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-black tracking-tight sm:text-3xl">Banners</h1>
          <p className="text-sm text-muted-foreground">Homepage hero, promo, and featured slots.</p>
        </div>
        <Button
          onClick={() =>
            setEditing({
              title: "",
              image_url: "",
              placement: "hero",
              sort_order: 0,
              is_active: true,
            })
          }
          className="gap-1"
        >
          <Plus className="h-4 w-4" />
          New banner
        </Button>
      </div>
      {q.isLoading ? (
        <div className="h-24 animate-pulse rounded-xl bg-muted" />
      ) : (q.data ?? []).length === 0 ? (
        <Card>
          <CardContent className="grid place-items-center py-16 text-sm text-muted-foreground">
            No banners yet.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 stagger">
          {(q.data ?? []).map((b) => (
            <Card key={b.id} className="overflow-hidden hover-lift">
              <img
                src={resolveBannerImage(b.image_url)}
                alt={b.title}
                className="h-32 w-full object-cover"
              />
              <CardContent className="p-3 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="truncate font-semibold">{b.title}</div>
                  <Badge variant="outline" className="text-[10px] capitalize">
                    {b.placement.replace("_", " ")}
                  </Badge>
                  {!b.is_active && <Badge variant="secondary">Inactive</Badge>}
                </div>
                {b.subtitle && (
                  <p className="line-clamp-2 text-xs text-muted-foreground">{b.subtitle}</p>
                )}
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setEditing(b)}
                    className="gap-1"
                  >
                    <Pencil className="h-3 w-3" />
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      if (confirm("Delete banner?"))
                        del.mutate(b.id, { onSuccess: () => toast.success("Deleted") });
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
            <DialogTitle>{editing?.id ? "Edit banner" : "New banner"}</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="grid gap-3">
              <div>
                <Label>Title</Label>
                <Input
                  value={editing.title || ""}
                  onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                />
              </div>
              <div>
                <Label>Subtitle</Label>
                <Input
                  value={editing.subtitle || ""}
                  onChange={(e) => setEditing({ ...editing, subtitle: e.target.value })}
                />
              </div>
              <div>
                <Label>Image</Label>
                <div className="flex items-center gap-2">
                  <Input
                    value={editing.image_url || ""}
                    onChange={(e) => setEditing({ ...editing, image_url: e.target.value })}
                    placeholder="https://..."
                  />
                  <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-input bg-background px-2 h-9 text-sm hover:bg-muted">
                    {uploading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Upload className="h-4 w-4" />
                    )}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) uploadImage(f);
                      }}
                    />
                  </label>
                </div>
                {editing.image_url && (
                  <img
                    src={resolveBannerImage(editing.image_url)}
                    alt=""
                    className="mt-2 h-24 w-full rounded-md object-cover"
                  />
                )}
              </div>
              <div>
                <Label>Link URL</Label>
                <Input
                  value={editing.link_url || ""}
                  onChange={(e) => setEditing({ ...editing, link_url: e.target.value })}
                  placeholder="/category/electronics"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label>Placement</Label>
                  <Select
                    value={editing.placement}
                    onValueChange={(v) => setEditing({ ...editing, placement: v as any })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="hero">Hero</SelectItem>
                      <SelectItem value="featured_category">Featured category</SelectItem>
                      <SelectItem value="featured_product">Featured product</SelectItem>
                      <SelectItem value="promo">Promo</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Sort order</Label>
                  <Input
                    type="number"
                    value={editing.sort_order ?? 0}
                    onChange={(e) => setEditing({ ...editing, sort_order: Number(e.target.value) })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label>Starts at</Label>
                  <Input
                    type="datetime-local"
                    value={editing.starts_at ? editing.starts_at.slice(0, 16) : ""}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        starts_at: e.target.value ? new Date(e.target.value).toISOString() : null,
                      })
                    }
                  />
                </div>
                <div>
                  <Label>Ends at</Label>
                  <Input
                    type="datetime-local"
                    value={editing.ends_at ? editing.ends_at.slice(0, 16) : ""}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        ends_at: e.target.value ? new Date(e.target.value).toISOString() : null,
                      })
                    }
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  id="ab"
                  type="checkbox"
                  checked={editing.is_active ?? true}
                  onChange={(e) => setEditing({ ...editing, is_active: e.target.checked })}
                />
                <Label htmlFor="ab">Active</Label>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!editing?.title || !editing?.image_url)
                  return toast.error("Title & image required");
                if (
                  editing.starts_at &&
                  editing.ends_at &&
                  new Date(editing.ends_at) <= new Date(editing.starts_at)
                )
                  return toast.error("End time must be after start time");
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
