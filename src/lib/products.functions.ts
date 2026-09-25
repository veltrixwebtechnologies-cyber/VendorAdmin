import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/* ============================================================
 * Product server functions — Supabase backed.
 * All calls run as the signed-in user; RLS scopes rows to them.
 * ============================================================ */

const productFields = z.object({
  name: z.string().trim().min(1).max(200),
  sku: z.string().trim().min(1).max(80),
  category: z.string().trim().min(1).max(80),
  brand: z.string().trim().max(120).optional().default(""),
  description: z.string().trim().min(1, "Product description is required").max(4000),
  mrp: z.number().min(0),
  price: z.number().min(0),
  stock: z.number().int().min(0),
  lowStockAt: z.number().int().min(0).default(5),
  imageUrl: z.string().max(500).optional().nullable(),
  attributes: z.record(z.any()).optional().default({}),
});

const productInput = productFields
  .refine((value) => value.price > 0, {
    path: ["price"],
    message: "Selling price must be greater than 0",
  })
  .refine((value) => value.mrp >= value.price, {
    path: ["mrp"],
    message: "MRP cannot be lower than selling price",
  });

const productPatch = productFields.partial();

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

async function removeOwnedImage(supabase: any, raw: string | null | undefined) {
  // Only remove paths created by this app. Never attempt to delete arbitrary
  // external URLs or data URLs supplied by a seller.
  if (!raw || /^(https?:|data:)/i.test(raw)) return;
  try {
    await supabase.storage.from("product-images").remove([raw]);
  } catch {
    // Image cleanup must not make a successful catalog mutation look failed.
  }
}

async function assertSkuAvailable(supabase: any, userId: string, sku: string, excludeId?: string) {
  let query = supabase.from("products").select("id").eq("user_id", userId).eq("sku", sku).limit(1);
  if (excludeId) query = query.neq("id", excludeId);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (data) throw new Error(`SKU ${sku} is already used by another product`);
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
    attributes: (row.attributes ?? {}) as Record<string, any>,
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
  .validator((d: unknown) => productInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const sellerId = await ensureSellerId(supabase, userId);
    await assertSkuAvailable(supabase, userId, data.sku);
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
        attributes: data.attributes || {},
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
  .validator((d: unknown) => z.object({ id: z.string().uuid(), patch: productPatch }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const patch: Record<string, unknown> = {};
    const p = data.patch;
    const { data: existing, error: existingError } = await supabase
      .from("products")
      .select("id,sku,mrp,selling_price,image_url")
      .eq("id", data.id)
      .eq("user_id", userId)
      .single();
    if (existingError) throw existingError;
    if (p.sku !== undefined) await assertSkuAvailable(supabase, userId, p.sku, data.id);
    const nextPrice = p.price ?? Number(existing.selling_price ?? 0);
    const nextMrp = p.mrp ?? Number(existing.mrp ?? 0);
    if (nextPrice <= 0) throw new Error("Selling price must be greater than 0");
    if (nextMrp < nextPrice) throw new Error("MRP cannot be lower than selling price");
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
    if (p.attributes !== undefined) patch.attributes = p.attributes || {};

    const { data: row, error } = await supabase
      .from("products")
      .update(patch)
      .eq("id", data.id)
      .eq("user_id", userId)
      .select("*")
      .single();
    if (error) throw error;
    if (p.imageUrl !== undefined && p.imageUrl !== existing.image_url) {
      await removeOwnedImage(supabase, existing.image_url);
    }
    const signed = await signImageIfPath(supabase, row.image_url);
    return toDto(row, signed);
  });

/* ---------- Delete ---------- */

export const deleteProductFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { data: existing, error: existingError } = await supabase
      .from("products")
      .select("image_url")
      .eq("id", data.id)
      .eq("user_id", userId)
      .single();
    if (existingError) throw existingError;
    const { error } = await supabase
      .from("products")
      .delete()
      .eq("id", data.id)
      .eq("user_id", userId);
    if (error) throw error;
    await removeOwnedImage(supabase, existing.image_url);
    return { ok: true };
  });

/* ---------- Bulk create ---------- */

export const bulkCreateProductsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ rows: z.array(productInput).min(1).max(500) }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const sellerId = await ensureSellerId(supabase, userId);
    const skus = data.rows.map((row) => row.sku);
    if (new Set(skus).size !== skus.length)
      throw new Error("Each imported product must have a unique SKU");
    for (const sku of skus) await assertSkuAvailable(supabase, userId, sku);
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
      attributes: r.attributes || {},
      status: "pending",
    }));
    const { error, count } = await supabase.from("products").insert(rows, { count: "exact" });
    if (error) throw error;
    return { inserted: count ?? rows.length };
  });
