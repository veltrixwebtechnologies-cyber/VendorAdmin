import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AlertTriangle, Box, Loader2, Minus, Plus, Save } from "lucide-react";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";

import { useAuth } from "@/lib/auth";
import { listProducts, type ProductDto } from "@/lib/products.functions";
import { useUpdateProductStock } from "@/lib/db";

export const Route = createFileRoute("/seller/inventory")({
  head: () => ({
    meta: [
      { title: "Inventory — Seller Hub" },
      { name: "description", content: "Stock levels and low-stock alerts." },
      { property: "og:title", content: "Inventory — Seller Hub" },
      { property: "og:description", content: "Stock levels and low-stock alerts." },
    ],
  }),
  component: InventoryPage,
});

function InventoryPage() {
  const { user } = useAuth();
  const list = useServerFn(listProducts);
  const q = useQuery<ProductDto[]>({
    queryKey: ["products", user?.id],
    queryFn: () => list() as Promise<ProductDto[]>,
    enabled: !!user,
  });
  const products = q.data ?? [];
  const updateStock = useUpdateProductStock();

  const [drafts, setDrafts] = useState<Record<string, number>>({});
  const [onlyLow, setOnlyLow] = useState(false);

  const rows = useMemo(
    () => (onlyLow ? products.filter((p) => p.stock <= p.lowStockAt) : products),
    [products, onlyLow],
  );
  const summary = useMemo(() => {
    const totalUnits = products.reduce((s, p) => s + p.stock, 0);
    const outOfStock = products.filter((p) => p.stock === 0).length;
    const low = products.filter((p) => p.stock > 0 && p.stock <= p.lowStockAt).length;
    return { totalUnits, outOfStock, low };
  }, [products]);

  function draftValue(id: string, current: number) {
    return drafts[id] ?? current;
  }
  function bump(id: string, current: number, delta: number) {
    const v = Math.max(0, draftValue(id, current) + delta);
    setDrafts((d) => ({ ...d, [id]: v }));
  }
  async function commit(id: string, current: number) {
    const v = draftValue(id, current);
    if (v === current) return;
    try {
      await updateStock.mutateAsync({ id, stock: v });
      setDrafts((d) => {
        const { [id]: _dropped, ...rest } = d;
        void _dropped;
        return rest;
      });
      toast.success("Stock updated");
    } catch (e: any) {
      toast.error(e?.message ?? "Failed");
    }
  }
  async function setLowAt(id: string, v: number) {
    try {
      await updateStock.mutateAsync({ id, lowStockAt: v });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed");
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Inventory</h1>
        <p className="text-sm text-muted-foreground">
          Update stock levels and configure low-stock alerts.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Total units"
          value={summary.totalUnits}
          icon={<Box className="h-4 w-4" />}
        />
        <StatCard
          label="Low stock"
          value={summary.low}
          icon={<AlertTriangle className="h-4 w-4 text-accent-foreground" />}
        />
        <StatCard
          label="Out of stock"
          value={summary.outOfStock}
          tone="destructive"
          icon={<AlertTriangle className="h-4 w-4" />}
        />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle>Stock levels</CardTitle>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
            <Switch checked={onlyLow} onCheckedChange={setOnlyLow} /> Only show low-stock
          </label>
        </CardHeader>
        <CardContent>
          {q.isLoading ? (
            <div className="py-8 text-center">
              <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : rows.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              {onlyLow ? "No low-stock items — great job!" : "No products yet."}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead className="w-[200px]">Stock</TableHead>
                    <TableHead className="w-[140px]">Low-stock at</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Save</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((p) => {
                    const current = draftValue(p.id, p.stock);
                    const dirty = current !== p.stock;
                    const low = current <= p.lowStockAt;
                    const out = current === 0;
                    return (
                      <TableRow key={p.id} className="animate-fade-in">
                        <TableCell>
                          <div className="font-medium">{p.name}</div>
                          <div className="text-xs text-muted-foreground">{p.category}</div>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{p.sku}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Button
                              size="icon"
                              variant="outline"
                              className="h-8 w-8"
                              onClick={() => bump(p.id, p.stock, -1)}
                            >
                              <Minus className="h-3.5 w-3.5" />
                            </Button>
                            <Input
                              type="number"
                              min={0}
                              value={current}
                              onChange={(e) =>
                                setDrafts((d) => ({
                                  ...d,
                                  [p.id]: Math.max(0, Number(e.target.value) || 0),
                                }))
                              }
                              className="h-8 w-20 text-center"
                            />
                            <Button
                              size="icon"
                              variant="outline"
                              className="h-8 w-8"
                              onClick={() => bump(p.id, p.stock, 1)}
                            >
                              <Plus className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            min={0}
                            defaultValue={p.lowStockAt}
                            onBlur={(e) => {
                              const v = Math.max(0, Number(e.target.value) || 0);
                              if (v !== p.lowStockAt) setLowAt(p.id, v);
                            }}
                            className="h-8 w-24"
                          />
                        </TableCell>
                        <TableCell>
                          {out ? (
                            <Badge className="bg-destructive text-destructive-foreground">
                              Out of stock
                            </Badge>
                          ) : low ? (
                            <Badge className="bg-accent text-accent-foreground">Low</Badge>
                          ) : (
                            <Badge className="bg-success text-success-foreground">In stock</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant={dirty ? "default" : "ghost"}
                            disabled={!dirty || updateStock.isPending}
                            onClick={() => commit(p.id, p.stock)}
                          >
                            <Save className="h-3.5 w-3.5" />
                            {dirty ? "Save" : "Saved"}
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  tone?: "destructive";
}) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between py-4">
        <div>
          <div className="text-xs uppercase text-muted-foreground">{label}</div>
          <div
            className={
              "mt-1 text-2xl font-bold " + (tone === "destructive" ? "text-destructive" : "")
            }
          >
            {value}
          </div>
        </div>
        <div
          className={
            "grid h-9 w-9 place-items-center rounded-lg " +
            (tone === "destructive"
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
