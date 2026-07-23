import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Search, ShoppingBag } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/shop")({
  head: () => ({
    meta: [
      { title: "Shop — Browse products" },
      { name: "description", content: "Browse approved products from verified sellers." },
      { property: "og:title", content: "Shop — Browse products" },
      { property: "og:description", content: "Browse approved products from verified sellers." },
    ],
  }),
  component: Shop,
  errorComponent: ({ error }) => <div role="alert" className="p-8">{error.message}</div>,
  notFoundComponent: () => <div className="p-8">Not found.</div>,
});

type P = { id: string; name: string; category: string | null; brand: string | null; selling_price: number; mrp: number; image_url: string | null; stock: number };

function Shop() {
  const [q, setQ] = useState("");
  const query = useQuery<P[]>({
    queryKey: ["shop", "active-products"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("products")
        .select("id, name, category, brand, selling_price, mrp, image_url, stock")
        .eq("status", "active")
        .order("created_at", { ascending: false });
      if (error) throw error;
      const rows = (data ?? []) as P[];
      const paths = rows.map(r => r.image_url).filter((v): v is string => !!v && !/^https?:\/\//i.test(v));
      if (paths.length) {
        const { data: signed } = await supabase.storage.from("product-images").createSignedUrls(paths, 3600);
        const sm = new Map((signed ?? []).map((s: any) => [s.path, s.signedUrl]));
        rows.forEach(r => { if (r.image_url && sm.has(r.image_url)) r.image_url = sm.get(r.image_url)!; });
      }
      return rows;
    },
    staleTime: 30_000,
  });

  const rows = (query.data ?? []).filter(p => {
    if (!q.trim()) return true;
    const s = q.toLowerCase();
    return (p.name + " " + (p.category || "") + " " + (p.brand || "")).toLowerCase().includes(s);
  });

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link to="/" className="flex items-center gap-2 font-bold">
            <ShoppingBag className="h-5 w-5 text-primary" /> Marketplace
          </Link>
          <Link to="/auth"><Button size="sm" variant="outline">Sign in</Button></Link>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-black sm:text-3xl">Shop</h1>
            <p className="text-sm text-muted-foreground">All products approved by our admin team.</p>
          </div>
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search products, brands" className="pl-8 h-9" value={q} onChange={e => setQ(e.target.value)} />
          </div>
        </div>

        {query.isLoading ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-64 animate-pulse rounded-xl bg-muted" />)}
          </div>
        ) : rows.length === 0 ? (
          <Card><CardContent className="grid place-items-center py-20 text-center">
            <ShoppingBag className="mb-3 h-10 w-10 text-muted-foreground" />
            <p className="font-semibold">No products available yet</p>
            <p className="mt-1 text-sm text-muted-foreground">Approved products from verified sellers will appear here.</p>
          </CardContent></Card>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {rows.map((p, i) => {
              const off = p.mrp > p.selling_price ? Math.round(((p.mrp - p.selling_price) / p.mrp) * 100) : 0;
              return (
                <Card
                  key={p.id}
                  className="group overflow-hidden hover-lift animate-fade-in-up"
                  style={{ animationDelay: `${Math.min(i, 12) * 40}ms` }}
                >
                  <div className="aspect-square overflow-hidden bg-muted">
                    {p.image_url
                      ? <img src={p.image_url} alt={p.name} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" loading="lazy" />
                      : <div className="grid h-full w-full place-items-center text-xs text-muted-foreground">No image</div>}
                  </div>
                  <CardContent className="space-y-1 p-3">
                    <div className="truncate text-sm font-semibold">{p.name}</div>
                    <div className="truncate text-xs text-muted-foreground">{p.brand || p.category || "—"}</div>
                    <div className="flex items-baseline gap-2 pt-1">
                      <span className="text-base font-bold">₹{Number(p.selling_price).toLocaleString("en-IN")}</span>
                      {off > 0 && <>
                        <span className="text-xs text-muted-foreground line-through">₹{Number(p.mrp).toLocaleString("en-IN")}</span>
                        <Badge className="ml-auto bg-accent text-accent-foreground">{off}% off</Badge>
                      </>}
                    </div>
                    {p.stock <= 0 && <Badge variant="destructive" className="mt-1">Out of stock</Badge>}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
