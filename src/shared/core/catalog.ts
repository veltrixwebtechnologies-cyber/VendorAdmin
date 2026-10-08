// Synced from @localshore/core 0.1.0; edit packages/localshore-core/src in the Shopper repository.
export type StoreCategory =
  | "showrooms"
  | "boutiques"
  | "fast_fashion"
  | "individual_fashion"
  | "flour_mill"
  | "palamuthir"
  | "meat_fish"
  | "pharmacy"
  | "stationery"
  | "home_decor"
  | "kitchen_appliances"
  | "fashion_accessories"
  | "bakery"
  | "grocery"
  | "restaurants"
  | "supermarkets"
  | "sweet_shops"
  | "cafes"
  | "fruits_veg"
  | "fashion"
  | "footwear"
  | "jewellery"
  | "electronics"
  | "mobile"
  | "books_stationery"
  | "beauty"
  | "home_kitchen"
  | "furniture"
  | "hardware"
  | "sports"
  | "toys"
  | "gifts"
  | "flowers"
  | "pet_shops"
  | "pooja"
  | "auto"
  | "repair"
  | "local_services";

export interface Store {
  id: string;
  name: string;
  category: StoreCategory;
  tagline: string;
  distanceKm?: number;
  rating: number;
  isOpen: boolean;
  etaMin: number;
  address: string;
  lat: number;
  lng: number;
  imageUrl: string;
}

export interface Product {
  id: string;
  storeId: string;
  /** Seller name for products returned from the cross-seller approved catalog. */
  shopName?: string;
  name: string;
  unit: string;
  price: number;
  category: string;
  imageUrl?: string;
  stock?: number;
}
