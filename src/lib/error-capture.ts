// Captures the original Error out-of-band so server.ts can recover the stack
// when h3 has swallowed the throw into a generic 500 Response.

let lastCapturedError: { error: unknown; at: number } | undefined;
const TTL_MS = 5_000;

export function logStructuredError(category: string, error: unknown, meta?: Record<string, unknown>) {
  const correlationId = (meta?.['correlationId'] as string) || (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2));
  const timestamp = new Date().toISOString();
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  
  console.error(`[${timestamp}] [${category}] [CID:${correlationId}]:`, message, meta ?? "", stack ?? "");
}

function record(error: unknown) {
  lastCapturedError = { error, at: Date.now() };
  logStructuredError("UncaughtError", error);
}

if (typeof globalThis.addEventListener === "function") {
  globalThis.addEventListener("error", (event) => record((event as ErrorEvent).error ?? event));
  globalThis.addEventListener("unhandledrejection", (event) =>
    record((event as PromiseRejectionEvent).reason),
  );
}

export function consumeLastCapturedError(): unknown {
  if (!lastCapturedError) return undefined;
  if (Date.now() - lastCapturedError.at > TTL_MS) {
    lastCapturedError = undefined;
    return undefined;
  }
  const { error } = lastCapturedError;
  lastCapturedError = undefined;
  return error;
}
