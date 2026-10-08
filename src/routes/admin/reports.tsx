import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import { useAdminOverview } from "@/modules/admin/services/admin-db";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/reports")({
  head: () => ({ meta: [{ title: "Reports — Admin" }, { name: "robots", content: "noindex" }] }),
  component: ReportsPage,
});

function toCsv(rows: Record<string, any>[]) {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]);
  return [
    cols.join(","),
    ...rows.map((r) => cols.map((c) => JSON.stringify(r[c] ?? "")).join(",")),
  ].join("\n");
}
function download(name: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function ReportsPage() {
  const { data } = useAdminOverview();
  const reports = useMemo(() => {
    if (!data) return [];
    const availableReports = [
      data.available.orders
        ? {
            name: "Sales Report",
            rows: data.orders.map((o) => ({
              id: o.id,
              buyer: o.buyer_name,
              total: o.total,
              status: o.status,
              date: o.created_at,
            })),
          }
        : null,
      data.available.sellers
        ? {
            name: "Vendor Report",
            rows: data.sellers.map((v) => ({
              id: v.id,
              shop: v.shop_name,
              owner: v.owner_name,
              status: v.status,
              joined: v.created_at,
            })),
          }
        : null,
      data.available.products
        ? {
            name: "Product Report",
            rows: data.products.map((p) => ({
              id: p.id,
              name: p.name,
              category: p.category,
              price: p.selling_price,
              stock: p.stock,
              status: p.status,
            })),
          }
        : null,
      data.available.products
        ? {
            name: "Inventory Report",
            rows: data.products.map((p) => ({
              id: p.id,
              name: p.name,
              stock: p.stock,
              status: p.status,
            })),
          }
        : null,
    ];
    return availableReports.filter(
      (report): report is NonNullable<typeof report> => report !== null,
    );
  }, [data]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-black tracking-tight sm:text-3xl">Reports</h1>
        <p className="text-sm text-muted-foreground">Download marketplace reports in CSV.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 stagger">
        {reports.map((r) => (
          <Card key={r.name} className="hover-lift">
            <CardHeader>
              <CardTitle className="text-base">{r.name}</CardTitle>
            </CardHeader>
            <CardContent className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">{r.rows.length} rows</span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  download(`${r.name.replace(/ /g, "-").toLowerCase()}.csv`, toCsv(r.rows));
                  toast.success("Downloaded");
                }}
                className="gap-1"
              >
                <Download className="h-4 w-4" />
                CSV
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
      {reports.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No reports are available for your current permissions and data.
          </CardContent>
        </Card>
      ) : null}
      <p className="text-xs text-muted-foreground">
        PDF / Excel exports can be added by wiring xlsx or jspdf; CSV covers the same data.
      </p>
    </div>
  );
}
