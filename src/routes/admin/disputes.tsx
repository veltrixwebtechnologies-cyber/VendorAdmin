import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { adminErrorMessage } from "@/lib/admin-permissions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/admin/disputes")({
  head: () => ({
    meta: [{ title: "Order Disputes — Admin" }, { name: "robots", content: "noindex" }],
  }),
  component: DisputesPage,
});
type Dispute = {
  ticket_id: string;
  case_number: string;
  order_id: string;
  order_number: string | null;
  seller_id: string | null;
  store_id: string | null;
  subject: string;
  issue_category: string | null;
  issue_type: string | null;
  support_stage: string;
  ticket_status: string;
  priority: string;
  created_at: string;
  updated_at: string;
};
type Event = { event_at: string; event_type: string; description: string };

function DisputesPage() {
  const [selected, setSelected] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ["admin", "order-disputes"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_admin_order_disputes");
      if (error) throw error;
      return (data ?? []) as Dispute[];
    },
  });
  const timeline = useQuery({
    queryKey: ["admin", "dispute-timeline", selected],
    enabled: !!selected,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_admin_dispute_timeline", {
        p_ticket_id: selected,
      });
      if (error) throw error;
      return (data ?? []) as Event[];
    },
  });
  return (
    <main className="space-y-5">
      <header>
        <h1 className="text-2xl font-black tracking-tight sm:text-3xl">Order Disputes</h1>
        <p className="text-sm text-muted-foreground">
          Order-linked cases use LocalShore’s existing protected Support Tickets system. Financial
          refund decisions stay in Finance → Refunds.
        </p>
      </header>
      {q.isError ? (
        <Card>
          <CardContent className="p-5 text-sm text-destructive">
            {adminErrorMessage(
              q.error,
              "Disputes could not be loaded. The Phase C migration may still be pending.",
            )}
          </CardContent>
        </Card>
      ) : null}
      {q.isLoading ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Loading order cases…
          </CardContent>
        </Card>
      ) : !q.data?.length ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No order-linked support disputes found.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(300px,.8fr)]">
          <section className="space-y-3">
            {q.data.map((d) => (
              <Card key={d.ticket_id} className={selected === d.ticket_id ? "border-primary" : ""}>
                <CardContent className="space-y-3 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="mr-auto">
                      <p className="text-xs font-semibold text-primary">
                        {d.case_number} · {d.order_number ?? `Order ${d.order_id.slice(0, 8)}`}
                      </p>
                      <h2 className="font-semibold">{d.subject}</h2>
                    </div>
                    <Badge
                      variant={
                        d.priority === "urgent" || d.priority === "high" ? "destructive" : "outline"
                      }
                    >
                      {d.priority}
                    </Badge>
                    <Badge variant="outline" className="capitalize">
                      {(d.support_stage || d.ticket_status).replaceAll("_", " ").toLowerCase()}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {d.issue_category ?? d.issue_type ?? "Order issue"}
                    {d.seller_id ? ` · Seller ${d.seller_id.slice(0, 8)}` : ""}
                    {d.store_id ? ` · Store ${d.store_id.slice(0, 8)}` : ""} · Updated{" "}
                    {new Date(d.updated_at).toLocaleString("en-IN")}
                  </p>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => setSelected(d.ticket_id)}>
                      {selected === d.ticket_id ? "Timeline selected" : "View timeline"}
                    </Button>
                    <a
                      className="inline-flex h-9 items-center rounded-md border px-3 text-sm hover:bg-accent"
                      href="/admin/tickets"
                    >
                      Open Support Console
                    </a>
                  </div>
                </CardContent>
              </Card>
            ))}
          </section>
          <Card className="h-fit xl:sticky xl:top-20">
            <CardHeader>
              <CardTitle className="text-base">Order timeline</CardTitle>
            </CardHeader>
            <CardContent>
              {!selected ? (
                <p className="text-sm text-muted-foreground">
                  Choose a case to inspect recorded events.
                </p>
              ) : timeline.isLoading ? (
                <p className="text-sm text-muted-foreground">Loading recorded events…</p>
              ) : timeline.isError ? (
                <p className="text-sm text-destructive">
                  {adminErrorMessage(timeline.error, "Timeline could not be loaded.")}
                </p>
              ) : !timeline.data?.length ? (
                <p className="text-sm text-muted-foreground">
                  No timeline events are recorded for this case.
                </p>
              ) : (
                <ol className="space-y-4">
                  {timeline.data.map((event, index) => (
                    <li
                      key={`${event.event_at}-${event.event_type}-${index}`}
                      className="border-l-2 border-primary/30 pl-3"
                    >
                      <p className="text-xs font-semibold">
                        {event.event_type.replaceAll("_", " ").toLowerCase()}
                      </p>
                      <p className="text-sm">{event.description}</p>
                      <time className="text-xs text-muted-foreground">
                        {new Date(event.event_at).toLocaleString("en-IN")}
                      </time>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </main>
  );
}
