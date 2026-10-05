import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";

export const ADMIN_ROLES = [
  "SUPER_ADMIN",
  "OPERATIONS_ADMIN",
  "SELLER_MANAGER",
  "CATALOG_MANAGER",
  "FINANCE_ADMIN",
  "SUPPORT_AGENT",
  "MARKETING_ADMIN",
  "ANALYST",
] as const;

export type AdminRole = (typeof ADMIN_ROLES)[number];

export const ADMIN_ROLE_LABELS: Record<AdminRole, string> = {
  SUPER_ADMIN: "Super admin",
  OPERATIONS_ADMIN: "Operations admin",
  SELLER_MANAGER: "Seller manager",
  CATALOG_MANAGER: "Catalog manager",
  FINANCE_ADMIN: "Finance admin",
  SUPPORT_AGENT: "Support agent",
  MARKETING_ADMIN: "Marketing admin",
  ANALYST: "Analyst",
};

export const ADMIN_PERMISSION_LABELS = {
  "dashboard.view": "View dashboard",
  "orders.view": "View orders",
  "orders.manage": "Manage orders",
  "sellers.view": "View sellers",
  "sellers.approve": "Approve sellers",
  "sellers.suspend": "Suspend sellers",
  "sellers.manage": "Manage seller records",
  "stores.view": "View stores",
  "stores.manage": "Manage stores",
  "products.view": "View products",
  "products.moderate": "Moderate products",
  "products.manage": "Manage products",
  "categories.view": "View categories",
  "categories.manage": "Manage categories",
  "inventory.view": "View inventory",
  "inventory.manage": "Manage inventory",
  "customers.view": "View customers",
  "customers.manage": "Manage customers",
  "payments.view": "View payments",
  "refunds.view": "View refunds",
  "refunds.manage": "Manage refunds",
  "refunds.approve": "Approve refunds",
  "payouts.view": "View payouts",
  "payouts.manage": "Manage payouts",
  "commissions.view": "View commissions",
  "commissions.manage": "Manage commissions",
  "reviews.view": "View reviews",
  "reviews.moderate": "Moderate reviews",
  "support.view": "View support",
  "support.manage": "Manage support",
  "promotions.view": "View promotions",
  "promotions.manage": "Manage promotions",
  "dispatch.view": "View dispatch",
  "dispatch.manage": "Manage dispatch",
  "notifications.view": "View notifications",
  "notifications.manage": "Manage notifications",
  "analytics.view": "View analytics",
  "reports.view": "View reports",
  "settings.view": "View settings",
  "settings.manage": "Manage settings",
  "admins.view": "View admin users",
  "admins.manage": "Manage admins",
  "audit.view": "View audit logs",
  "integrations.view": "View integrations",
  "integrations.manage": "Manage integrations",
  "platform_health.view": "View platform health",
  "service_zones.view": "View service zones",
  "service_zones.manage": "Manage service zones",
} as const;

export type AdminPermission = keyof typeof ADMIN_PERMISSION_LABELS;

export function adminErrorMessage(
  error: unknown,
  fallback = "The request could not be completed.",
) {
  const candidate = error as { code?: string; message?: string } | null;
  if (
    candidate?.code === "42501" ||
    /permission denied|not authorized|insufficient privilege/i.test(candidate?.message ?? "")
  ) {
    return "You don't have permission to perform this action.";
  }
  return fallback;
}

export interface AdminAccessContext {
  role: AdminRole;
  status: "active" | "suspended";
  permissions: AdminPermission[];
}

const LEGACY_SUPER_ADMIN_PERMISSIONS = Object.keys(ADMIN_PERMISSION_LABELS) as AdminPermission[];

function isMissingRbacRpc(error: { code?: string; message?: string } | null) {
  return Boolean(
    error &&
    (error.code === "PGRST202" ||
      error.code === "42883" ||
      /get_my_admin_access.*(not found|schema cache)|function .* does not exist/i.test(
        error.message ?? "",
      )),
  );
}

async function getLegacyAdminAccess(userId: string): Promise<AdminAccessContext | null> {
  const { data, error } = await (supabase as any)
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .eq("status", "active")
    .maybeSingle();
  if (error) throw error;
  return data
    ? { role: "SUPER_ADMIN", status: "active", permissions: LEGACY_SUPER_ADMIN_PERMISSIONS }
    : null;
}

export function useAdminAccess() {
  const { user } = useAuth();
  const query = useQuery<AdminAccessContext | null>({
    queryKey: ["admin-access", user?.id],
    enabled: Boolean(user),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      if (!user) return null;
      const { data, error } = await (supabase as any).rpc("get_my_admin_access");
      if (isMissingRbacRpc(error)) return getLegacyAdminAccess(user.id);
      if (error) throw error;
      if (!data || data.status !== "active") return null;
      const role = ADMIN_ROLES.find((item) => item === data.role);
      if (!role || !Array.isArray(data.permissions)) return null;
      const permissions = data.permissions.filter(
        (permission: string): permission is AdminPermission =>
          Object.hasOwn(ADMIN_PERMISSION_LABELS, permission),
      );
      return { role, status: "active", permissions };
    },
  });

  const hasPermission = (permission: AdminPermission) =>
    query.data?.permissions.includes(permission) ?? false;

  return { ...query, hasPermission };
}

export function adminPermissionForPath(path: string): AdminPermission {
  if (path === "/admin" || path === "/admin/") return "dashboard.view";
  if (path === "/admin/admin-users") return "admins.view";
  if (path === "/admin/audit-logs") return "audit.view";
  if (path.startsWith("/admin/stores") || path === "/admin/store-map") return "stores.view";
  if (path.startsWith("/admin/service-zones")) return "service_zones.view";
  if (/^\/admin\/[^/]+$/.test(path)) return "sellers.view";
  if (path.startsWith("/admin/vendors")) return "sellers.view";
  if (path.startsWith("/admin/products")) return "products.view";
  if (path.startsWith("/admin/categories")) return "categories.view";
  if (path.startsWith("/admin/orders")) return "orders.view";
  if (path.startsWith("/admin/inventory")) return "inventory.view";
  if (path.startsWith("/admin/users")) return "customers.view";
  if (path.startsWith("/admin/payments")) return "payments.view";
  if (path.startsWith("/admin/refunds")) return "refunds.view";
  if (path.startsWith("/admin/reconciliation")) return "payments.view";
  if (path.startsWith("/admin/disputes")) return "support.view";
  if (path.startsWith("/admin/payouts")) return "payouts.view";
  if (path.startsWith("/admin/reviews")) return "reviews.view";
  if (path.startsWith("/admin/tickets")) return "support.view";
  if (path.startsWith("/admin/dispatch")) return "dispatch.view";
  if (path.startsWith("/admin/ml-control-center")) return "settings.manage";
  if (path.startsWith("/admin/notifications")) return "notifications.view";
  if (
    path.startsWith("/admin/coupons") ||
    path.startsWith("/admin/offers") ||
    path.startsWith("/admin/banners") ||
    path.startsWith("/admin/merchandising")
  )
    return "promotions.view";
  if (path.startsWith("/admin/reports")) return "reports.view";
  if (path.startsWith("/admin/settings")) return "settings.view";
  // Unknown future routes stay restricted instead of inheriting dashboard access.
  return "admins.manage";
}

export function adminPermissionsForRole(role: AdminRole): AdminPermission[] {
  // This mirrors the database grants for a readable, safe permission preview.
  // The database mapping remains authoritative for every actual access check.
  const local: Record<AdminRole, AdminPermission[]> = {
    SUPER_ADMIN: LEGACY_SUPER_ADMIN_PERMISSIONS,
    OPERATIONS_ADMIN: [
      "dashboard.view",
      "orders.view",
      "orders.manage",
      "sellers.view",
      "stores.view",
      "service_zones.view",
      "service_zones.manage",
      "inventory.view",
      "dispatch.view",
      "dispatch.manage",
      "support.view",
      "analytics.view",
    ],
    SELLER_MANAGER: [
      "dashboard.view",
      "sellers.view",
      "sellers.approve",
      "sellers.suspend",
      "sellers.manage",
      "stores.view",
      "stores.manage",
      "products.view",
      "orders.view",
      "service_zones.view",
    ],
    CATALOG_MANAGER: [
      "dashboard.view",
      "products.view",
      "products.moderate",
      "products.manage",
      "categories.view",
      "categories.manage",
      "inventory.view",
      "inventory.manage",
    ],
    FINANCE_ADMIN: [
      "dashboard.view",
      "orders.view",
      "payments.view",
      "refunds.view",
      "refunds.manage",
      "refunds.approve",
      "payouts.view",
      "payouts.manage",
      "commissions.view",
      "commissions.manage",
      "reports.view",
    ],
    SUPPORT_AGENT: [
      "dashboard.view",
      "orders.view",
      "customers.view",
      "reviews.view",
      "support.view",
      "support.manage",
    ],
    MARKETING_ADMIN: [
      "dashboard.view",
      "promotions.view",
      "promotions.manage",
      "notifications.view",
      "notifications.manage",
      "analytics.view",
    ],
    ANALYST: [
      "dashboard.view",
      "analytics.view",
      "reports.view",
      "orders.view",
      "stores.view",
      "products.view",
      "categories.view",
      "inventory.view",
      "payments.view",
      "payouts.view",
      "reviews.view",
      "service_zones.view",
    ],
  };
  return local[role];
}
