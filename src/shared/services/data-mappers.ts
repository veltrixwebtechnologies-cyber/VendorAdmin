import type {
  BusinessType,
  Seller,
  Order,
  DeliveryPartnerInfo,
  DeliveryAssignmentInfo,
} from "@/shared/core/seller";
import { parseCoordinates } from "@/lib/coordinates";

export function isValidCoordinate(lat: unknown, lng: unknown): lat is number {
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180 &&
    !(lat === 0 && lng === 0)
  );
}

export function normalizeCoordinate(value: unknown): { lat: number; lng: number } | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const lat = record.lat;
  const lng = record.lng;
  if (typeof lat === "number" && typeof lng === "number" && isValidCoordinate(lat, lng)) {
    return { lat, lng };
  }
  return null;
}

export function getDataErrorMessage(error: unknown, fallback = "Please try again.") {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object") {
    const value = error as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown };
    const message = typeof value.message === "string" ? value.message : "";
    const details = typeof value.details === "string" ? value.details : "";
    const hint = typeof value.hint === "string" ? value.hint : "";
    const context = [details, hint].filter(Boolean).join(" ");
    if (message || context) return [message, context].filter(Boolean).join(" ");
    if (typeof value.code === "string") return `Database request failed (${value.code}).`;
  }
  return fallback;
}

export function rowToSeller(r: any): Seller {
  const w: Record<string, any> =
    r.wizard_data && typeof r.wizard_data === "object" && !Array.isArray(r.wizard_data)
      ? r.wizard_data
      : {};
  const shopCoordinates =
    normalizeCoordinate(w.shopCoordinates) ?? normalizeCoordinate({ lat: r.lat, lng: r.lng });
  const pickupCoordinates =
    normalizeCoordinate(w.pickupCoordinates) ?? ((w.pickupSame ?? true) ? shopCoordinates : null);
  return {
    id: r.id,
    userId: r.user_id,
    createdAt: r.created_at,
    submittedAt: w.submittedAt,
    status: r.status,
    reviewNote: r.admin_notes ?? undefined,
    account: {
      fullName: r.full_name ?? "",
      mobile: r.phone ?? "",
      email: r.email ?? "",
      emailVerified: !!w.emailVerified,
      mobileVerified: !!w.mobileVerified,
    },
    business: {
      shopName: r.business_name ?? "",
      ownerName: w.ownerName ?? "",
      businessType: (r.business_type ?? "") as BusinessType,
      category: w.category ?? "",
      description: w.description ?? "",
    },
    address: {
      shopAddress: r.address_line1 ?? "",
      city: r.city ?? "",
      state: r.state ?? "",
      pincode: r.pincode ?? "",
      landmark: r.address_line2 ?? "",
      pickupLat:
        (w.pickupSame === false
          ? parseCoordinates(w.pickupLat, w.pickupLng)
          : (parseCoordinates(r.lat, r.lng) ?? parseCoordinates(w.lat, w.lng))
        )?.lat ?? null,
      pickupLng:
        (w.pickupSame === false
          ? parseCoordinates(w.pickupLat, w.pickupLng)
          : (parseCoordinates(r.lat, r.lng) ?? parseCoordinates(w.lat, w.lng))
        )?.lng ?? null,
      pickupSame: w.pickupSame ?? true,
      pickupAddress: w.pickupAddress ?? "",
      pickupCity: w.pickupCity ?? "",
      pickupState: w.pickupState ?? "",
      pickupPincode: w.pickupPincode ?? "",
      shopCoordinates,
      pickupCoordinates,
      googlePlaceId: w.googlePlaceId ?? null,
      locationConfirmationRequired: !!w.locationConfirmationRequired,
    },
    bank: {
      holderName: r.bank_account_name ?? "",
      bankName: r.bank_name ?? "",
      accountNumber: r.bank_account_number ?? "",
      ifsc: r.bank_ifsc ?? "",
      upi: w.upi ?? "",
    },
    tax: {
      pan: r.pan ?? "",
      gst: r.gstin ?? "",
      businessRegNumber: w.businessRegNumber ?? "",
    },
    documents: w.documents ?? {},
  };
}

export function sellerPatchToDb(patch: Partial<Seller>, existingWizard: Record<string, any> = {}) {
  const db: Record<string, any> = {};
  const w: Record<string, any> = { ...existingWizard };

  if (patch.account) {
    db.full_name = patch.account.fullName;
    db.phone = patch.account.mobile;
    db.email = patch.account.email;
    w.emailVerified = patch.account.emailVerified;
    w.mobileVerified = patch.account.mobileVerified;
  }
  if (patch.business) {
    db.business_name = patch.business.shopName;
    db.business_type = patch.business.businessType || null;
    w.ownerName = patch.business.ownerName;
    w.category = patch.business.category;
    w.description = patch.business.description;
  }
  if (patch.address) {
    const pin = parseCoordinates(patch.address.pickupLat, patch.address.pickupLng);
    db.address_line1 = patch.address.shopAddress;
    db.address_line2 = patch.address.landmark;
    db.city = patch.address.city;
    db.state = patch.address.state;
    db.pincode = patch.address.pincode;
    w.pickupSame = patch.address.pickupSame;
    w.pickupAddress = patch.address.pickupAddress;
    w.pickupCity = patch.address.pickupCity;
    w.pickupState = patch.address.pickupState;
    w.pickupPincode = patch.address.pickupPincode;
    if (patch.address.shopCoordinates !== undefined)
      w.shopCoordinates = patch.address.shopCoordinates;
    if (patch.address.pickupCoordinates !== undefined)
      w.pickupCoordinates = patch.address.pickupCoordinates;
    if (patch.address.locationConfirmationRequired !== undefined) {
      w.locationConfirmationRequired = patch.address.locationConfirmationRequired;
    }
    if (patch.address.googlePlaceId !== undefined) w.googlePlaceId = patch.address.googlePlaceId;
    const isPickupSame = patch.address.pickupSame ?? w.pickupSame ?? true;
    const shopCoords = patch.address.shopCoordinates ?? normalizeCoordinate(w.shopCoordinates);
    const pickupCoords =
      patch.address.pickupCoordinates ?? normalizeCoordinate(w.pickupCoordinates);

    const effectiveCoords = shopCoords ?? pin ?? pickupCoords;

    if (
      effectiveCoords &&
      typeof effectiveCoords.lat === "number" &&
      typeof effectiveCoords.lng === "number" &&
      isValidCoordinate(effectiveCoords.lat, effectiveCoords.lng)
    ) {
      db.lat = effectiveCoords.lat;
      db.lng = effectiveCoords.lng;
      w.lat = effectiveCoords.lat;
      w.lng = effectiveCoords.lng;
      w.shopCoordinates = effectiveCoords;
      if (isPickupSame) {
        w.pickupLat = effectiveCoords.lat;
        w.pickupLng = effectiveCoords.lng;
        w.pickupCoordinates = effectiveCoords;
      } else if (pin) {
        w.pickupLat = pin.lat;
        w.pickupLng = pin.lng;
        w.pickupCoordinates = pin;
      } else if (pickupCoords) {
        w.pickupLat = pickupCoords.lat;
        w.pickupLng = pickupCoords.lng;
        w.pickupCoordinates = pickupCoords;
      }
      w.locationConfirmationRequired = false;
    } else {
      db.lat = null;
      db.lng = null;
      w.lat = w.pickupLat = null;
      w.lng = w.pickupLng = null;
      w.locationConfirmationRequired = true;
    }
  }
  if (patch.bank) {
    db.bank_account_name = patch.bank.holderName;
    db.bank_name = patch.bank.bankName;
    db.bank_account_number = patch.bank.accountNumber;
    db.bank_ifsc = patch.bank.ifsc;
    w.upi = patch.bank.upi;
  }
  if (patch.tax) {
    db.pan = patch.tax.pan;
    db.gstin = patch.tax.gst;
    w.businessRegNumber = patch.tax.businessRegNumber;
  }
  if (patch.documents !== undefined) {
    w.documents = patch.documents;
  }
  if (patch.status) db.status = patch.status;
  if (patch.reviewNote !== undefined) db.admin_notes = patch.reviewNote;
  db.wizard_data = w;
  return db;
}

export function rowToOrder(r: any, items: any[]): Order {
  const w = r.buyer_address ?? "";
  // buyer_address stores "address, city, state - pincode" (we set it that way when seeding).
  // Best-effort parse for display.
  const [addr = "", rest = ""] =
    w.split(",").length > 1
      ? [w.split(",").slice(0, -2).join(","), w.split(",").slice(-2).join(",")]
      : [w, ""];
  const cityState = rest.split(" - ")[0]?.trim() ?? "";
  const pincode = rest.split(" - ")[1]?.trim() ?? "";
  const [city = "", state = ""] = cityState.split(",").map((s: string) => s.trim());

  const activeAssignment = Array.isArray(r.delivery_assignments)
    ? (r.delivery_assignments.find((a: any) => a.status !== "expired" && a.status !== "rejected") ??
      r.delivery_assignments[0])
    : (r.delivery_assignments ?? null);

  const partnerRow = r.assigned_partner ?? activeAssignment?.delivery_partners ?? null;
  const assignedPartner: DeliveryPartnerInfo | undefined = partnerRow
    ? {
        id: partnerRow.id,
        fullName: partnerRow.full_name ?? partnerRow.name ?? "Delivery Partner",
        mobile: partnerRow.mobile ?? partnerRow.phone ?? "",
        status: partnerRow.status ?? "approved",
        availability: partnerRow.availability ?? "online",
        rating: partnerRow.rating ? Number(partnerRow.rating) : 4.9,
        vehicleType: partnerRow.vehicle_type ?? "Motorbike",
        vehicleNumber: partnerRow.vehicle_number ?? "",
      }
    : undefined;

  const deliveryAssignment: DeliveryAssignmentInfo | undefined = activeAssignment
    ? {
        id: activeAssignment.id,
        status: activeAssignment.status,
        distanceKm: activeAssignment.distance_km ? Number(activeAssignment.distance_km) : undefined,
        estimatedEarning: activeAssignment.estimated_earning
          ? Number(activeAssignment.estimated_earning)
          : undefined,
        expiresAt: activeAssignment.expires_at ?? undefined,
        respondedAt: activeAssignment.responded_at ?? undefined,
        partner: assignedPartner,
      }
    : undefined;

  return {
    id: r.id,
    orderNumber: r.order_number,
    sellerId: r.seller_id,
    status: r.status,
    buyerName: r.buyer_name ?? "",
    buyerPhone: r.buyer_phone ?? "",
    buyerAddress: addr,
    city,
    state,
    pincode,
    subtotal: Number(r.subtotal),
    shipping: Number(r.shipping_fee),
    total: Number(r.total),
    paymentMode: r.payment_method === "cod" ? "COD" : "Prepaid",
    awb: r.awb_number ?? undefined,
    courier: r.courier ?? undefined,
    createdAt: r.placed_at,
    updatedAt: r.updated_at,
    deliveredAt: r.delivered_at ?? undefined,
    items: (items ?? []).map((it) => ({
      id: it.id,
      productId: it.product_id,
      name: it.product_name,
      sku: it.sku ?? "",
      qty: it.qty,
      price: Number(it.unit_price),
    })),
    assignedPartner,
    deliveryAssignment,
  };
}
