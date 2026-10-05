import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/seller/support")({ component: SellerSupportPage });
type CaseRow = {
  id: string;
  case_number: string;
  order_number: string | null;
  subject: string;
  issue_category: string | null;
  issue_type: string | null;
  affected_item_name: string | null;
  support_stage: string;
  status: string;
  created_at: string;
  viewer_role: string;
};
type Msg = {
  id: string;
  sender_role: string;
  body: string;
  attachments: string[];
  created_at: string;
  visible_to_customer: boolean;
  visible_to_vendor: boolean;
};
function SellerSupportPage() {
  const client = useQueryClient();
  const auth = useAuth();
  const [reply, setReply] = useState<Record<string, string>>({});
  const [threads, setThreads] = useState<Record<string, Msg[]>>({});
  useEffect(() => {
    setReply({});
    setThreads({});
  }, [auth.user?.id]);
  const cases = useQuery({
    queryKey: ["protected-support-cases", auth.user?.id],
    enabled: !!auth.user,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_protected_support_cases");
      if (error) throw error;
      return (data ?? []).filter((c: CaseRow) => c.viewer_role === "vendor") as CaseRow[];
    },
    refetchInterval: 15000,
  });
  const loadThread = async (id: string) => {
    const { data, error } = await (supabase as any).rpc("get_protected_support_messages", {
      p_ticket_id: id,
    });
    if (error) {
      toast.error("Could not load conversation.");
      return;
    }
    setThreads((v) => ({ ...v, [id]: data ?? [] }));
  };
  const openAttachment = async (path: string) => {
    const { data, error } = await supabase.storage
      .from("support-evidence")
      .createSignedUrl(path, 600);
    if (error || !data?.signedUrl) {
      toast.error("Could not open private attachment.");
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };
  const call = async (id: string, fn: string, args: Record<string, unknown>) => {
    const { error } = await (supabase as any).rpc(fn, { p_ticket_id: id, ...args });
    if (error) {
      toast.error(error.message);
      return false;
    }
    await client.invalidateQueries({ queryKey: ["protected-support-cases"] });
    await loadThread(id);
    return true;
  };
  const send = async (id: string) => {
    const text = reply[id]?.trim();
    if (!text) return;
    if (await call(id, "send_protected_support_message", { p_body: text })) {
      setReply((v) => ({ ...v, [id]: "" }));
      toast.success("Private reply sent to LocalShore Customer Care.");
    }
  };
  const resolution = async (id: string, type: string) => {
    if (
      await call(id, "propose_protected_support_resolution", {
        p_resolution_type: type,
        p_note: "The shop has proposed this option for Customer Care review.",
      })
    )
      toast.success("Proposal sent to the customer through LocalShore.");
  };
  return (
    <main className="mx-auto max-w-5xl space-y-4">
      <header>
        <h1 className="text-2xl font-black tracking-tight sm:text-3xl">Customer Support</h1>
        <p className="text-sm text-muted-foreground">
          Resolve order issues through LocalShore. Customer and shop contact details stay private.
        </p>
      </header>
      {cases.isLoading ? (
        <div className="h-24 animate-pulse rounded-xl bg-muted" />
      ) : cases.error ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Could not load support cases. Confirm the protected support migration is applied.
          </CardContent>
        </Card>
      ) : cases.data?.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No customer support cases for your shop.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {cases.data?.map((item) => (
            <Card key={item.id}>
              <CardContent className="space-y-3 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="mr-auto">
                    <p className="text-xs font-bold text-primary">{item.case_number}</p>
                    <h2 className="font-semibold">{item.subject}</h2>
                  </div>
                  <Badge variant="outline" className="capitalize">
                    {item.support_stage.replaceAll("_", " ").toLowerCase()}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  Order {item.order_number ?? "—"}
                  {item.affected_item_name ? ` · Item: ${item.affected_item_name}` : ""}
                  {item.issue_type ? ` · ${item.issue_type.replaceAll("_", " ")}` : ""} ·{" "}
                  {new Date(item.created_at).toLocaleString()}
                </p>
                <div className="rounded-lg border bg-muted/30 p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold">Conversation via LocalShore</p>
                    <button
                      className="text-xs text-primary underline"
                      onClick={() => void loadThread(item.id)}
                    >
                      {threads[item.id] ? "Refresh" : "Load conversation"}
                    </button>
                  </div>
                  <div className="mt-2 max-h-64 space-y-2 overflow-y-auto">
                    {(threads[item.id] ?? []).map((m) => (
                      <div key={m.id} className="rounded-md bg-background p-2">
                        <p className="text-[10px] font-bold uppercase text-muted-foreground">
                          {m.sender_role === "customer_care"
                            ? "LocalShore Customer Care"
                            : m.sender_role.replaceAll("_", " ")}
                        </p>
                        <p className="whitespace-pre-wrap text-sm">{m.body}</p>
                        {m.attachments?.map((path) => (
                          <button
                            key={path}
                            className="mt-1 block text-xs text-primary underline"
                            onClick={() => void openAttachment(path)}
                          >
                            View private attachment
                          </button>
                        ))}
                        <time className="text-[10px] text-muted-foreground">
                          {new Date(m.created_at).toLocaleString()}
                        </time>
                      </div>
                    ))}
                    {threads[item.id]?.length === 0 && (
                      <p className="text-xs text-muted-foreground">No messages yet.</p>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <input
                    value={reply[item.id] ?? ""}
                    onChange={(e) => setReply((v) => ({ ...v, [item.id]: e.target.value }))}
                    placeholder="Message LocalShore Customer Care privately…"
                    maxLength={2000}
                    className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm"
                  />
                  <Button size="sm" onClick={() => void send(item.id)}>
                    Send to Customer Care
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void resolution(item.id, "replacement")}
                  >
                    Propose replacement to Care
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void resolution(item.id, "refund_request")}
                  >
                    Request refund review
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      void call(item.id, "escalate_vendor_support_case", {
                        p_note: "Vendor requested LocalShore Customer Care assistance.",
                      })
                    }
                  >
                    Escalate to LocalShore
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Your replies and proposals go to LocalShore Customer Care first. Care decides what
                  is shared with the customer. Refund proposals never trigger a payment.
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </main>
  );
}
