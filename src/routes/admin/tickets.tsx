import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAdminTickets } from "@/lib/admin-db";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/tickets")({
  head: () => ({ meta: [{ title: "Support Tickets — Admin" }, { name: "robots", content: "noindex" }] }),
  component: TicketsPage,
});

function TicketsPage() {
  const q = useAdminTickets();
  const queryClient = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all"|"customer"|"vendor">("all");
  const [status, setStatus] = useState("all");
  const rows = useMemo(() => {
    let r = q.data ?? [];
    if (filter !== "all") r = r.filter(x => x.raised_by === filter);
    if (status !== "all") r = r.filter(x => (x.support_stage ?? x.status) === status);
    return r;
  }, [q.data, filter, status]);

  return (
    <div className="space-y-4">
      <div><h1 className="text-2xl font-black tracking-tight sm:text-3xl">Support Tickets</h1><p className="text-sm text-muted-foreground">Customer and vendor support conversations.</p></div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-xs font-medium text-muted-foreground">Audience</span>
        {(["all","customer","vendor"] as const).map(f=><Button key={f} size="sm" variant={filter===f?"default":"outline"} onClick={()=>setFilter(f)} className="rounded-full capitalize">{f}</Button>)}
        <div className="mx-2 h-6 w-px bg-border"/><span className="mr-1 text-xs font-medium text-muted-foreground">Stage</span>
        {["all","submitted","under_review","awaiting_shop_response","approved","rejected","refund_initiated","refunded","replacement_approved","replacement_delivered"].map(f=><Button key={f} size="sm" variant={status===f?"default":"outline"} onClick={()=>setStatus(f)} className="rounded-full capitalize">{f.replaceAll("_", " ")}</Button>)}
        {(filter !== "all" || status !== "all") && <Button size="sm" variant="ghost" onClick={() => { setFilter("all"); setStatus("all"); }} className="rounded-full">Clear filters</Button>}
      </div>
      {!q.isLoading && <p className="text-xs text-muted-foreground">Showing {rows.length} of {(q.data ?? []).length} support request(s).</p>}
      {q.isLoading ? <div className="h-24 animate-pulse rounded-xl bg-muted"/>
      : rows.length===0 ? <Card><CardContent className="grid place-items-center py-16 text-sm text-muted-foreground">No tickets in this view.</CardContent></Card>
      : (
        <div className="space-y-2 stagger">
          {rows.map(t => (
            <Card key={t.id}><CardContent className="p-4 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{t.subject}</span>
                <Badge variant="outline" className="capitalize">{t.raised_by}</Badge>
                <Badge variant="outline" className="capitalize">{t.priority}</Badge>
                <Badge variant={t.support_stage === "rejected" || t.support_stage === "refunded" ? "secondary" : "default"} className="capitalize ml-auto">{(t.support_stage ?? t.status).replaceAll("_", " ")}</Badge>
              </div>
              <p className="text-sm text-muted-foreground">{t.body}</p>
              {t.issue_type && <div className="flex flex-wrap gap-3 text-xs text-muted-foreground"><span>Issue: {t.issue_type.replaceAll("_", " ")}</span><span>{t.selected_product_ids?.length ?? 0} item(s)</span><span>{(t.evidence_urls?.length ?? 0) + (t.video_url ? 1 : 0)} evidence file(s)</span>{t.order_id && <span>Order: {t.order_id.slice(0, 8)}</span>}</div>}
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" disabled={busyId === t.id} onClick={()=>void transition(t.id, t.support_stage ?? "submitted", "under_review", "Case opened for review")}>Review</Button>
                <Button size="sm" variant="outline" disabled={busyId === t.id} onClick={()=>void transition(t.id, t.support_stage ?? "submitted", "approved", "Support approved")}>Approve</Button>
                <Button size="sm" variant="outline" disabled={busyId === t.id} onClick={()=>void transition(t.id, t.support_stage ?? "submitted", "rejected", "Support rejected")}>Reject</Button>
                <Button size="sm" variant="outline" disabled={busyId === t.id} onClick={()=>void transition(t.id, t.support_stage ?? "submitted", "awaiting_shop_response", "Shop response requested")}>Request shop response</Button>
                <Button size="sm" variant="outline" disabled={busyId === t.id} onClick={()=>void transition(t.id, t.support_stage ?? "submitted", "refund_initiated", "Refund initiated by support")}>Start refund</Button>
                <Button size="sm" variant="outline" disabled={busyId === t.id} onClick={()=>void transition(t.id, t.support_stage ?? "submitted", "refunded", "Refund marked complete")}>Mark refunded</Button>
                <Button size="sm" variant="outline" disabled={busyId === t.id} onClick={()=>void transition(t.id, t.support_stage ?? "submitted", "replacement_approved", "Replacement approved")}>Approve replacement</Button>
                <Button size="sm" variant="outline" disabled={busyId === t.id} onClick={()=>void transition(t.id, t.support_stage ?? "submitted", "replacement_delivered", "Replacement marked delivered")}>Mark replacement delivered</Button>
                {((t.evidence_urls?.length ?? 0) > 0 || Boolean(t.video_url)) && <EvidenceLinks paths={[...(t.evidence_urls ?? []), ...(t.video_url ? [t.video_url] : [])]} />}
              </div>
            </CardContent></Card>
          ))}
        </div>
      )}
    </div>
  );

  async function transition(id: string, from: string, to: string, note: string) {
    setBusyId(id);
    try {
      const status = to === "refunded" || to === "rejected" ? "resolved" : "pending";
      const { data: updated, error } = await (supabase as any)
        .from("support_tickets")
        .update({ support_stage: to, status, resolved_at: status === "resolved" ? new Date().toISOString() : null })
        .eq("id", id)
        .select("id,support_stage,status")
        .maybeSingle();
      if (error) throw error;
      if (!updated) throw new Error("Support case was not updated. Check your admin access and try again.");
      const { data: auth } = await supabase.auth.getUser();
      if (auth.user) {
        const { error: eventError } = await (supabase as any).from("support_case_events").insert({ ticket_id: id, actor_id: auth.user.id, from_stage: from, to_stage: to, note });
        if (eventError) console.error("support audit event failed", eventError);
      }
      await queryClient.invalidateQueries({ queryKey: ["support_tickets"] });
      toast.success(`Case ${to.replaceAll("_", " ")}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update support case.");
    } finally {
      setBusyId(null);
    }
  }
}

function EvidenceLinks({ paths }: { paths: string[] }) {
  const [loading, setLoading] = useState(false);
  const openEvidence = async () => {
    setLoading(true);
    try {
      const urls = await Promise.all(paths.map(async (storedPath) => {
        const path = storedPath.includes("/support-evidence/")
          ? storedPath.split("/support-evidence/")[1].split(/[?#]/)[0]
          : storedPath;
        const { data, error } = await supabase.storage.from("support-evidence").createSignedUrl(path, 600);
        if (error) throw error;
        return data.signedUrl;
      }));
      urls.forEach((url) => window.open(url, "_blank", "noopener,noreferrer"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not open evidence.");
    } finally {
      setLoading(false);
    }
  };
  return <Button size="sm" variant="outline" disabled={loading} onClick={() => void openEvidence()}>{loading ? "Opening..." : "View evidence"}</Button>;
}
