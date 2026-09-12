import { acquireCurrentPosition, accuracyLabel } from "@/lib/acquire-location";
import { useEffect, useRef, useState } from "react";
import { parseCoordinates, usableGPS, type Coordinates } from "@/lib/coordinates";
import { Button } from "@/components/ui/button";

export function PickupPinEditor({
  value,
  onChange,
}: {
  value: Coordinates | null;
  onChange: (pin: Coordinates) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<import("leaflet").Map | null>(null);
  const marker = useRef<import("leaflet").Marker | null>(null);
  const leaflet = useRef<typeof import("leaflet") | null>(null);
  const change = useRef(onChange);
  const requestRevision = useRef(0);
  const acquisition = useRef<AbortController | null>(null);
  const accuracyCircle = useRef<import("leaflet").Circle | null>(null);
  const [gpsFix, setGpsFix] = useState<(Coordinates & { accuracy: number }) | null>(null);
  change.current = onChange;
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState("");
  const [locating, setLocating] = useState(false);
  useEffect(() => {
    let alive = true;
    let observer: ResizeObserver | undefined;
    void (async () => {
      const L = await import("leaflet");
      await import("leaflet/dist/leaflet.css");
      if (!alive || !container.current) return;
      leaflet.current = L;
      const instance = L.map(container.current).setView(
        value ? [value.lat, value.lng] : [20, 78],
        value ? 17 : 4,
      );
      map.current = instance;
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "© OpenStreetMap contributors",
      }).addTo(instance);
      instance.on("click", (event) => {
        requestRevision.current++;
        acquisition.current?.abort();
        setGpsFix(null);
        setLocating(false);
        setMessage("Check the manually selected pickup entrance before saving.");
        change.current({ lat: event.latlng.lat, lng: event.latlng.lng });
      });
      observer = new ResizeObserver(() => instance.invalidateSize());
      observer.observe(container.current);
      setReady(true);
    })().catch(() => {
      if (alive)
        setMessage("Map unavailable. Use your location or enter the pickup coordinates below.");
    });
    return () => {
      alive = false;
      requestRevision.current++;
      acquisition.current?.abort();
      observer?.disconnect();
      map.current?.remove();
      map.current = null;
      marker.current = null;
    };
  }, []);
  useEffect(() => {
    requestRevision.current++;
    acquisition.current?.abort();
    setLocating(false);
    setGpsFix((current) =>
      current && value && current.lat === value.lat && current.lng === value.lng ? current : null,
    );
  }, [value?.lat, value?.lng]);
  useEffect(() => {
    if (!ready || !map.current || !leaflet.current) return;
    if (marker.current) {
      marker.current.remove();
      marker.current = null;
    }
    if (value) {
      const pinMarker = leaflet.current
        .marker([value.lat, value.lng], {
          draggable: true,
          icon: leaflet.current.divIcon({
            className: "pickup-entrance-pin",
            html: '<div style="width:18px;height:18px;border-radius:50%;background:#7c3aed;border:3px solid white;box-shadow:0 1px 5px #333"></div>',
            iconSize: [18, 18],
            iconAnchor: [9, 9],
          }),
        })
        .addTo(map.current);
      pinMarker.on("dragstart", () => {
        requestRevision.current++;
        acquisition.current?.abort();
        setLocating(false);
        setGpsFix(null);
      });
      pinMarker.on("dragend", () => {
        const pin = pinMarker.getLatLng();
        change.current({ lat: pin.lat, lng: pin.lng });
        setMessage("Check the manually selected pickup entrance before saving.");
      });
      marker.current = pinMarker;
      map.current.setView([value.lat, value.lng], 17);
    }
  }, [ready, value?.lat, value?.lng]);
  useEffect(() => {
    accuracyCircle.current?.remove();
    accuracyCircle.current = null;
    if (
      !ready ||
      !map.current ||
      !leaflet.current ||
      !value ||
      !gpsFix ||
      gpsFix.lat !== value.lat ||
      gpsFix.lng !== value.lng
    )
      return;
    accuracyCircle.current = leaflet.current
      .circle([gpsFix.lat, gpsFix.lng], {
        className: "gps-accuracy-circle",
        radius: gpsFix.accuracy,
        color: "#7c3aed",
        weight: 1,
        fillOpacity: 0.12,
        interactive: false,
      })
      .addTo(map.current);
    return () => {
      accuracyCircle.current?.remove();
      accuracyCircle.current = null;
    };
  }, [ready, value?.lat, value?.lng, gpsFix]);

  const locate = () => {
    acquisition.current?.abort();
    const controller = new AbortController();
    acquisition.current = controller;
    setLocating(true);
    setMessage("Waiting for precise device location…");
    const request = ++requestRevision.current;
    void acquireCurrentPosition({
      signal: controller.signal,
      onProgress: (message) => {
        if (request === requestRevision.current) setMessage(message);
      },
    })
      .then((position) => {
        if (request !== requestRevision.current || controller.signal.aborted) return;
        const pin = parseCoordinates(position.coords.latitude, position.coords.longitude);
        if (!pin || !usableGPS(position)) return;
        setLocating(false);
        setGpsFix({ ...pin, accuracy: position.coords.accuracy });
        change.current(pin);
        setMessage(
          `Device accuracy ±${accuracyLabel(position.coords.accuracy)}. Check the pickup entrance before saving.`,
        );
      })
      .catch((error) => {
        if (request !== requestRevision.current || controller.signal.aborted) return;
        setLocating(false);
        setMessage(error instanceof Error ? error.message : "Precise location unavailable. Retry.");
      });
  };
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  return (
    <section className="space-y-3 rounded-xl border p-4">
      <h3 className="font-semibold">Exact pickup entrance</h3>
      <p className="text-sm text-muted-foreground">
        Tap the map or drag the pin where the rider should collect orders. Changing the address
        clears its pin.
      </p>
      <Button type="button" variant="outline" disabled={locating} onClick={locate}>
        {locating ? "Locating…" : "Use my current location"}
      </Button>
      <div ref={container} className="h-72 rounded-lg relative z-0" />
      <p className="text-sm">
        {value
          ? `Pickup pin: ${value.lat.toFixed(6)}, ${value.lng.toFixed(6)}`
          : "No pickup pin selected yet."}
      </p>
      <details>
        <summary className="cursor-pointer text-sm">
          Enter coordinates from an existing map pin
        </summary>
        <div className="flex flex-wrap gap-2 mt-2">
          <input
            aria-label="Pickup latitude"
            placeholder="Latitude"
            value={latitude}
            onChange={(e) => setLatitude(e.target.value)}
            className="border rounded p-2 w-36"
          />
          <input
            aria-label="Pickup longitude"
            placeholder="Longitude"
            value={longitude}
            onChange={(e) => setLongitude(e.target.value)}
            className="border rounded p-2 w-36"
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              const pin = parseCoordinates(latitude, longitude);
              if (pin) {
                requestRevision.current++;
                acquisition.current?.abort();
                setLocating(false);
                setGpsFix(null);
                change.current(pin);
                setMessage("");
              } else setMessage("Enter valid latitude and longitude.");
            }}
          >
            Set pin
          </Button>
        </div>
      </details>
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
    </section>
  );
}
