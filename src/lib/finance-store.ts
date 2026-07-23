import { useSyncExternalStore, useMemo } from "react";
import type { Order } from "./catalog-store";

/* ============================================================
 * Finance: settlements derived from delivered orders.
 * Commission 8%, GST on commission 18%, shipping fee ₹40 for COD.
 * Cycles: weekly (Mon–Sun). Payout T+2 days after cycle end.
 * ============================================================ */

export const COMMISSION_RATE = 0.08;
export const GST_ON_FEES = 0.18;
export const COD_FEE = 40;

export interface Txn {
  orderId: string;
  date: number;
  gross: number;
  commission: number;
  gstOnFees: number;
  codFee: number;
  net: number;
  paymentMode: Order["paymentMode"];
}

export interface Cycle {
  id: string;
  start: number;
  end: number;
  payoutDate: number;
  status: "processing" | "paid";
  txns: Txn[];
  gross: number;
  fees: number;
  net: number;
}

function startOfWeek(ts: number) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  const day = (d.getDay() + 6) % 7; // Mon=0
  d.setDate(d.getDate() - day);
  return d.getTime();
}

export function txnFromOrder(o: Order): Txn {
  const commission = Math.round(o.subtotal * COMMISSION_RATE);
  const codFee = o.paymentMode === "COD" ? COD_FEE : 0;
  const gstOnFees = Math.round((commission + codFee) * GST_ON_FEES);
  const net = o.total - commission - gstOnFees - codFee;
  return {
    orderId: o.id,
    date: o.updatedAt,
    gross: o.total,
    commission,
    gstOnFees,
    codFee,
    net,
    paymentMode: o.paymentMode,
  };
}

const cyclesCache = new WeakMap<Order[], Cycle[]>();
export function buildCycles(orders: Order[]): Cycle[] {
  const hit = cyclesCache.get(orders);
  if (hit) return hit;
  const delivered = orders.filter((o) => o.status === "delivered");
  const groups = new Map<number, Txn[]>();
  for (const o of delivered) {
    const t = txnFromOrder(o);
    const wk = startOfWeek(t.date);
    if (!groups.has(wk)) groups.set(wk, []);
    groups.get(wk)!.push(t);
  }
  const cycles: Cycle[] = [];
  const now = Date.now();
  for (const [start, txns] of Array.from(groups.entries()).sort((a, b) => b[0] - a[0])) {
    const end = start + 7 * 86_400_000 - 1;
    const payoutDate = end + 2 * 86_400_000;
    const gross = txns.reduce((s, t) => s + t.gross, 0);
    const fees = txns.reduce((s, t) => s + t.commission + t.gstOnFees + t.codFee, 0);
    const net = gross - fees;
    cycles.push({
      id: "STL" + new Date(start).toISOString().slice(0, 10),
      start,
      end,
      payoutDate,
      status: now >= payoutDate ? "paid" : "processing",
      txns: txns.sort((a, b) => b.date - a.date),
      gross,
      fees,
      net,
    });
  }
  cyclesCache.set(orders, cycles);
  return cycles;
}

/* ---------- Notifications ---------- */

export type NotifKind = "order" | "stock" | "status" | "payout";

export interface Notif {
  id: string;
  kind: NotifKind;
  title: string;
  body: string;
  ts: number;
  href?: string;
}

const READ_KEY = "notifs:read:v1";
const listeners = new Set<() => void>();
let readSet: Set<string> = loadRead();

function loadRead(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    return new Set(JSON.parse(localStorage.getItem(READ_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

function saveRead() {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(READ_KEY, JSON.stringify(Array.from(readSet)));
  } catch (err) {
    console.warn("[notifs] persist failed", err);
  }
}

function emit() {
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function useReadSnap() {
  return useSyncExternalStore(
    subscribe,
    () => readSet,
    () => readSet,
  );
}

export function markNotifRead(id: string) {
  if (readSet.has(id)) return;
  readSet = new Set(readSet);
  readSet.add(id);
  saveRead();
  emit();
}

export function markAllNotifsRead(ids: string[]) {
  let changed = false;
  const next = new Set(readSet);
  for (const id of ids) {
    if (!next.has(id)) {
      next.add(id);
      changed = true;
    }
  }
  if (!changed) return;
  readSet = next;
  saveRead();
  emit();
}

interface NotifSource {
  orders: Order[];
  products: { id: string; name: string; stock: number; lowStockAt: number }[];
  sellerStatus?: string;
  sellerReviewNote?: string;
}

export function useNotifications(src: NotifSource): { items: Notif[]; unread: number } {
  const read = useReadSnap();
  return useMemo(() => {
    const items: Notif[] = [];

    // New orders
    for (const o of src.orders.filter((x) => x.status === "new").slice(0, 20)) {
      items.push({
        id: "order:" + o.id,
        kind: "order",
        title: "New order " + o.id,
        body: `${o.items.length} item(s) • ₹${o.total.toLocaleString("en-IN")} • ${o.buyerName}`,
        ts: o.createdAt,
        href: "/seller/orders",
      });
    }

    // Low / out of stock
    for (const p of src.products) {
      if (p.stock === 0) {
        items.push({
          id: "stock:out:" + p.id,
          kind: "stock",
          title: "Out of stock",
          body: p.name + " has zero inventory.",
          ts: Date.now() - 60_000,
          href: "/seller/inventory",
        });
      } else if (p.stock <= p.lowStockAt) {
        items.push({
          id: "stock:low:" + p.id,
          kind: "stock",
          title: "Low stock",
          body: `${p.name} — only ${p.stock} left.`,
          ts: Date.now() - 120_000,
          href: "/seller/inventory",
        });
      }
    }

    // Seller status
    if (src.sellerStatus && src.sellerStatus !== "approved") {
      const map: Record<string, string> = {
        pending: "Your application is under review.",
        rejected: "Your application was rejected.",
        more_info: "Admin requested more information.",
        draft: "Registration is still in draft.",
      };
      items.push({
        id: "status:" + src.sellerStatus,
        kind: "status",
        title: "Account status",
        body: src.sellerReviewNote || map[src.sellerStatus] || "Status updated.",
        ts: Date.now() - 300_000,
        href: "/seller",
      });
    }

    // Payouts (from delivered)
    const cycles = buildCycles(src.orders);
    for (const c of cycles.slice(0, 4)) {
      items.push({
        id: "payout:" + c.id,
        kind: "payout",
        title: c.status === "paid" ? "Payout credited" : "Payout scheduled",
        body: `Cycle ${new Date(c.start).toLocaleDateString()} – ${new Date(c.end).toLocaleDateString()} • ₹${c.net.toLocaleString("en-IN")}`,
        ts: c.payoutDate,
        href: "/seller/settlements",
      });
    }

    items.sort((a, b) => b.ts - a.ts);
    const unread = items.filter((n) => !read.has(n.id)).length;
    return { items, unread };
  }, [src.orders, src.products, src.sellerStatus, src.sellerReviewNote, read]);
}
