/**
 * SELLERHUB — SERVER FUNCTIONS FOR SELLER MUTATIONS WITH TARGETED CACHE INVALIDATION
 */

import { createServerFn } from "@tanstack/react-start";
import { redisIncrementVersion } from "@/lib/redis.server";

/**
 * Server Function: Trigger Cache Invalidation when a seller updates products/prices
 */
export const invalidateProductCacheServerFn = createServerFn({ method: "POST" })
  .inputValidator((data: { sellerId?: string; productId?: string }) => data || {})
  .handler(async () => {
    // Safely increment catalog and product versions in Redis
    const newProdVer = await redisIncrementVersion("version:products");
    const newCatVer = await redisIncrementVersion("version:catalog");
    return { success: true, newProdVer, newCatVer };
  });

/**
 * Server Function: Trigger Cache Invalidation when a seller updates shop details/hours
 */
export const invalidateShopCacheServerFn = createServerFn({ method: "POST" })
  .inputValidator((data: { sellerId?: string }) => data || {})
  .handler(async () => {
    const newShopVer = await redisIncrementVersion("version:shops");
    const newCatVer = await redisIncrementVersion("version:catalog");
    return { success: true, newShopVer, newCatVer };
  });
