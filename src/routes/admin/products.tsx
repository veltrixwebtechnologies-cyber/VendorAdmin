import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Search, XCircle, CheckCircle2, EyeOff, Trash2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/products")({
  head: () => ({ meta: [{ title: "Products — Admin" }, { name: "robots", content: "noindex" }] }),
  component: AdminProducts,
});

type Row = { id: string; name: string; category: string | null; selling_price: number; stock: number; status: string; image_url: string | null; user_id: string; shop_name?: string | null; seller_email?: string | null };

const QUICK_REASONS = [
  "Low-quality or unclear product images",
  "Incomplete or misleading description",
  "Price is unrealistic or incorrect",
  "Prohibited / restricted item",
  "Duplicate listing",
  "Trademark / brand policy violation",
];

function useAllProducts() {
  return useQuery<Row[]>({
    queryKey: ["admin","products"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("products").select("id, name, category, selling_price, stock, status, image_url, user_id, created_at").order("created_at", { ascending: false });
      if (error) throw error;
      const rows = (data ?? []) as Row[];
      const ids = Array.from(new Set(rows.map(r => r.user_id).filter(Boolean)));
      if (ids.length) {
        const [{ data: sellers }, { data: profiles }] = await Promise.all([
          (supabase as any).from("sellers").select("user_id, business_name").in("user_id", ids),
          (supabase as any).from("profiles").select("id, email").in("id", ids),
        ]);
        const smap = new Map((sellers ?? []).map((s: any) => [s.user_id, s.business_name]));
        const pmap = new Map((profiles ?? []).map((p: any) => [p.id, p.email]));
        rows.forEach(r => { r.shop_name = (smap.get(r.user_id) as string | undefined) ?? null; r.seller_email = (pmap.get(r.user_id) as string | undefined) ?? null; });
      }
      // Sign bucket-key image paths so <img> can render them from a private bucket.
      const paths = rows.map(r => r.image_url).filter((v): v is string => !!v && !/^https?:\/\//i.test(v));
      if (paths.length) {
        const { data: signed } = await supabase.storage.from("product-images").createSignedUrls(paths, 3600);
        const sm = new Map((signed ?? []).map((s: any) => [s.path, s.signedUrl]));
        rows.forEach(r => { if (r.image_url && sm.has(r.image_url)) r.image_url = sm.get(r.image_url)!; });
      }
      return rows;
    },
    refetchInterval: 15000,
  });
}

function AdminProducts() {
  const q = useAllProducts();
  const qc = useQueryClient();
  const upd = useMutation({
    mutationFn: async ({ id, status, rejection_reason }: { id: string; status: string; rejection_reason?: string | null }) => {
      const patch: any = { status };
      if (status === "rejected") patch.rejection_reason = rejection_reason ?? null;
      const { error } = await (supabase as any).from("products").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin","products"] }),
  });

  const del = useMutation({
    mutationFn: async (id: string) => { const { error } = await (supabase as any).from("products").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin","products"] }),
  });
  const [filter, setFilter] = useState<"all"|"pending"|"active"|"rejected"|"out">("all");
  const [search, setSearch] = useState("");
  const [rejectTarget, setRejectTarget] = useState<Row | null>(null);
  const [reason, setReason] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Row | null>(null);

  const rows = useMemo(() => {
    let r = q.data ?? [];
    if (filter === "out") r = r.filter(p => (p.stock ?? 0) === 0);
    else if (filter !== "all") r = r.filter(p => (p.status || "").toLowerCase() === filter);
    if (search.trim()) { const s = search.toLowerCase(); r = r.filter(p => (p.name+" "+(p.category||"")).toLowerCase().includes(s)); }
    return r;
  }, [q.data, filter, search]);

  const openReject = (p: Row) => { setRejectTarget(p); setReason(""); };
  const submitReject = () => {
    const trimmed = reason.trim();
    if (!trimmed) { toast.error("Please provide a reason"); return; }
    if (!rejectTarget) return;
    upd.mutate({ id: rejectTarget.id, status: "rejected", rejection_reason: trimmed }, {
      onSuccess: () => { toast.success("Rejected — seller notified"); setRejectTarget(null); setReason(""); },
      onError: (e: any) => toast.error(e?.message ?? "Failed to reject"),
    });
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-black tracking-tight sm:text-3xl">Products</h1>
        <p className="text-sm text-muted-foreground">Approve, reject, or remove listings across vendors.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {(["all","pending","active","rejected","out"] as const).map(f => (
          <Button key={f} size="sm" variant={filter===f?"default":"outline"} onClick={()=>setFilter(f)} className="rounded-full capitalize">
            {f === "out" ? "Out of stock" : f}
          </Button>
        ))}
        <div className="relative ml-auto w-full sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search name or category" className="pl-8 h-9" value={search} onChange={e=>setSearch(e.target.value)} />
        </div>
      </div>

      {q.isLoading ? <div className="grid gap-2">{Array.from({length:4}).map((_,i)=><div key={i} className="h-16 animate-pulse rounded-xl bg-muted"/>)}</div>
      : rows.length === 0 ? <Card><CardContent className="grid place-items-center py-16 text-sm text-muted-foreground">No products match this filter.</CardContent></Card>
      : (
        <Card><CardContent className="p-0">
          <div className="divide-y divide-border">
            {rows.map(p => (
              <div key={p.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-3 sm:px-4">
                <div className="flex min-w-0 items-center gap-3">
                  {p.image_url ? (
                    <img src={p.image_url} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover" />
                  ) : (
                    <div className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-muted text-xs text-muted-foreground">IMG</div>
                  )}
                  <div className="min-w-0">
                    <div className="truncate font-semibold">{p.name}</div>
                    <div className="mt-0.5 flex items-center gap-1.5">
                      <Badge variant="secondary" className="h-5 px-1.5 text-[10px] font-medium">Vendor</Badge>
                      <span className="truncate text-xs font-medium text-foreground">
                        {p.shop_name || p.seller_email || `#${p.user_id.slice(0,8)}`}
                      </span>
                      {p.shop_name && p.seller_email ? (
                        <span className="truncate text-[11px] text-muted-foreground">· {p.seller_email}</span>
                      ) : null}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {p.category || "Uncategorized"} · ₹{Number(p.selling_price||0).toLocaleString("en-IN")} · Stock: {p.stock ?? 0}
                    </div>
                  </div>
                  <Badge variant="outline" className="ml-2 shrink-0 capitalize">{p.status || "draft"}</Badge>
                </div>
                <div className="flex flex-wrap gap-1">
                  <Button size="sm" variant="outline" onClick={()=>upd.mutate({id:p.id,status:"approved"},{onSuccess:()=>toast.success("Approved")})}>
                    <CheckCircle2 className="h-4 w-4" /> Approve
                  </Button>
                  <Button size="sm" variant="outline" onClick={()=>openReject(p)}>
                    <XCircle className="h-4 w-4" /> Reject
                  </Button>
                  <Button size="sm" variant="outline" onClick={()=>upd.mutate({id:p.id,status:"inactive"},{onSuccess:()=>toast.success("Hidden")})}>
                    <EyeOff className="h-4 w-4" /> Hide
                  </Button>
                  <Button size="sm" variant="destructive" onClick={()=>setDeleteTarget(p)}>
                    <Trash2 className="h-4 w-4" /> Delete
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent></Card>
      )}

      <Dialog open={!!rejectTarget} onOpenChange={(o)=>{ if (!o) { setRejectTarget(null); setReason(""); } }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded-full bg-destructive/10 text-destructive">
                <XCircle className="h-4 w-4" />
              </span>
              Reject product
            </DialogTitle>
            <DialogDescription>
              The seller will see this reason in their notifications and can resubmit after fixing it.
            </DialogDescription>
          </DialogHeader>

          {rejectTarget ? (
            <div className="flex items-center gap-3 rounded-lg border bg-muted/40 p-3">
              {rejectTarget.image_url ? (
                <img src={rejectTarget.image_url} alt="" className="h-10 w-10 rounded-md object-cover" />
              ) : (
                <div className="grid h-10 w-10 place-items-center rounded-md bg-muted text-[10px] text-muted-foreground">IMG</div>
              )}
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">{rejectTarget.name}</div>
                <div className="truncate text-xs text-muted-foreground">
                  Vendor: {rejectTarget.shop_name || rejectTarget.seller_email || rejectTarget.user_id.slice(0,8)}
                </div>
              </div>
            </div>
          ) : null}

          <div className="space-y-2">
            <div className="text-xs font-medium text-muted-foreground">Quick reasons</div>
            <div className="flex flex-wrap gap-1.5">
              {QUICK_REASONS.map(r => (
                <button
                  key={r}
                  type="button"
                  onClick={()=>setReason(r)}
                  className="rounded-full border border-border bg-background px-3 py-1 text-xs text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Reason for rejection</label>
            <Textarea
              value={reason}
              onChange={(e)=>setReason(e.target.value)}
              placeholder="Explain what needs to change before this can be approved…"
              rows={4}
              autoFocus
            />
            <div className="text-right text-[11px] text-muted-foreground">{reason.trim().length} characters</div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={()=>{ setRejectTarget(null); setReason(""); }}>Cancel</Button>
            <Button variant="destructive" onClick={submitReject} disabled={!reason.trim() || upd.isPending}>
              {upd.isPending ? "Rejecting…" : "Reject & notify seller"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o)=>{ if (!o) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this product?</AlertDialogTitle>
            <AlertDialogDescription>
              "{deleteTarget?.name}" will be permanently removed from the marketplace. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={()=>{
                if (!deleteTarget) return;
                del.mutate(deleteTarget.id, { onSuccess: () => { toast.success("Deleted"); setDeleteTarget(null); } });
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
