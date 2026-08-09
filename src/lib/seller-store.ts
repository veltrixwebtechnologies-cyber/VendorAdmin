import { useSyncExternalStore } from "react";

export type SellerStatus =
  | "draft"
  | "pending"
  | "approved"
  | "rejected"
  | "more_info";

export type BusinessType =
  | "Individual"
  | "Sole Proprietorship"
  | "Partnership"
  | "Private Limited";

export interface StoredFile {
  name: string;
  size: number;
  type: string;
  dataUrl: string;
}

export interface SellerDocuments {
  panCard?: StoredFile;
  govId?: StoredFile;
  gstCertificate?: StoredFile;
  bankProof?: StoredFile;
  shopLogo?: StoredFile;
  shopBanner?: StoredFile;
}

export interface Seller {
  id: string;
  createdAt: number;
  submittedAt?: number;
  status: SellerStatus;
  reviewNote?: string;

  account: {
    fullName: string;
    mobile: string;
    email: string;
    emailVerified: boolean;
    mobileVerified: boolean;
  };
  business: {
    shopName: string;
    ownerName: string;
    businessType: BusinessType | "";
    category: string;
    description: string;
  };
  address: {
    shopAddress: string;
    city: string;
    state: string;
    pincode: string;
    landmark: string;
    pickupSame: boolean;
    pickupAddress: string;
    pickupCity: string;
    pickupState: string;
    pickupPincode: string;
  };
  bank: {
    holderName: string;
    bankName: string;
    accountNumber: string;
    ifsc: string;
    upi: string;
  };
  tax: {
    pan: string;
    gst: string;
    businessRegNumber: string;
  };
  documents: SellerDocuments;
}

const STORAGE_KEY = "sellers:v1";
const DOCS_KEY = "sellers:docs:v1";
const CURRENT_KEY = "sellers:current";
const STEP_KEY = "sellers:step";

type State = {
  sellers: Record<string, Seller>;
  currentSellerId: string | null;
};

const listeners = new Set<() => void>();
let state: State = load();
let seeded = false;

// Track what we've written so we skip redundant serialization work.
let lastMetaJson = "";
let lastDocsJson = "";
let lastCurrent: string | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let persistWarned = false;

function stripDocs(sellers: Record<string, Seller>): Record<string, Seller> {
  const out: Record<string, Seller> = {};
  for (const [id, s] of Object.entries(sellers)) {
    out[id] = { ...s, documents: {} };
  }
  return out;
}

function extractDocs(sellers: Record<string, Seller>): Record<string, SellerDocuments> {
  const out: Record<string, SellerDocuments> = {};
  for (const [id, s] of Object.entries(sellers)) {
    if (s.documents && Object.keys(s.documents).length) out[id] = s.documents;
  }
  return out;
}

function load(): State {
  if (typeof window === "undefined") {
    return { sellers: {}, currentSellerId: null };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const sellers = raw ? (JSON.parse(raw) as Record<string, Seller>) : {};
    const docsRaw = localStorage.getItem(DOCS_KEY);
    if (docsRaw) {
      const docs = JSON.parse(docsRaw) as Record<string, SellerDocuments>;
      for (const [id, d] of Object.entries(docs)) {
        if (sellers[id]) sellers[id].documents = d;
      }
    }
    const currentSellerId = localStorage.getItem(CURRENT_KEY);
    return { sellers, currentSellerId };
  } catch {
    return { sellers: {}, currentSellerId: null };
  }
}

function doPersist() {
  if (typeof window === "undefined") return;
  try {
    const metaJson = JSON.stringify(stripDocs(state.sellers));
    if (metaJson !== lastMetaJson) {
      localStorage.setItem(STORAGE_KEY, metaJson);
      lastMetaJson = metaJson;
    }
    const docsJson = JSON.stringify(extractDocs(state.sellers));
    if (docsJson !== lastDocsJson) {
      localStorage.setItem(DOCS_KEY, docsJson);
      lastDocsJson = docsJson;
    }
    if (state.currentSellerId !== lastCurrent) {
      if (state.currentSellerId) localStorage.setItem(CURRENT_KEY, state.currentSellerId);
      else localStorage.removeItem(CURRENT_KEY);
      lastCurrent = state.currentSellerId;
    }
  } catch (err) {
    if (!persistWarned) {
      persistWarned = true;
      console.warn("[seller-store] persist failed, continuing in-memory only:", err);
    }
  }
}

function persist() {
  if (typeof window === "undefined") return;
  if (persistTimer) clearTimeout(persistTimer);
  // Coalesce bursts of updates into a single write.
  persistTimer = setTimeout(doPersist, 250);
}

function emit() {
  persist();
  listeners.forEach((l) => l());
}


function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function useSellers(): Seller[] {
  const snap = useSyncExternalStore(
    subscribe,
    () => state.sellers,
    () => state.sellers,
  );
  return Object.values(snap).sort((a, b) => b.createdAt - a.createdAt);
}

export function useSeller(id: string | null | undefined): Seller | null {
  const snap = useSyncExternalStore(
    subscribe,
    () => state.sellers,
    () => state.sellers,
  );
  if (!id) return null;
  return snap[id] ?? null;
}

export function useCurrentSellerId(): string | null {
  return useSyncExternalStore(
    subscribe,
    () => state.currentSellerId,
    () => state.currentSellerId,
  );
}

export function getCurrentSellerId(): string | null {
  return state.currentSellerId;
}

export function setCurrentSellerId(id: string | null) {
  state = { ...state, currentSellerId: id };
  emit();
}

function uid() {
  return "s_" + Math.random().toString(36).slice(2, 10);
}

export function emptySeller(id = uid()): Seller {
  return {
    id,
    createdAt: Date.now(),
    status: "draft",
    account: {
      fullName: "",
      mobile: "",
      email: "",
      emailVerified: false,
      mobileVerified: false,
    },
    business: {
      shopName: "",
      ownerName: "",
      businessType: "",
      category: "",
      description: "",
    },
    address: {
      shopAddress: "",
      city: "",
      state: "",
      pincode: "",
      landmark: "",
      pickupSame: true,
      pickupAddress: "",
      pickupCity: "",
      pickupState: "",
      pickupPincode: "",
    },
    bank: {
      holderName: "",
      bankName: "",
      accountNumber: "",
      ifsc: "",
      upi: "",
    },
    tax: { pan: "", gst: "", businessRegNumber: "" },
    documents: {},
  };
}

export function createSeller(seed?: Partial<Seller>): Seller {
  const s: Seller = { ...emptySeller(), ...seed } as Seller;
  state = {
    ...state,
    sellers: { ...state.sellers, [s.id]: s },
    currentSellerId: s.id,
  };
  emit();
  return s;
}

export function updateSeller(id: string, patch: Partial<Seller>) {
  const existing = state.sellers[id];
  if (!existing) return;
  const next = { ...existing, ...patch };
  state = { ...state, sellers: { ...state.sellers, [id]: next } };
  emit();
}

export function patchSellerSection<K extends keyof Seller>(
  id: string,
  key: K,
  value: Seller[K],
) {
  const existing = state.sellers[id];
  if (!existing) return;
  updateSeller(id, { [key]: value } as Partial<Seller>);
}

export function submitForApproval(id: string) {
  updateSeller(id, { status: "pending", submittedAt: Date.now(), reviewNote: undefined });
}

export function approveSeller(id: string) {
  updateSeller(id, { status: "approved", reviewNote: undefined });
}

export function rejectSeller(id: string, reason: string) {
  updateSeller(id, { status: "rejected", reviewNote: reason });
}

export function requestMoreInfo(id: string, message: string) {
  updateSeller(id, { status: "more_info", reviewNote: message });
}

/* Saved wizard step (for resume-where-you-left-off) */

export function getSavedStep(id: string): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(`${STEP_KEY}:${id}`);
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) && n >= 1 && n <= 7 ? n : null;
  } catch {
    return null;
  }
}

export function setSavedStep(id: string, step: number) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(`${STEP_KEY}:${id}`, String(step));
  } catch {
    /* ignore quota */
  }
}


/* Seed demo data once */

export function seedIfEmpty() {
  if (seeded) return;
  seeded = true;
  if (Object.keys(state.sellers).length > 0) return;

  const now = Date.now();
  const demo1: Seller = {
    ...emptySeller("s_demo1"),
    createdAt: now - 86400_000 * 2,
    submittedAt: now - 86400_000,
    status: "pending",
    account: {
      fullName: "Aarav Sharma",
      mobile: "9876543210",
      email: "aarav@example.com",
      emailVerified: true,
      mobileVerified: true,
    },
    business: {
      shopName: "Sharma Handlooms",
      ownerName: "Aarav Sharma",
      businessType: "Sole Proprietorship",
      category: "Textiles",
      description: "Handloom sarees & fabrics sourced from Varanasi.",
    },
    address: {
      shopAddress: "12 Weavers Lane",
      city: "Varanasi",
      state: "Uttar Pradesh",
      pincode: "221001",
      landmark: "Near Assi Ghat",
      pickupSame: true,
      pickupAddress: "",
      pickupCity: "",
      pickupState: "",
      pickupPincode: "",
    },
    bank: {
      holderName: "Aarav Sharma",
      bankName: "HDFC Bank",
      accountNumber: "00123456789012",
      ifsc: "HDFC0001234",
      upi: "aarav@hdfc",
    },
    tax: { pan: "ABCDE1234F", gst: "09ABCDE1234F1Z5", businessRegNumber: "" },
    documents: {},
  };

  const demo2: Seller = {
    ...emptySeller("s_demo2"),
    createdAt: now - 86400_000 * 5,
    submittedAt: now - 86400_000 * 3,
    status: "pending",
    account: {
      fullName: "Priya Nair",
      mobile: "9123456780",
      email: "priya@example.com",
      emailVerified: true,
      mobileVerified: false,
    },
    business: {
      shopName: "Nair Spice Co.",
      ownerName: "Priya Nair",
      businessType: "Private Limited",
      category: "Groceries",
      description: "Small-batch Kerala spices.",
    },
    address: {
      shopAddress: "45 Marine Drive",
      city: "Kochi",
      state: "Kerala",
      pincode: "682001",
      landmark: "",
      pickupSame: true,
      pickupAddress: "",
      pickupCity: "",
      pickupState: "",
      pickupPincode: "",
    },
    bank: {
      holderName: "Nair Spice Co Pvt Ltd",
      bankName: "ICICI Bank",
      accountNumber: "00987654321000",
      ifsc: "ICIC0004321",
      upi: "",
    },
    tax: { pan: "PQRST5678K", gst: "32PQRST5678K1Z2", businessRegNumber: "U12345KL2020PTC012345" },
    documents: {},
  };

  state = {
    ...state,
    sellers: { ...state.sellers, [demo1.id]: demo1, [demo2.id]: demo2 },
  };
  emit();
}
