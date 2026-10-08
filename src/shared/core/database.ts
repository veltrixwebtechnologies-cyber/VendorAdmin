// Synced from @localshore/core 0.1.0; edit packages/localshore-core/src in the Shopper repository.
/** Resolve actual generated table rows without hand-merging schema histories. */
export type DatabaseRow<Schema, Table extends string> = Schema extends {
  public: { Tables: Record<Table, { Row: infer Row }> };
}
  ? Row
  : never;

/** Common persisted fields, not a replacement for the full generated schema. */
export type ProductRecord<Schema> = DatabaseRow<Schema, "products">;

export type StoreRecord<Schema> = DatabaseRow<Schema, "stores">;

export type ProfileRecord<Schema> = DatabaseRow<Schema, "profiles">;

/** Real persisted orders; imported prototype receipts do not enter this model. */
export type OrderRecord<Schema> = DatabaseRow<Schema, "orders">;

export type PaymentAttemptRecord<Schema> = DatabaseRow<Schema, "payment_attempts">;

export type NotificationRecord<Schema> = DatabaseRow<Schema, "notifications">;

export type DeliveryAssignmentRecord<Schema> = DatabaseRow<Schema, "delivery_assignments">;
