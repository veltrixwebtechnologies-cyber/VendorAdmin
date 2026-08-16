import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/* ============================================================
 * Product server functions — Supabase backed.
 * All calls run as the signed-in user; RLS scopes rows to them.
 * ============================================================ */

const productInput = z.object({
  name: z.string().trim().min(1).max(200),
  sku: z.string().trim().min(1).max(80),
  category: z.string().trim().min(1).max(80),
  brand: z.string().trim().max(120).optional().default(""),
  description: z.string().max(4000).optional().default(""),
  mrp: z.number().min(0),
  price: z.number().min(0),
  stock: z.number().int().min(0),
  lowStockAt: z.number().int().min(0).default(5),
  imageUrl: z.string().max(500).optional().nullable(),
});

export type ProductInput = z.infer<typeof productInput>;

const SIGNED_URL_TTL = 60 * 60; // 1 hour

async function ensureSellerId(supabase: any, userId: string): Promise<string> {
  const { data: existing, error: qErr } = await supabase
    .from("sellers")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (qErr) throw qErr;
  if (existing) return existing.id as string;

  const { data: inserted, error: iErr } = await supabase
    .from("sellers")
    .insert({ user_id: userId })
    .select("id")
    .single();
  if (iErr) throw iErr;
  return inserted.id as string;
}

async function signImageIfPath(supabase: any, raw: string | null): Promise<string | null> {
  if (!raw) return null;
  // Passthrough for absolute URLs / data URLs
  if (/^(https?:|data:)/i.test(raw)) return raw;
  const { data, error } = await supabase.storage
    .from("product-images")
    .createSignedUrl(raw, SIGNED_URL_TTL);
  if (error) return null;
  return data.signedUrl;
}

function toDto(row: any, signedUrl: string | null) {
  return {
    id: row.id as string,
    name: row.name as string,
    sku: (row.sku ?? "") as string,
    category: (row.category ?? "") as string,
    brand: (row.brand ?? "") as string,
    description: (row.description ?? "") as string,
    mrp: Number(row.mrp ?? 0),
    price: Number(row.selling_price ?? 0),
    stock: Number(row.stock ?? 0),
    lowStockAt: Number(row.low_stock_threshold ?? 5),
    status: row.status as string,
    imageUrl: signedUrl,
    imagePath: (row.image_url ?? null) as string | null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export type ProductDto = ReturnType<typeof toDto>;

/* ---------- List ---------- */

export const listProducts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    const { data, error } = await supabase
      .from("products")
      .select("*")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false });
    if (error) throw error;
    const signed = await Promise.all(
      (data ?? []).map((r: any) => signImageIfPath(supabase, r.image_url)),
    );
    return (data ?? []).map((r: any, i: number) => toDto(r, signed[i]));
  });

/* ---------- Create ---------- */

export const createProductFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => productInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const sellerId = await ensureSellerId(supabase, userId);
    const { data: row, error } = await supabase
      .from("products")
      .insert({
        user_id: userId,
        seller_id: sellerId,
        name: data.name,
        sku: data.sku,
        category: data.category,
        brand: data.brand,
        description: data.description,
        mrp: data.mrp,
        selling_price: data.price,
        stock: data.stock,
        low_stock_threshold: data.lowStockAt,
        image_url: data.imageUrl || null,
        status: "pending",
      })
      .select("*")
      .single();
    if (error) throw error;
    const signed = await signImageIfPath(supabase, row.image_url);
    return toDto(row, signed);
  });

/* ---------- Update ---------- */

export const updateProductFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid(), patch: productInput.partial() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const patch: Record<string, unknown> = {};
    const p = data.patch;
    if (p.name !== undefined) patch.name = p.name;
    if (p.sku !== undefined) patch.sku = p.sku;
    if (p.category !== undefined) patch.category = p.category;
    if (p.brand !== undefined) patch.brand = p.brand;
    if (p.description !== undefined) patch.description = p.description;
    if (p.mrp !== undefined) patch.mrp = p.mrp;
    if (p.price !== undefined) patch.selling_price = p.price;
    if (p.stock !== undefined) patch.stock = p.stock;
    if (p.lowStockAt !== undefined) patch.low_stock_threshold = p.lowStockAt;
    if (p.imageUrl !== undefined) patch.image_url = p.imageUrl || null;

    const { data: row, error } = await supabase
      .from("products")
      .update(patch)
      .eq("id", data.id)
      .eq("user_id", userId)
      .select("*")
      .single();
    if (error) throw error;
    const signed = await signImageIfPath(supabase, row.image_url);
    return toDto(row, signed);
  });

/* ---------- Delete ---------- */

export const deleteProductFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { error } = await supabase
      .from("products")
      .delete()
      .eq("id", data.id)
      .eq("user_id", userId);
    if (error) throw error;
    return { ok: true };
  });

/* ---------- Bulk create ---------- */

export const bulkCreateProductsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ rows: z.array(productInput).min(1).max(500) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const sellerId = await ensureSellerId(supabase, userId);
    const rows = data.rows.map((r) => ({
      user_id: userId,
      seller_id: sellerId,
      name: r.name,
      sku: r.sku,
      category: r.category,
      brand: r.brand,
      description: r.description,
      mrp: r.mrp,
      selling_price: r.price,
      stock: r.stock,
      low_stock_threshold: r.lowStockAt,
      image_url: r.imageUrl || null,
      status: "pending",
    }));
    const { error, count } = await supabase.from("products").insert(rows, { count: "exact" });
    if (error) throw error;
    return { inserted: count ?? rows.length };
  });
