import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/seller/support")({ component: SellerSupportPage });

function SellerSupportPage() {
  const [reply, setReply] = useState<Record<string, string>>({});
  const cases = useQuery({
    queryKey: ["seller-support-cases"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("support_tickets").select("id,subject,body,support_stage,issue_type,created_at,order_id").eq("raised_by", "customer").order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
  const sendReply = async (ticketId: string) => {
    const body = reply[ticketId]?.trim();
    if (!body) return;
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return;
    const { error } = await (supabase as any).from("ticket_messages").insert({ ticket_id: ticketId, author_id: auth.user.id, is_admin: false, body });
    if (error) { toast.error(error.message); return; }
    setReply((current) => ({ ...current, [ticketId]: "" }));
    toast.success("Response sent to support");
  };
  return <div className="mx-auto max-w-5xl space-y-4"><div><h1 className="text-2xl font-black tracking-tight sm:text-3xl">Customer issues</h1><p className="text-sm text-muted-foreground">Review issues related to your orders and respond to support. Refund decisions remain with customer care.</p></div>{cases.isLoading ? <div className="h-24 animate-pulse rounded-xl bg-muted" /> : cases.error ? <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">Could not load support cases.</CardContent></Card> : cases.data?.length === 0 ? <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">No customer issues for your orders.</CardContent></Card> : <div className="space-y-3">{cases.data?.map((item: any) => <Card key={item.id}><CardContent className="space-y-3 p-4"><div className="flex flex-wrap items-center gap-2"><h2 className="mr-auto font-semibold">{item.subject}</h2><Badge variant="outline" className="capitalize">{(item.support_stage ?? "submitted").replaceAll("_", " ")}</Badge></div><p className="text-sm text-muted-foreground">{item.body}</p><p className="text-xs text-muted-foreground">Order {item.order_id?.slice(0, 8) ?? "demo"} · {new Date(item.created_at).toLocaleString()}</p><div className="flex gap-2"><input value={reply[item.id] ?? ""} onChange={(event) => setReply((current) => ({ ...current, [item.id]: event.target.value }))} placeholder="Add a note for customer support" className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm" /><Button size="sm" onClick={() => void sendReply(item.id)}>Respond</Button></div></CardContent></Card>)}</div>}</div>;
}
