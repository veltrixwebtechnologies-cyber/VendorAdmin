/**
 * SELLERHUB — SERVER-ONLY REDIS MUTATION INVALIDATION UTILITY
 */

if (typeof window !== "undefined") {
  throw new Error("SECURITY ERROR: redis.server.ts must only be imported in server-side code!");
}

import Redis from "ioredis";

let redisInstance: Redis | null = null;

function getRedisClient(): Redis | null {
  if (redisInstance) return redisInstance;

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) return null;

  try {
    redisInstance = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      connectTimeout: 5000,
    });
    return redisInstance;
  } catch (err: any) {
    console.error("[SellerHub Redis] Failed to initialize client:", err?.message || String(err));
    return null;
  }
}

/**
 * Increment Version Namespace to Invalidate Public Cache Keys Safely
 */
export async function redisIncrementVersion(versionKey: string): Promise<string> {
  const client = getRedisClient();
  if (!client) return "1";

  try {
    const newVer = await client.incr(versionKey);
    console.log(
      `[SellerHub Redis] op=INCR key="${versionKey}" newVer=${newVer} status=INVALIDATED`,
    );
    return String(newVer);
  } catch (err: any) {
    console.error(
      `[SellerHub Redis] op=INCR key="${versionKey}" error="${err?.message || String(err)}"`,
    );
    return "1";
  }
}
