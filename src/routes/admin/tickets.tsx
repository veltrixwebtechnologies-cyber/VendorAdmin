import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAdminTickets, useUpdateTicket } from "@/lib/admin-db";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/tickets")({
  head: () => ({ meta: [{ title: "Support Tickets — Admin" }, { name: "robots", content: "noindex" }] }),
  component: TicketsPage,
});

function TicketsPage() {
  const q = useAdminTickets();
  const upd = useUpdateTicket();
  const [filter, setFilter] = useState<"all"|"customer"|"vendor">("all");
  const [status, setStatus] = useState<"all"|"open"|"pending"|"resolved"|"closed">("all");
  const rows = useMemo(() => {
    let r = q.data ?? [];
    if (filter !== "all") r = r.filter(x => x.raised_by === filter);
    if (status !== "all") r = r.filter(x => x.status === status);
    return r;
  }, [q.data, filter, status]);

  return (
    <div className="space-y-4">
      <div><h1 className="text-2xl font-black tracking-tight sm:text-3xl">Support Tickets</h1><p className="text-sm text-muted-foreground">Customer and vendor support conversations.</p></div>
      <div className="flex flex-wrap gap-2">
        {(["all","customer","vendor"] as const).map(f=><Button key={f} size="sm" variant={filter===f?"default":"outline"} onClick={()=>setFilter(f)} className="rounded-full capitalize">{f}</Button>)}
        <div className="mx-2 h-6 w-px bg-border"/>
        {(["all","open","pending","resolved","closed"] as const).map(f=><Button key={f} size="sm" variant={status===f?"default":"outline"} onClick={()=>setStatus(f)} className="rounded-full capitalize">{f}</Button>)}
      </div>
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
                <Badge variant={t.status==="resolved"||t.status==="closed"?"secondary":"default"} className="capitalize ml-auto">{t.status}</Badge>
              </div>
              <p className="text-sm text-muted-foreground">{t.body}</p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={()=>upd.mutate({id:t.id,status:"pending"},{onSuccess:()=>toast.success("Marked pending")})}>Reply / Pending</Button>
                <Button size="sm" variant="outline" onClick={()=>upd.mutate({id:t.id,status:"resolved"},{onSuccess:()=>toast.success("Resolved")})}>Resolve</Button>
                <Button size="sm" variant="outline" onClick={()=>upd.mutate({id:t.id,status:"closed"},{onSuccess:()=>toast.success("Closed")})}>Close</Button>
              </div>
            </CardContent></Card>
          ))}
        </div>
      )}
    </div>
  );
}
