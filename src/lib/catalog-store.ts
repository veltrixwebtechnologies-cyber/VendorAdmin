import { useSyncExternalStore } from "react";

/* ============================================================
 * Catalog store — Products, Orders, Inventory (per seller)
 * Persisted to localStorage, seller-scoped by sellerId.
 * ============================================================ */

export type ProductStatus = "draft" | "pending" | "active" | "rejected" | "inactive";

export interface Product {
  id: string;
  sellerId: string;
  createdAt: number;
  updatedAt: number;
  name: string;
  sku: string;
  category: string;
  brand: string;
  description: string;
  mrp: number;
  price: number;
  stock: number;
  lowStockAt: number;
  imageUrl?: string;
  status: ProductStatus;
  rejectionReason?: string;
}

export type OrderStatus =
  "new" | "accepted" | "packed" | "shipped" | "delivered" | "cancelled" | "returned";

export interface OrderItem {
  productId: string;
  name: string;
  sku: string;
  qty: number;
  price: number;
}

export interface Order {
  id: string;
  sellerId: string;
  createdAt: number;
  updatedAt: number;
  status: OrderStatus;
  buyerName: string;
  buyerPhone: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  items: OrderItem[];
  subtotal: number;
  shipping: number;
  total: number;
  paymentMode: "Prepaid" | "COD";
  awb?: string;
  courier?: string;
  timeline: { status: OrderStatus; at: number; note?: string }[];
}

const PRODUCTS_KEY = "catalog:products:v1";
const ORDERS_KEY = "catalog:orders:v1";

type State = { products: Record<string, Product>; orders: Record<string, Order> };

const listeners = new Set<() => void>();
let state: State = load();
const seededFor = new Set<string>();

function load(): State {
  if (typeof window === "undefined") return { products: {}, orders: {} };
  try {
    const p = JSON.parse(localStorage.getItem(PRODUCTS_KEY) || "{}") as Record<string, Product>;
    const o = JSON.parse(localStorage.getItem(ORDERS_KEY) || "{}") as Record<string, Order>;
    return { products: p, orders: o };
  } catch {
    return { products: {}, orders: {} };
  }
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;
function persist() {
  if (typeof window === "undefined") return;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    try {
      localStorage.setItem(PRODUCTS_KEY, JSON.stringify(state.products));
      localStorage.setItem(ORDERS_KEY, JSON.stringify(state.orders));
    } catch (err) {
      console.warn("[catalog-store] persist failed", err);
    }
  }, 200);
}

function emit() {
  persist();
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function uid(prefix: string) {
  return prefix + "_" + Math.random().toString(36).slice(2, 10);
}

/* ---------- Products ---------- */

export const CATEGORIES = [
  "Fashion",
  "Electronics",
  "Home & Kitchen",
  "Beauty",
  "Grocery",
  "Books",
  "Toys",
  "Sports",
] as const;

const EMPTY_PRODUCTS: Product[] = [];
const productsCache = new WeakMap<Record<string, Product>, Map<string, Product[]>>();
function selectProducts(snap: Record<string, Product>, sellerId: string): Product[] {
  let bucket = productsCache.get(snap);
  if (!bucket) {
    bucket = new Map();
    productsCache.set(snap, bucket);
  }
  const hit = bucket.get(sellerId);
  if (hit) return hit;
  const arr = Object.values(snap)
    .filter((p) => p.sellerId === sellerId)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  bucket.set(sellerId, arr);
  return arr;
}

export function useProducts(sellerId: string | null | undefined): Product[] {
  const snap = useSyncExternalStore(
    subscribe,
    () => state.products,
    () => state.products,
  );
  if (!sellerId) return EMPTY_PRODUCTS;
  return selectProducts(snap, sellerId);
}

export function useProduct(id: string | null | undefined): Product | null {
  const snap = useSyncExternalStore(
    subscribe,
    () => state.products,
    () => state.products,
  );
  if (!id) return null;
  return snap[id] ?? null;
}

export function createProduct(
  sellerId: string,
  data: Omit<Product, "id" | "sellerId" | "createdAt" | "updatedAt" | "status">,
): Product {
  const now = Date.now();
  const p: Product = {
    ...data,
    id: uid("p"),
    sellerId,
    createdAt: now,
    updatedAt: now,
    status: "pending",
  };
  state = { ...state, products: { ...state.products, [p.id]: p } };
  emit();
  return p;
}

export function createProductsBulk(
  sellerId: string,
  rows: Array<Omit<Product, "id" | "sellerId" | "createdAt" | "updatedAt" | "status">>,
): number {
  if (!rows.length) return 0;
  const now = Date.now();
  const products = { ...state.products };
  rows.forEach((data, i) => {
    const p: Product = {
      ...data,
      id: uid("p"),
      sellerId,
      createdAt: now + i,
      updatedAt: now + i,
      status: "pending",
    };
    products[p.id] = p;
  });
  state = { ...state, products };
  emit();
  return rows.length;
}

export function updateProduct(id: string, patch: Partial<Product>) {
  const existing = state.products[id];
  if (!existing) return;
  const next = { ...existing, ...patch, updatedAt: Date.now() };
  state = { ...state, products: { ...state.products, [id]: next } };
  emit();
}

export function deleteProduct(id: string) {
  const { [id]: _removed, ...rest } = state.products;
  void _removed;
  state = { ...state, products: rest };
  emit();
}

export function setProductStock(id: string, stock: number) {
  updateProduct(id, { stock: Math.max(0, Math.floor(stock)) });
}

export function setProductStatus(id: string, status: ProductStatus, reason?: string) {
  updateProduct(id, { status, rejectionReason: status === "rejected" ? reason : undefined });
}

/* ---------- Orders ---------- */

export const ORDER_FLOW: OrderStatus[] = ["new", "accepted", "packed", "shipped", "delivered"];

const EMPTY_ORDERS: Order[] = [];
const ordersCache = new WeakMap<Record<string, Order>, Map<string, Order[]>>();
function selectOrders(snap: Record<string, Order>, sellerId: string): Order[] {
  let bucket = ordersCache.get(snap);
  if (!bucket) {
    bucket = new Map();
    ordersCache.set(snap, bucket);
  }
  const hit = bucket.get(sellerId);
  if (hit) return hit;
  const arr = Object.values(snap)
    .filter((o) => o.sellerId === sellerId)
    .sort((a, b) => b.createdAt - a.createdAt);
  bucket.set(sellerId, arr);
  return arr;
}

export function useOrders(sellerId: string | null | undefined): Order[] {
  const snap = useSyncExternalStore(
    subscribe,
    () => state.orders,
    () => state.orders,
  );
  if (!sellerId) return EMPTY_ORDERS;
  return selectOrders(snap, sellerId);
}

export function useOrder(id: string | null | undefined): Order | null {
  const snap = useSyncExternalStore(
    subscribe,
    () => state.orders,
    () => state.orders,
  );
  if (!id) return null;
  return snap[id] ?? null;
}

export function advanceOrder(id: string, note?: string) {
  const o = state.orders[id];
  if (!o) return;
  const idx = ORDER_FLOW.indexOf(o.status);
  if (idx < 0 || idx >= ORDER_FLOW.length - 1) return;
  const next = ORDER_FLOW[idx + 1];
  const patch: Partial<Order> = {
    status: next,
    updatedAt: Date.now(),
    timeline: [...o.timeline, { status: next, at: Date.now(), note }],
  };
  if (next === "shipped" && !o.awb) {
    patch.awb = "AWB" + Math.floor(Math.random() * 9e9 + 1e9);
    patch.courier = ["BlueDart", "Delhivery", "Ekart", "XpressBees"][Math.floor(Math.random() * 4)];
  }
  state = { ...state, orders: { ...state.orders, [id]: { ...o, ...patch } as Order } };
  emit();
}

export function cancelOrder(id: string, reason: string) {
  const o = state.orders[id];
  if (!o) return;
  const next: Order = {
    ...o,
    status: "cancelled",
    updatedAt: Date.now(),
    timeline: [...o.timeline, { status: "cancelled", at: Date.now(), note: reason }],
  };
  state = { ...state, orders: { ...state.orders, [id]: next } };
  emit();
}

/* ---------- Seed demo data for a seller (one time) ---------- */

const DEMO_PRODUCTS: Array<
  Omit<Product, "id" | "sellerId" | "createdAt" | "updatedAt" | "status">
> = [
  {
    name: "Cotton Kurta - Indigo",
    sku: "KUR-IND-M",
    category: "Fashion",
    brand: "Craftly",
    description: "Handloom cotton kurta, indigo dye.",
    mrp: 1499,
    price: 999,
    stock: 24,
    lowStockAt: 5,
  },
  {
    name: "Bluetooth Earbuds Pro",
    sku: "BUD-PRO-BLK",
    category: "Electronics",
    brand: "Sonix",
    description: "40h battery, ENC calls, IPX5.",
    mrp: 2999,
    price: 1799,
    stock: 3,
    lowStockAt: 5,
  },
  {
    name: "Non-stick Frypan 24cm",
    sku: "KIT-FRY-24",
    category: "Home & Kitchen",
    brand: "HearthCo",
    description: "Induction-friendly non-stick frying pan.",
    mrp: 1299,
    price: 799,
    stock: 12,
    lowStockAt: 4,
  },
  {
    name: "Organic Turmeric 500g",
    sku: "GRC-TUR-500",
    category: "Grocery",
    brand: "PurePantry",
    description: "Farm-fresh organic turmeric powder.",
    mrp: 349,
    price: 249,
    stock: 0,
    lowStockAt: 6,
  },
];

export function seedCatalogForSeller(sellerId: string) {
  if (!sellerId || seededFor.has(sellerId)) return;
  seededFor.add(sellerId);
  const existing = Object.values(state.products).some((p) => p.sellerId === sellerId);
  if (existing) return;

  const now = Date.now();
  const created: Product[] = DEMO_PRODUCTS.map((d, i) => ({
    ...d,
    id: uid("p"),
    sellerId,
    createdAt: now - i * 3600_000,
    updatedAt: now - i * 3600_000,
    status: i === 0 ? "active" : i === 1 ? "active" : i === 2 ? "pending" : "active",
  }));

  const products: Record<string, Product> = { ...state.products };
  for (const p of created) products[p.id] = p;

  const [p1, p2, , p4] = created;
  const orders: Record<string, Order> = { ...state.orders };
  const mkOrder = (
    idx: number,
    status: OrderStatus,
    items: OrderItem[],
    paymentMode: Order["paymentMode"],
    buyer: { name: string; phone: string; addr: string; city: string; state: string; pin: string },
  ): Order => {
    const sub = items.reduce((s, it) => s + it.price * it.qty, 0);
    const shipping = paymentMode === "COD" ? 40 : 0;
    const at = now - idx * 3600_000;
    const timeline: Order["timeline"] = [{ status: "new", at: at - 600_000 }];
    if (status !== "new") {
      const stages: OrderStatus[] = ["accepted", "packed", "shipped", "delivered"];
      for (const st of stages) {
        timeline.push({ status: st, at: at - 600_000 + stages.indexOf(st) * 60_000 });
        if (st === status) break;
      }
    }
    return {
      id: "ORD" + String(10000 + idx),
      sellerId,
      createdAt: at,
      updatedAt: at,
      status,
      buyerName: buyer.name,
      buyerPhone: buyer.phone,
      address: buyer.addr,
      city: buyer.city,
      state: buyer.state,
      pincode: buyer.pin,
      items,
      subtotal: sub,
      shipping,
      total: sub + shipping,
      paymentMode,
      awb:
        status === "shipped" || status === "delivered"
          ? "AWB" + (100000000 + idx * 12345)
          : undefined,
      courier: status === "shipped" || status === "delivered" ? "Delhivery" : undefined,
      timeline,
    };
  };

  const demoOrders = [
    mkOrder(
      1,
      "new",
      [{ productId: p1.id, name: p1.name, sku: p1.sku, qty: 1, price: p1.price }],
      "Prepaid",
      {
        name: "Rhea Kapoor",
        phone: "9812345670",
        addr: "22 Palm Grove",
        city: "Mumbai",
        state: "Maharashtra",
        pin: "400001",
      },
    ),
    mkOrder(
      2,
      "accepted",
      [{ productId: p2.id, name: p2.name, sku: p2.sku, qty: 2, price: p2.price }],
      "COD",
      {
        name: "Vikram Rao",
        phone: "9876501234",
        addr: "5 MG Road",
        city: "Bengaluru",
        state: "Karnataka",
        pin: "560001",
      },
    ),
    mkOrder(
      3,
      "shipped",
      [{ productId: p1.id, name: p1.name, sku: p1.sku, qty: 1, price: p1.price }],
      "Prepaid",
      {
        name: "Neha Iyer",
        phone: "9998887771",
        addr: "9 Anna Salai",
        city: "Chennai",
        state: "Tamil Nadu",
        pin: "600002",
      },
    ),
    mkOrder(
      4,
      "delivered",
      [{ productId: p4.id, name: p4.name, sku: p4.sku, qty: 3, price: p4.price }],
      "Prepaid",
      {
        name: "Amit Sen",
        phone: "9765432100",
        addr: "3 Park Street",
        city: "Kolkata",
        state: "West Bengal",
        pin: "700016",
      },
    ),
  ];
  for (const o of demoOrders) orders[o.id] = o;

  state = { products, orders };
  emit();
}
