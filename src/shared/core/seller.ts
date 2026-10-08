// Synced from @localshore/core 0.1.0; edit packages/localshore-core/src in the Shopper repository.
import type { OrderStatus } from "./orders";
export type { OrderStatus } from "./orders";

export type SellerStatus = "draft" | "pending" | "approved" | "rejected" | "more_info";

export type BusinessType =
  "" | "Individual" | "Sole Proprietorship" | "Partnership" | "Private Limited";

export interface StoredFile {
  name: string;
  size: number;
  type: string;
  dataUrl?: string;
  path?: string;
  url?: string;
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
  userId: string;
  createdAt: string;
  submittedAt?: string;
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
    businessType: BusinessType;
    category: string;
    description: string;
  };
  address: {
    shopAddress: string;
    city: string;
    state: string;
    pincode: string;
    landmark: string;
    pickupLat?: number | null;
    pickupLng?: number | null;
    pickupSame: boolean;
    pickupAddress: string;
    pickupCity: string;
    pickupState: string;
    pickupPincode: string;
    shopCoordinates: { lat: number; lng: number } | null;
    pickupCoordinates: { lat: number; lng: number } | null;
    googlePlaceId?: string | null;
    locationConfirmationRequired: boolean;
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

export interface OrderItem {
  id: string;
  productId: string | null;
  name: string;
  sku: string;
  qty: number;
  price: number;
}

export interface Order {
  id: string;
  orderNumber: string;
  sellerId: string;
  status: OrderStatus;
  buyerName: string;
  buyerPhone: string;
  buyerAddress: string;
  city: string;
  state: string;
  pincode: string;
  subtotal: number;
  shipping: number;
  total: number;
  paymentMode: "Prepaid" | "COD";
  awb?: string;
  courier?: string;
  createdAt: string;
  updatedAt: string;
  deliveredAt?: string;
  items: OrderItem[];
  assignedPartner?: DeliveryPartnerInfo;
  deliveryAssignment?: DeliveryAssignmentInfo;
}

export interface Notification {
  id: string;
  title: string;
  body: string;
  kind: string;
  link?: string;
  readAt: string | null;
  createdAt: string;
}

export interface Settlement {
  id: string;
  cycleStart: string;
  cycleEnd: string;
  gross: number;
  commission: number;
  gstOnFees: number;
  net: number;
  currentPayable?: number;
  status: "pending" | "processing" | "paid" | "held" | "failed";
  hold_reason?: string | null;
  held_at?: string | null;
  held_by?: string | null;
  held_from_status?: "pending" | "processing" | null;
  paidAt?: string;
  utr?: string;
}

export interface DeliveryPartnerInfo {
  id: string;
  fullName: string;
  mobile: string;
  status: string;
  availability: string;
  rating?: number;
  vehicleType?: string;
  vehicleNumber?: string;
}

export interface DeliveryAssignmentInfo {
  id: string;
  status: string;
  distanceKm?: number;
  estimatedEarning?: number;
  expiresAt?: string;
  respondedAt?: string;
  partner?: DeliveryPartnerInfo;
}
