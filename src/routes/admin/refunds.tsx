import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { useAdminAccess, adminErrorMessage } from "@/shared/auth/admin-permissions";
import { ChevronLeft, ChevronRight, RotateCcw } from "lucide-react";

export const Route = createFileRoute("/admin/refunds")({
  head: () => ({ meta: [{ title: "Refunds — Admin" }, { name: "robots", content: "noindex" }] }),
  component: RefundsPage,
});
type RefundRow = {
  id: string;
  order_id: string;
  payment_attempt_id: string | null;
  seller_id: string;
  store_id: string | null;
  amount: number;
  reason_code: string;
  reason: string | null;
  status: string;
  payment_method: string;
  execution_method: string;
  gateway_refund_id: string | null;
  manual_reference: string | null;
  requested_at: string;
  failure_reason: string | null;
};
const money = (value: number) =>
  `₹${Number(value).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

function RefundsPage() {
  const access = useAdminAccess();
  const qc = useQueryClient();
  const canManage = access.hasPermission("refunds.manage");
  const canApprove = access.hasPermission("refunds.approve");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(0);
  const [references, setReferences] = useState<Record<string, string>>({});
  const q = useQuery({
    queryKey: ["admin", "refunds"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("refunds")
        .select(
          "id,order_id,payment_attempt_id,seller_id,store_id,amount,reason_code,reason,status,payment_method,execution_method,gateway_refund_id,manual_reference,requested_at,failure_reason",
        )
        .order("requested_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as RefundRow[];
    },
  });
  const decision = useMutation({
    mutationFn: async ({ id, action, reason }: { id: string; action: string; reason?: string }) => {
      const { error } = await (supabase as any).rpc("admin_transition_refund", {
        p_refund_id: id,
        p_action: action,
        p_reason: reason ?? null,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Refund decision recorded.");
      await qc.invalidateQueries({ queryKey: ["admin", "refunds"] });
    },
    onError: (error) =>
      toast.error(adminErrorMessage(error, "Refund action could not be completed.")),
  });
  const manual = useMutation({
    mutationFn: async ({ id, reference }: { id: string; reference: string }) => {
      const { error } = await (supabase as any).rpc("record_manual_cod_refund", {
        p_refund_id: id,
        p_reference: reference,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Manual COD reimbursement recorded.");
      await qc.invalidateQueries({ queryKey: ["admin", "refunds"] });
    },
    onError: (error) =>
      toast.error(adminErrorMessage(error, "Manual reimbursement could not be recorded.")),
  });
  const filtered = useMemo(
    () =>
      (q.data ?? []).filter(
        (r) =>
          (status === "all" || r.status === status) &&
          `${r.id} ${r.order_id} ${r.seller_id} ${r.reason_code} ${r.reason ?? ""}`
            .toLowerCase()
            .includes(search.toLowerCase()),
      ),
    [q.data, search, status],
  );
  const pageRows = filtered.slice(page * 25, page * 25 + 25);
  const act = (refund: RefundRow, action: string) => {
    let reason: string | undefined;
    if (action === "reject") {
      const response = window.prompt("Reason for rejection (required)");
      if (response === null) return;
      reason = response.trim();
      if (!reason) {
        toast.error("A rejection reason is required.");
        return;
      }
    }
    if (
      !window.confirm(
        `${action === "approve" ? "Approve" : action === "reject" ? "Reject" : "Move to review"} refund ${refund.id.slice(0, 8)} for ${money(refund.amount)}?`,
      )
    )
      return;
    decision.mutate({ id: refund.id, action, reason });
  };

  return (
    <main className="space-y-5">
      <header>
        <h1 className="text-2xl font-black tracking-tight sm:text-3xl">Refunds</h1>
        <p className="text-sm text-muted-foreground">
          Review customer refund requests. Approval is not a payment execution; gateway refund
          processing is not configured.
        </p>
      </header>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
          placeholder="Search refund, order, seller, reason"
          aria-label="Search refunds"
        />
        <Select
          value={status}
          onValueChange={(v) => {
            setStatus(v);
            setPage(0);
          }}
        >
          <SelectTrigger className="sm:w-56">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {[
              "requested",
              "reviewing",
              "approved",
              "processing",
              "refunded",
              "partially_refunded",
              "failed",
              "rejected",
              "cancelled",
            ].map((v) => (
              <SelectItem value={v} key={v}>
                {v.replaceAll("_", " ")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {q.isError ? (
        <Card>
          <CardContent className="p-5 text-sm text-destructive">
            {adminErrorMessage(
              q.error,
              "Refund requests could not be loaded. The Phase C migration may still be pending.",
            )}
          </CardContent>
        </Card>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <RotateCcw className="h-4 w-4" />
            Refund requests{" "}
            <span className="text-xs font-normal text-muted-foreground">({filtered.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 p-3 sm:p-5">
          {q.isLoading ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Loading refunds…</p>
          ) : !pageRows.length ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No refund requests match these filters.
            </p>
          ) : (
            pageRows.map((r) => (
              <article key={r.id} className="space-y-3 rounded-lg border p-3 sm:p-4">
                <div className="flex flex-wrap items-start gap-2">
                  <div className="mr-auto min-w-0">
                    <p className="font-semibold">
                      {money(r.amount)} · Order #{r.order_id.slice(0, 8)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Seller #{r.seller_id.slice(0, 8)}
                      {r.store_id ? ` · Store #${r.store_id.slice(0, 8)}` : ""} ·{" "}
                      {r.payment_method.toUpperCase()} ·{" "}
                      {new Date(r.requested_at).toLocaleString("en-IN")}
                    </p>
                  </div>
                  <Badge variant="outline" className="capitalize">
                    {r.status.replaceAll("_", " ")}
                  </Badge>
                </div>
                <p className="text-sm">
                  <span className="font-medium">{r.reason_code.replaceAll("_", " ")}</span>
                  {r.reason ? ` — ${r.reason}` : ""}
                </p>
                <p className="text-xs text-muted-foreground">
                  {r.execution_method === "gateway"
                    ? r.gateway_refund_id
                      ? `Gateway reference: ${r.gateway_refund_id}`
                      : "Gateway execution is not configured; approval will remain pending processing."
                    : r.manual_reference
                      ? `Manual reimbursement ref: ${r.manual_reference}`
                      : "COD reimbursement requires a real offline/manual reference."}
                  {r.failure_reason ? ` · ${r.failure_reason}` : ""}
                </p>
                {canManage && ["requested", "reviewing"].includes(r.status) && (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={decision.isPending}
                      onClick={() => act(r, "review")}
                    >
                      Mark reviewing
                    </Button>
                    {canApprove && (
                      <>
                        <Button
                          size="sm"
                          disabled={decision.isPending}
                          onClick={() => act(r, "approve")}
                        >
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={decision.isPending}
                          onClick={() => act(r, "reject")}
                        >
                          Reject
                        </Button>
                      </>
                    )}
                  </div>
                )}
                {canManage &&
                  canApprove &&
                  r.payment_method === "cod" &&
                  r.status === "approved" && (
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Input
                        value={references[r.id] ?? ""}
                        maxLength={160}
                        onChange={(e) => setReferences((v) => ({ ...v, [r.id]: e.target.value }))}
                        placeholder="Verified manual reimbursement reference"
                        aria-label="Manual reimbursement reference"
                      />
                      <Button
                        disabled={!references[r.id]?.trim() || manual.isPending}
                        onClick={() => {
                          if (
                            window.confirm(
                              "Record that the COD reimbursement was actually paid outside LocalShore?",
                            )
                          )
                            manual.mutate({ id: r.id, reference: references[r.id].trim() });
                        }}
                      >
                        Record manual reimbursement
                      </Button>
                    </div>
                  )}
              </article>
            ))
          )}
          <div className="flex items-center justify-between border-t pt-3">
            <span className="text-xs text-muted-foreground">
              Page {page + 1} of {Math.max(1, Math.ceil(filtered.length / 25))}
            </span>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={page === 0}
                onClick={() => setPage((n) => n - 1)}
              >
                <ChevronLeft className="h-4 w-4" />
                Previous
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={(page + 1) * 25 >= filtered.length}
                onClick={() => setPage((n) => n + 1)}
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
