import type { OrderStatus } from "@/shared/core/orders";

export type PipelineStageKey =
  | "new"
  | "accepted"
  | "preparing"
  | "ready"
  | "delivery"
  | "delivered";

export interface PipelineStageConfig {
  readonly key: PipelineStageKey;
  readonly label: string;
  readonly statuses: readonly OrderStatus[];
  readonly description: string;
}

export const PIPELINE_STAGES: readonly PipelineStageConfig[] = [
  {
    key: "new",
    label: "New",
    statuses: ["new"],
    description: "New orders waiting for vendor acceptance",
  },
  {
    key: "accepted",
    label: "Accepted",
    statuses: ["accepted", "vendor_accepted"],
    description: "Orders accepted and waiting for preparation",
  },
  {
    key: "preparing",
    label: "Preparing",
    statuses: ["preparing", "packed"],
    description: "Orders currently being prepared or packed",
  },
  {
    key: "ready",
    label: "Ready",
    statuses: ["ready_for_pickup"],
    description: "Orders prepared and ready for delivery partner pickup",
  },
  {
    key: "delivery",
    label: "Delivery",
    statuses: [
      "assigned",
      "delivery_partner_assigned",
      "going_to_vendor",
      "arrived_at_vendor",
      "rider_assigned",
      "rider_accepted",
      "rider_at_shop",
      "picked_up",
      "going_to_customer",
      "arrived_at_customer",
      "out_for_delivery",
      "at_customer",
      "shipped",
    ],
    description: "Orders currently out for delivery or with a delivery partner",
  },
  {
    key: "delivered",
    label: "Delivered",
    statuses: ["delivered"],
    description: "Orders successfully delivered to customers",
  },
] as const;

export const CANCELLED_STATUSES: readonly OrderStatus[] = [
  "cancelled",
  "cancelled_by_vendor",
  "returned",
  "assignment_failed",
  "delivery_failed",
] as const;

/**
 * Checks whether an order's status strictly belongs to a specific pipeline stage.
 * Uses exact match against the stage's defined backend statuses.
 */
export function orderMatchesStage(orderStatus: string, stageKey: PipelineStageKey): boolean {
  const stage = PIPELINE_STAGES.find((s) => s.key === stageKey);
  if (!stage) return false;
  return (stage.statuses as readonly string[]).includes(orderStatus);
}

/**
 * Finds the pipeline stage config that an order status belongs to, if any.
 */
export function getStageForOrderStatus(orderStatus: string): PipelineStageConfig | undefined {
  return PIPELINE_STAGES.find((s) => (s.statuses as readonly string[]).includes(orderStatus));
}

/**
 * Normalizes URL query string or raw status string into a PipelineStageKey.
 */
export function normalizePipelineStage(raw: string | null | undefined): PipelineStageKey | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase();
  for (const stage of PIPELINE_STAGES) {
    if (stage.key === s) return stage.key;
    if (stage.label.toLowerCase() === s) return stage.key;
    if ((stage.statuses as readonly string[]).includes(s)) return stage.key;
  }
  return null;
}

/**
 * Calculates pipeline counts from the FULL orders array.
 * Ensures counts for every stage remain visible and accurate regardless of active filters.
 */
export function calculatePipelineCounts(
  orders: ReadonlyArray<{ status: string }>,
): Record<PipelineStageKey, number> {
  const counts: Record<PipelineStageKey, number> = {
    new: 0,
    accepted: 0,
    preparing: 0,
    ready: 0,
    delivery: 0,
    delivered: 0,
  };

  for (const order of orders) {
    for (const stage of PIPELINE_STAGES) {
      if ((stage.statuses as readonly string[]).includes(order.status)) {
        counts[stage.key]++;
        break;
      }
    }
  }

  return counts;
}

/**
 * Calculates order counts for orders page tabs (all pipeline stages + all + cancelled).
 */
export function calculateOrdersPageTabCounts(
  orders: ReadonlyArray<{ status: string }>,
): Record<string, number> {
  const pipelineCounts = calculatePipelineCounts(orders);
  const cancelledCount = orders.filter((o) =>
    (CANCELLED_STATUSES as readonly string[]).includes(o.status),
  ).length;

  return {
    all: orders.length,
    ...pipelineCounts,
    cancelled: cancelledCount,
  };
}

/**
 * Generates the clean empty state title and description for a selected pipeline stage.
 */
export function getPipelineEmptyState(stageKey: PipelineStageKey): {
  title: string;
  description: string;
} {
  const stage = PIPELINE_STAGES.find((s) => s.key === stageKey);
  const label = stage ? stage.label : "Orders";
  return {
    title: `No ${label} Orders`,
    description: `There are currently no orders in the ${label} stage.`,
  };
}
