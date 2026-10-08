// Synced from @localshore/core 0.1.0; edit packages/localshore-core/src in the Shopper repository.
export interface AppNotification {
  id: string;
  title: string;
  body: string;
  kind: string;
  link?: string | null;
  read_at?: string | null;
  created_at: string;
}
