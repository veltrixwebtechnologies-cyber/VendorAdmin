// Synced from @localshore/core 0.1.0; edit packages/localshore-core/src in the Shopper repository.
export type LocationUpdate = {
  latitude: number;
  longitude: number;
  accuracyM?: number | null;
  capturedAt?: string;
};
