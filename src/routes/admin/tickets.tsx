import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
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
        {["all","submitted","under_review","awaiting_shop_response","approved","rejected","refund_initiated","refunded","replacement_approved"].map(f=><Button key={f} size="sm" variant={status===f?"default":"outline"} onClick={()=>setStatus(f)} className="rounded-full capitalize">{f.replaceAll("_", " ")}</Button>)}
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
                <Button size="sm" variant="outline" onClick={()=>transition(t.id, t.support_stage ?? "submitted", "under_review", "Case opened for review")}>Review</Button>
                <Button size="sm" variant="outline" onClick={()=>transition(t.id, t.support_stage ?? "submitted", "approved", "Support approved")}>Approve</Button>
                <Button size="sm" variant="outline" onClick={()=>transition(t.id, t.support_stage ?? "submitted", "rejected", "Support rejected")}>Reject</Button>
                <Button size="sm" variant="outline" onClick={()=>transition(t.id, t.support_stage ?? "submitted", "refund_initiated", "Refund initiated by support")}>Start refund</Button>
                <Button size="sm" variant="outline" onClick={()=>transition(t.id, t.support_stage ?? "submitted", "refunded", "Refund marked complete")}>Mark refunded</Button>
              </div>
            </CardContent></Card>
          ))}
        </div>
      )}
    </div>
  );
}

async function transition(id: string, from: string, to: string, note: string) {
  const status = to === "refunded" || to === "rejected" ? "resolved" : "pending";
  const { error } = await (supabase as any).from("support_tickets").update({ id, support_stage: to, status, resolved_at: status === "resolved" ? new Date().toISOString() : null }).eq("id", id);
  if (error) { toast.error(error.message); return; }
  const { data: auth } = await supabase.auth.getUser();
  if (auth.user) await (supabase as any).from("support_case_events").insert({ ticket_id: id, actor_id: auth.user.id, from_stage: from, to_stage: to, note });
  toast.success(`Case ${to.replaceAll("_", " ")}`);
  window.location.reload();
}
