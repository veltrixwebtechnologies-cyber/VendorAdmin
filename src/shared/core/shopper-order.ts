// Synced from @localshore/core 0.1.0; edit packages/localshore-core/src in the Shopper repository.
import type { CartLine } from "./cart";
import type { OrderStatus as PersistedOrderStatus } from "./orders";
export type OrderStatus = Exclude<PersistedOrderStatus, "shipped">;

export interface Order {
  isDemoPayment?: boolean;
  paymentReference?: string;
  id: string;
  code: string;
  storeId: string;
  storeName: string;
  storeCoordinates?: { lat: number; lng: number };
  lines: CartLine[];
  subtotal: number;
  deliveryFee: number;
  total: number;
  address: string;
  destination: { lat: number; lng: number } | null;
  paymentMethod: string;
  deliveryOtp?: string;
  couponCode?: string;
  discountAmount?: number;
  createdAt: number;
  status: OrderStatus;
  partner?: {
    name: string;
    rating: number;
    lat?: number;
    lng?: number;
    userRating?: number;
    vehicle?: string;
    deliveriesCount?: number;
  };
  etaMin: number;
  distanceKm: number;
  cancellationReason?: string;
}
