import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { CheckCircle2, Clock, Download, Loader2, Wallet } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";

import { useMySeller } from "@/modules/seller/services/profile";
import {
  useMySettlements,
  useMyFinancialAdjustments,
  type CycleSummary,
} from "@/modules/seller/services/settlements";

export const Route = createFileRoute("/seller/settlements")({
  head: () => ({
    meta: [
      { title: "Settlements — Seller Hub" },
      {
        name: "description",
        content: "Weekly payout cycles, fee breakdown and transaction history.",
      },
      { property: "og:title", content: "Settlements — Seller Hub" },
      {
        property: "og:description",
        content: "Weekly payout cycles, fee breakdown and transaction history.",
      },
    ],
  }),
  component: SettlementsPage,
});

const INR = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
const fmt = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

function SettlementsPage() {
  const sellerQ = useMySeller();
  const q = useMySettlements();
  const [open, setOpen] = useState<CycleSummary | null>(null);
  const cycles = q.data ?? [];
  const seller = sellerQ.data;
  const adjustmentsQ = useMyFinancialAdjustments(seller?.id);
  const adjustments = adjustmentsQ.data?.rows ?? [];

  const summary = useMemo(() => {
    const paid = cycles.filter((c) => c.status === "paid");
    const processing = cycles.filter((c) => c.status === "processing" || c.status === "pending");
    const held = cycles.filter((c) => c.status === "held");
    return {
      lifetime: cycles.reduce((s, c) => s + c.net, 0),
      paid: paid.reduce((s, c) => s + c.net, 0),
      processing: processing.reduce((s, c) => s + (c.currentPayable ?? c.net), 0),
      held: held.reduce((s, c) => s + (c.currentPayable ?? c.net), 0),
      failed: cycles
        .filter((c) => c.status === "failed")
        .reduce((s, c) => s + (c.currentPayable ?? c.net), 0),
      feesTotal: cycles.reduce((s, c) => s + c.commission + c.gstOnFees + c.codFees, 0),
      refundDeductions: cycles.reduce((s, c) => s + (c.refundDeductions ?? 0), 0),
    };
  }, [cycles]);

  return (
    <div className="mx-auto max-w-6xl space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold">Payments & Settlements</h1>
        <p className="text-sm text-muted-foreground">
          Payouts to{" "}
          <span className="font-medium">{seller?.bank.holderName || "your account"}</span>
          {seller?.bank.accountNumber ? ` • ****${seller.bank.accountNumber.slice(-4)}` : ""}
          {seller?.bank.ifsc ? ` • ${seller.bank.ifsc}` : ""}
        </p>
      </div>

      {q.isLoading ? (
        <div className="py-8 text-center">
          <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 stagger">
            <StatTile
              label="Lifetime earnings"
              value={INR(summary.lifetime)}
              icon={<Wallet className="h-4 w-4" />}
            />
            <StatTile
              label="Paid out"
              value={INR(summary.paid)}
              icon={<CheckCircle2 className="h-4 w-4" />}
              tone="success"
            />
            <StatTile
              label="Processing"
              value={INR(summary.processing)}
              icon={<Clock className="h-4 w-4" />}
              tone="primary"
            />
            <StatTile
              label="On hold"
              value={INR(summary.held)}
              icon={<Clock className="h-4 w-4" />}
            />
            <StatTile
              label="Refund deductions"
              value={INR(summary.refundDeductions)}
              icon={<Wallet className="h-4 w-4" />}
            />
            <StatTile
              label="Failed payout amount"
              value={INR(summary.failed)}
              icon={<Clock className="h-4 w-4" />}
              tone="danger"
            />
          </div>

          <p className="text-xs text-muted-foreground">
            Fees are the values recorded on settlement statements. A future payout date and
            order-level allocation are not available in the current settlement schema.
          </p>
          {adjustmentsQ.data?.available === false ? (
            <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
              Refund adjustment details are not available until the Phase C accounting migration is
              installed.
            </p>
          ) : null}
          {adjustmentsQ.data?.available && adjustments.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Refund adjustments</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {adjustments.map((adjustment) => (
                  <div
                    key={adjustment.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm"
                  >
                    <div>
                      <div className="font-medium">{adjustmentLabel(adjustment.status)}</div>
                      <div className="text-xs text-muted-foreground">
                        Order {adjustment.orderId.slice(0, 8)} · {fmt(adjustment.createdAt)}
                      </div>
                    </div>
                    <span className="font-mono font-semibold">− {INR(adjustment.amount)}</span>
                  </div>
                ))}
                <p className="text-xs text-muted-foreground">
                  Paid settlement amounts are preserved. Recovery due or unallocated adjustments
                  require finance review; no automatic bank recovery is performed.
                </p>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Settlement cycles</CardTitle>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="all">
                <TabsList>
                  <TabsTrigger value="all">All ({cycles.length})</TabsTrigger>
                  <TabsTrigger value="paid">
                    Paid ({cycles.filter((c) => c.status === "paid").length})
                  </TabsTrigger>
                  <TabsTrigger value="processing">
                    Pending / processing (
                    {
                      cycles.filter((c) => c.status === "processing" || c.status === "pending")
                        .length
                    }
                    )
                  </TabsTrigger>
                  <TabsTrigger value="failed">
                    Failed ({cycles.filter((c) => c.status === "failed").length})
                  </TabsTrigger>
                </TabsList>
                {(["all", "paid", "processing", "failed"] as const).map((tab) => (
                  <TabsContent key={tab} value={tab} className="mt-4">
                    <CyclesTable
                      cycles={
                        tab === "all"
                          ? cycles
                          : tab === "paid"
                            ? cycles.filter((c) => c.status === "paid")
                            : tab === "failed"
                              ? cycles.filter((c) => c.status === "failed")
                              : cycles.filter(
                                  (c) => c.status === "processing" || c.status === "pending",
                                )
                      }
                      onOpen={setOpen}
                    />
                  </TabsContent>
                ))}
              </Tabs>
            </CardContent>
          </Card>
        </>
      )}

      <Sheet open={!!open} onOpenChange={(v) => !v && setOpen(null)}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
          {open && (
            <>
              <SheetHeader>
                <SheetTitle>Settlement {fmt(open.cycleStart)}</SheetTitle>
                <SheetDescription>
                  {fmt(open.cycleStart)} – {fmt(open.cycleEnd)}
                  {open.payoutDate
                    ? ` · Paid ${fmt(open.payoutDate)}`
                    : " · No payout date recorded"}
                </SheetDescription>
              </SheetHeader>
              <div className="mt-4 grid grid-cols-3 gap-2 text-sm">
                <MiniStat label="Gross" value={INR(open.gross)} />
                <MiniStat
                  label="Fees"
                  value={"- " + INR(open.commission + open.gstOnFees + open.codFees)}
                />
                <MiniStat label="Net payout" value={INR(open.net)} tone="primary" />
              </div>
              {(open.refundDeductions ?? 0) > 0 || (open.recoveryDue ?? 0) > 0 ? (
                <div className="mt-3 rounded-lg border p-3 text-sm">
                  {(open.refundDeductions ?? 0) > 0 ? (
                    <div className="flex justify-between">
                      <span>Successful refund deductions</span>
                      <span>− {INR(open.refundDeductions ?? 0)}</span>
                    </div>
                  ) : null}
                  {open.status !== "paid" ? (
                    <div className="mt-1 flex justify-between font-semibold">
                      <span>Payable after refunds</span>
                      <span>{INR(open.currentPayable ?? open.net)}</span>
                    </div>
                  ) : null}
                  {(open.recoveryDue ?? 0) > 0 ? (
                    <div className="mt-1 flex justify-between text-amber-700">
                      <span>Recovery review due (paid cycle preserved)</span>
                      <span>{INR(open.recoveryDue ?? 0)}</span>
                    </div>
                  ) : null}
                </div>
              ) : null}
              <div className="mt-6">
                <div className="mb-2 text-sm font-medium">Order allocation</div>
                {open.txns.length === 0 ? (
                  <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                    Order-level settlement allocations are not stored yet. This statement shows only
                    the persisted cycle totals.
                  </p>
                ) : (
                  <div className="rounded-lg border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Order</TableHead>
                          <TableHead className="text-right">Gross</TableHead>
                          <TableHead className="text-right">Fees</TableHead>
                          <TableHead className="text-right">Net</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {open.txns.map((t) => (
                          <TableRow key={t.orderId}>
                            <TableCell>
                              <div className="font-medium">{t.orderNumber}</div>
                              <div className="text-xs text-muted-foreground">{t.paymentMode}</div>
                            </TableCell>
                            <TableCell className="text-right">{INR(t.gross)}</TableCell>
                            <TableCell className="text-right text-muted-foreground">
                              - {INR(t.commission + t.gstOnFees + t.codFee)}
                            </TableCell>
                            <TableCell className="text-right font-medium">{INR(t.net)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
              <div className="mt-6 flex justify-end">
                <Button variant="outline" onClick={() => downloadCsv(open)}>
                  <Download className="h-4 w-4" /> Download CSV
                </Button>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function CyclesTable({
  cycles,
  onOpen,
}: {
  cycles: CycleSummary[];
  onOpen: (c: CycleSummary) => void;
}) {
  if (!cycles.length)
    return (
      <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
        No settlements in this view yet. Deliver orders to see payouts here.
      </div>
    );
  return (
    <div className="rounded-lg border overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Cycle</TableHead>
            <TableHead>Period</TableHead>
            <TableHead className="text-right">Orders</TableHead>
            <TableHead className="text-right">Gross</TableHead>
            <TableHead className="text-right">Fees</TableHead>
            <TableHead className="text-right">Net</TableHead>
            <TableHead>Paid date</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {cycles.map((c) => (
            <TableRow
              key={c.cycleStart}
              className="cursor-pointer hover:bg-muted/40"
              onClick={() => onOpen(c)}
            >
              <TableCell className="font-medium">{fmt(c.cycleStart).slice(0, 6)}</TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {fmt(c.cycleStart)} – {fmt(c.cycleEnd)}
              </TableCell>
              <TableCell className="text-right">{c.txns.length}</TableCell>
              <TableCell className="text-right">{INR(c.gross)}</TableCell>
              <TableCell className="text-right text-muted-foreground">
                - {INR(c.commission + c.gstOnFees + c.codFees)}
              </TableCell>
              <TableCell className="text-right font-semibold">
                {INR(c.currentPayable ?? c.net)}
              </TableCell>
              <TableCell className="text-xs">{c.payoutDate ? fmt(c.payoutDate) : "—"}</TableCell>
              <TableCell>
                <Badge
                  className={
                    c.status === "paid"
                      ? "bg-success text-success-foreground"
                      : c.status === "held"
                        ? "bg-destructive/15 text-destructive"
                        : c.status === "failed"
                          ? "bg-destructive/15 text-destructive"
                          : "bg-accent text-accent-foreground"
                  }
                >
                  {c.status === "held" ? "On hold" : c.status}
                </Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function StatTile({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  tone?: "primary" | "success" | "danger";
}) {
  return (
    <Card className="hover-lift">
      <CardContent className="flex items-start justify-between py-4">
        <div>
          <div className="text-xs uppercase text-muted-foreground">{label}</div>
          <div
            className={
              "mt-1 text-2xl font-bold " +
              (tone === "primary"
                ? "text-primary"
                : tone === "success"
                  ? "text-success"
                  : tone === "danger"
                    ? "text-destructive"
                    : "")
            }
          >
            {value}
          </div>
        </div>
        <div
          className={
            "grid h-9 w-9 place-items-center rounded-lg " +
            (tone === "success"
              ? "bg-success/10 text-success"
              : tone === "danger"
                ? "bg-destructive/10 text-destructive"
                : "bg-primary/10 text-primary")
          }
        >
          {icon}
        </div>
      </CardContent>
    </Card>
  );
}
function MiniStat({ label, value, tone }: { label: string; value: string; tone?: "primary" }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={"mt-1 font-semibold " + (tone === "primary" ? "text-primary" : "")}>
        {value}
      </div>
    </div>
  );
}
function adjustmentLabel(status: string) {
  switch (status) {
    case "deduct_before_payout":
      return "Deducted before payout";
    case "recovery_due":
      return "Recovery review due";
    case "unallocated":
      return "Unallocated · finance review needed";
    case "recovered":
      return "Resolved";
    default:
      return "Refund adjustment";
  }
}
function downloadCsv(c: CycleSummary) {
  const rows = [
    [
      "Settlement ID",
      "Cycle Start",
      "Cycle End",
      "Gross",
      "Commission",
      "GST on Fees",
      "Net",
      "Refund deductions",
      "Current payable",
      "Recovery due",
      "Status",
      "Paid At",
    ],
    [
      c.id,
      c.cycleStart,
      c.cycleEnd,
      c.gross,
      c.commission,
      c.gstOnFees,
      c.net,
      c.refundDeductions ?? 0,
      c.currentPayable ?? c.net,
      c.recoveryDue ?? 0,
      c.status,
      c.payoutDate ?? "",
    ],
  ];
  const csv = rows.map((r) => r.join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "STL-" + c.cycleStart.slice(0, 10) + ".csv";
  a.click();
  URL.revokeObjectURL(url);
}
