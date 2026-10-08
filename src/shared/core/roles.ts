// Synced from @localshore/core 0.1.0; edit packages/localshore-core/src in the Shopper repository.
export type LocalShoreRole = "customer" | "seller" | "delivery_partner" | "admin";
export type RoleStatus = "pending" | "active" | "suspended" | "revoked";
export interface UserRoleRecord {
  user_id: string;
  role: LocalShoreRole;
  status: RoleStatus;
}
