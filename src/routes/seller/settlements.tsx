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

import { useMySeller, useMySettlements, type CycleSummary } from "@/lib/db";

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

  const summary = useMemo(() => {
    const paid = cycles.filter((c) => c.status === "paid");
    const processing = cycles.filter((c) => c.status === "processing");
    return {
      lifetime: paid.reduce((s, c) => s + c.net, 0) + processing.reduce((s, c) => s + c.net, 0),
      paid: paid.reduce((s, c) => s + c.net, 0),
      processing: processing.reduce((s, c) => s + c.net, 0),
      feesTotal: cycles.reduce((s, c) => s + c.commission + c.gstOnFees + c.codFees, 0),
      next: processing[0] ?? null,
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
              label="Total fees"
              value={INR(summary.feesTotal)}
              icon={<Wallet className="h-4 w-4" />}
            />
          </div>

          {summary.next && (
            <Card className="border-primary/40 bg-primary/5">
              <CardContent className="flex flex-wrap items-center justify-between gap-4 py-4">
                <div>
                  <div className="text-xs uppercase text-muted-foreground">Next payout</div>
                  <div className="text-lg font-semibold">{INR(summary.next.net)}</div>
                  <div className="text-xs text-muted-foreground">
                    Scheduled {fmt(summary.next.payoutDate)} • {summary.next.txns.length} order(s)
                  </div>
                </div>
                <Badge variant="secondary" className="bg-accent text-accent-foreground">
                  Processing
                </Badge>
              </CardContent>
            </Card>
          )}

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
                    Processing ({cycles.filter((c) => c.status === "processing").length})
                  </TabsTrigger>
                </TabsList>
                {(["all", "paid", "processing"] as const).map((tab) => (
                  <TabsContent key={tab} value={tab} className="mt-4">
                    <CyclesTable
                      cycles={tab === "all" ? cycles : cycles.filter((c) => c.status === tab)}
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
                  {fmt(open.cycleStart)} – {fmt(open.cycleEnd)} • Payout {fmt(open.payoutDate)}
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
              <div className="mt-6">
                <div className="mb-2 text-sm font-medium">Transactions</div>
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
            <TableHead>Payout</TableHead>
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
              <TableCell className="text-right font-semibold">{INR(c.net)}</TableCell>
              <TableCell className="text-xs">{fmt(c.payoutDate)}</TableCell>
              <TableCell>
                {c.status === "paid" ? (
                  <Badge className="bg-success text-success-foreground">Paid</Badge>
                ) : (
                  <Badge className="bg-accent text-accent-foreground">Processing</Badge>
                )}
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
  tone?: "primary" | "success";
}) {
  return (
    <Card className="hover-lift">
      <CardContent className="flex items-start justify-between py-4">
        <div>
          <div className="text-xs uppercase text-muted-foreground">{label}</div>
          <div
            className={
              "mt-1 text-2xl font-bold " +
              (tone === "primary" ? "text-primary" : tone === "success" ? "text-success" : "")
            }
          >
            {value}
          </div>
        </div>
        <div
          className={
            "grid h-9 w-9 place-items-center rounded-lg " +
            (tone === "success" ? "bg-success/10 text-success" : "bg-primary/10 text-primary")
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
function downloadCsv(c: CycleSummary) {
  const rows = [
    ["Order", "Date", "Payment Mode", "Gross", "Commission", "GST on Fees", "COD Fee", "Net"],
    ...c.txns.map((t) => [
      t.orderNumber,
      new Date(t.date).toISOString(),
      t.paymentMode,
      t.gross,
      t.commission,
      t.gstOnFees,
      t.codFee,
      t.net,
    ]),
  ];
  const csv = rows.map((r) => r.join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "STL-" + c.cycleStart.slice(0, 10) + ".csv";
  a.click();
  URL.revokeObjectURL(url);
}
