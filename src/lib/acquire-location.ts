import { parseCoordinates, usableGPS, MAX_NAVIGATION_ACCURACY_M } from "./coordinates";

export type LocationFailure = "denied" | "unavailable" | "timeout" | "unsupported" | "error";
export class LocationAcquisitionError extends Error {
  constructor(
    message: string,
    public status: LocationFailure,
  ) {
    super(message);
    this.name = "LocationAcquisitionError";
  }
}
export const GPS_REFINEMENT_MS = 3000;
const MAX_ACQUISITION_AGE_MS = 5000;

export function freshBrowserPosition(position: GeolocationPosition, now = Date.now()): boolean {
  return (
    !!parseCoordinates(position.coords.latitude, position.coords.longitude) &&
    Number.isFinite(position.coords.accuracy) &&
    position.coords.accuracy >= 0 &&
    Number.isFinite(position.timestamp) &&
    now - position.timestamp <= MAX_ACQUISITION_AGE_MS &&
    position.timestamp <= now + 1000
  );
}
export function accuracyLabel(metres: number): string {
  return metres < 1000 ? `${Math.ceil(metres)} m` : `${(metres / 1000).toFixed(1)} km`;
}

/** Refine a one-time selection; continuous navigation should keep consuming current fixes. */
export function acquireCurrentPosition(
  options: {
    signal?: AbortSignal;
    timeoutMs?: number;
    onProgress?: (message: string) => void;
    subscribe?: (position: PositionCallback, error: PositionErrorCallback) => () => void;
  } = {},
): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    const { signal, onProgress, timeoutMs = 20000 } = options;
    if (signal?.aborted)
      return reject(new DOMException("Location request cancelled.", "AbortError"));
    if (typeof window === "undefined" || !navigator.geolocation)
      return reject(
        new LocationAcquisitionError(
          "This browser does not support location. Choose your destination manually.",
          "unsupported",
        ),
      );
    if (!window.isSecureContext)
      return reject(
        new LocationAcquisitionError(
          "Location requires HTTPS. Open the secure deployed site and try again.",
          "error",
        ),
      );

    let stop: (() => void) | undefined;
    let settled = false;
    let readings: GeolocationPosition[] = [];
    let lastReportedAccuracy: number | undefined;
    let refinement: ReturnType<typeof setTimeout> | undefined;
    let lastError: GeolocationPositionError | undefined;
    const bestReading = () => {
      readings = readings.filter((reading) => freshBrowserPosition(reading));
      return readings.reduce<GeolocationPosition | undefined>(
        (best, reading) =>
          !best ||
          reading.coords.accuracy < best.coords.accuracy ||
          (reading.coords.accuracy === best.coords.accuracy && reading.timestamp > best.timestamp)
            ? reading
            : best,
        undefined,
      );
    };
    const cleanup = () => {
      clearTimeout(deadline);
      clearTimeout(refinement);
      signal?.removeEventListener("abort", abort);
      stop?.();
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const finish = () => {
      const best = bestReading();
      if (settled || !best || !usableGPS(best)) return false;
      settled = true;
      cleanup();
      resolve(best); // Preserve the actual sample timestamp and reported accuracy.
      return true;
    };
    const abort = () => fail(new DOMException("Location request cancelled.", "AbortError"));
    const deadline = setTimeout(() => {
      if (finish()) return;
      const best = bestReading();
      if ((best?.coords.accuracy ?? lastReportedAccuracy ?? 0) > MAX_NAVIGATION_ACCURACY_M)
        fail(
          new LocationAcquisitionError(
            `Your browser supplied an approximate location (±${accuracyLabel(best?.coords.accuracy ?? lastReportedAccuracy!)}). Waiting did not produce the required ${MAX_NAVIGATION_ACCURACY_M} m accuracy. Enable precise location and retry, or choose your destination manually.`,
            "unavailable",
          ),
        );
      else if (lastError?.code === 2)
        fail(
          new LocationAcquisitionError(
            "Your browser could not determine your location. Check device location services, retry, or choose your destination manually.",
            "unavailable",
          ),
        );
      else
        fail(
          new LocationAcquisitionError(
            "Location timed out. Check the browser's location permission prompt, retry, or choose your destination manually.",
            "timeout",
          ),
        );
    }, timeoutMs);
    signal?.addEventListener("abort", abort, { once: true });
    const receive: PositionCallback = (position) => {
      if (settled || !freshBrowserPosition(position)) return;
      readings = readings.filter((reading) => freshBrowserPosition(reading)).slice(-99);
      readings.push(position);
      lastReportedAccuracy = position.coords.accuracy;
      const best = bestReading()!;
      if (usableGPS(best)) {
        onProgress?.(
          `Location found (±${accuracyLabel(best.coords.accuracy)}). Checking for a more accurate reading…`,
        );
        if (refinement === undefined)
          refinement = setTimeout(() => {
            refinement = undefined;
            finish();
          }, GPS_REFINEMENT_MS);
      } else
        onProgress?.(
          `Approximate location received (±${accuracyLabel(best.coords.accuracy)}). Waiting for a more accurate reading…`,
        );
    };
    const error: PositionErrorCallback = (reason) => {
      if (settled) return;
      lastError = reason;
      if (reason.code === 1)
        fail(
          new LocationAcquisitionError(
            "Location access is blocked. Allow location for this site and enable device location services, then retry.",
            "denied",
          ),
        );
      // Timeout/unavailable may recover on a subsequent watch update.
    };
    try {
      if (options.subscribe) stop = options.subscribe(receive, error);
      else {
        const id = navigator.geolocation.watchPosition(receive, error, {
          enableHighAccuracy: true,
          maximumAge: 0,
          timeout: timeoutMs,
        });
        stop = () => navigator.geolocation.clearWatch(id);
      }
      if (settled) stop(); // Also supports synchronous embedded-browser/test callbacks.
    } catch (reason) {
      fail(
        new LocationAcquisitionError(
          reason instanceof Error ? reason.message : "Could not request location.",
          "error",
        ),
      );
    }
  });
}
