import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Plus, Pencil, Trash2, Upload, Loader2, Sparkles } from "lucide-react";
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
import {
  useBanners,
  useUpsertBanner,
  useDeleteBanner,
  useAppBannerConfig,
  useSaveAppBannerConfig,
  DEFAULT_APP_BANNER_CONFIG,
  type AppDownloadBannerConfig,
  type Banner,
} from "@/lib/admin-db";
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

function AppBannerConfigEditor() {
  const { data: config, isLoading } = useAppBannerConfig();
  const saveConfig = useSaveAppBannerConfig();
  const [form, setForm] = useState<AppDownloadBannerConfig | null>(null);
  const [isEditing, setIsEditing] = useState(false);

  const activeConfig = form || config || DEFAULT_APP_BANNER_CONFIG;

  const handleOpenEdit = () => {
    setForm(config || DEFAULT_APP_BANNER_CONFIG);
    setIsEditing(true);
  };

  const handleSave = () => {
    if (!form) return;
    saveConfig.mutate(form, {
      onSuccess: () => {
        toast.success("App Download Banner configuration saved live!");
        setIsEditing(false);
      },
      onError: (e: any) => {
        toast.error(e.message || "Failed to save configuration");
      },
    });
  };

  const handleReset = () => {
    saveConfig.mutate(DEFAULT_APP_BANNER_CONFIG, {
      onSuccess: () => {
        toast.success("Reset App Banner settings to default!");
        setForm(DEFAULT_APP_BANNER_CONFIG);
        setIsEditing(false);
      },
    });
  };

  if (isLoading) {
    return <div className="h-32 animate-pulse rounded-xl bg-muted" />;
  }

  return (
    <Card className="overflow-hidden border-2 border-primary/20 bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 text-white shadow-xl mb-6">
      <CardContent className="p-5 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="flex h-3 w-3 rounded-full bg-[#facc15] animate-ping" />
              <h2 className="text-lg font-black tracking-tight text-white sm:text-xl">
                App Download Promo Banner
              </h2>
              <Badge
                variant={activeConfig.is_active ? "default" : "secondary"}
                className={activeConfig.is_active ? "bg-[#facc15] text-slate-950 font-bold" : ""}
              >
                {activeConfig.is_active ? "Active on Storefront" : "Disabled"}
              </Badge>
            </div>
            <p className="text-xs text-slate-400">
              Customize headline, discount offer, badges, store ratings, and text displayed in the dark glass download strip on LocalShore.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" className="bg-slate-800 text-white hover:bg-slate-700 border-slate-700" onClick={handleOpenEdit}>
              <Pencil className="h-4 w-4 mr-1.5" />
              Edit Banner Settings
            </Button>
          </div>
        </div>

        {/* Live Admin Preview */}
        <div className="rounded-xl border border-slate-800 bg-[#070a16] p-4 sm:p-6 text-white shadow-2xl relative overflow-hidden">
          <div className="absolute top-2 right-2 text-[9px] font-mono uppercase bg-[#facc15]/20 text-[#facc15] border border-[#facc15]/30 px-2 py-0.5 rounded">
            Live Preview
          </div>
          <div className="flex flex-col lg:flex-row items-center justify-between gap-6">
            <div className="space-y-2 text-left flex-1">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1 rounded-full bg-[#2a2208] px-2.5 py-0.5 text-[10px] font-bold text-[#facc15] border border-[#52410a]">
                  <Sparkles className="h-3 w-3" />
                  {activeConfig.badge1_text}
                </span>
                <span className="inline-flex items-center rounded-full bg-[#06241a] px-2.5 py-0.5 text-[10px] font-bold text-[#2dd4bf] border border-[#0a4d38]">
                  {activeConfig.badge2_text}
                </span>
              </div>
              <h3 className="text-xl sm:text-2xl font-black tracking-tight text-white">
                {activeConfig.headline_prefix}
                <span className="text-[#facc15]">{activeConfig.headline_highlight}</span>
                {activeConfig.headline_suffix}
              </h3>
              <p className="text-xs text-slate-300 max-w-lg line-clamp-2">
                {activeConfig.description}
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0 bg-[#11162b] p-3 rounded-xl border border-[#232c4a]">
              <div className="text-left space-y-1 text-xs">
                <div className="text-[10px] text-slate-400">Google Play: <strong className="text-[#facc15]">★ {activeConfig.google_play_rating}</strong> ({activeConfig.google_play_downloads})</div>
                <div className="text-[10px] text-slate-400">App Store: <strong className="text-[#facc15]">★ {activeConfig.app_store_rating}</strong> ({activeConfig.app_store_downloads})</div>
              </div>
              <div className="bg-white text-slate-950 p-1.5 rounded font-mono text-[9px] font-bold text-center">
                QR CODE
              </div>
            </div>
          </div>
        </div>
      </CardContent>

      {/* Admin Edit Modal */}
      <Dialog open={isEditing} onOpenChange={setIsEditing}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit App Download Banner Settings</DialogTitle>
          </DialogHeader>
          {form && (
            <div className="grid gap-4 py-2 text-sm">
              <div className="flex items-center justify-between rounded-lg border p-3 bg-muted/40">
                <div>
                  <Label className="font-bold">Enable App Banner</Label>
                  <p className="text-xs text-muted-foreground">Show or hide this banner on the storefront homepage</p>
                </div>
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                  className="h-5 w-5 rounded border-gray-300 text-primary focus:ring-primary cursor-pointer"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Badge 1 Text</Label>
                  <Input
                    value={form.badge1_text}
                    onChange={(e) => setForm({ ...form, badge1_text: e.target.value })}
                    placeholder="Special App Offer"
                  />
                </div>
                <div>
                  <Label>Badge 2 Text</Label>
                  <Input
                    value={form.badge2_text}
                    onChange={(e) => setForm({ ...form, badge2_text: e.target.value })}
                    placeholder="Exclusive Deals"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label>Headline Prefix</Label>
                  <Input
                    value={form.headline_prefix}
                    onChange={(e) => setForm({ ...form, headline_prefix: e.target.value })}
                    placeholder="Grab "
                  />
                </div>
                <div>
                  <Label>Offer Highlight (Yellow)</Label>
                  <Input
                    value={form.headline_highlight}
                    onChange={(e) => setForm({ ...form, headline_highlight: e.target.value })}
                    placeholder="10% OFF"
                  />
                </div>
                <div>
                  <Label>Headline Suffix</Label>
                  <Input
                    value={form.headline_suffix}
                    onChange={(e) => setForm({ ...form, headline_suffix: e.target.value })}
                    placeholder=" now"
                  />
                </div>
              </div>

              <div>
                <Label>Description Text</Label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  rows={2}
                  className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>SMS Button Label</Label>
                  <Input
                    value={form.button_text}
                    onChange={(e) => setForm({ ...form, button_text: e.target.value })}
                    placeholder="Get App Link"
                  />
                </div>
                <div>
                  <Label>QR Code Label</Label>
                  <Input
                    value={form.qr_label}
                    onChange={(e) => setForm({ ...form, qr_label: e.target.value })}
                    placeholder="SCAN TO DOWNLOAD"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 border-t pt-3">
                <div>
                  <Label>Google Play Rating</Label>
                  <Input
                    value={form.google_play_rating}
                    onChange={(e) => setForm({ ...form, google_play_rating: e.target.value })}
                    placeholder="4.8"
                  />
                </div>
                <div>
                  <Label>Google Play Downloads</Label>
                  <Input
                    value={form.google_play_downloads}
                    onChange={(e) => setForm({ ...form, google_play_downloads: e.target.value })}
                    placeholder="50 Lakh+"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>App Store Rating</Label>
                  <Input
                    value={form.app_store_rating}
                    onChange={(e) => setForm({ ...form, app_store_rating: e.target.value })}
                    placeholder="4.9"
                  />
                </div>
                <div>
                  <Label>App Store Downloads</Label>
                  <Input
                    value={form.app_store_downloads}
                    onChange={(e) => setForm({ ...form, app_store_downloads: e.target.value })}
                    placeholder="10 Lakh+"
                  />
                </div>
              </div>
            </div>
          )}
          <DialogFooter className="flex justify-between items-center sm:justify-between">
            <Button variant="ghost" className="text-destructive hover:bg-destructive/10" onClick={handleReset}>
              Reset to Defaults
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setIsEditing(false)}>
                Cancel
              </Button>
              <Button onClick={handleSave} className="bg-[#facc15] text-slate-950 hover:bg-[#eab308] font-bold">
                Save & Publish
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
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
          <p className="text-sm text-muted-foreground">Homepage hero, app download promo, and featured slots.</p>
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

      {/* App Download Banner Admin Configuration Card */}
      <AppBannerConfigEditor />

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
                
                const payload = {
                  ...editing,
                  starts_at: editing.starts_at || null,
                  ends_at: editing.ends_at || null,
                };

                upsert.mutate(payload as any, {
                  onSuccess: () => {
                    toast.success("Banner saved ✓ Live on user side!");
                    setEditing(null);
                  },
                  onError: (e: any) => toast.error(e.message || "Save failed"),
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
