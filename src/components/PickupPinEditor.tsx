import { useEffect, useRef, useState } from "react";
import { parseCoordinates, type Coordinates } from "@/lib/coordinates";
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
  const marker = useRef<import("leaflet").CircleMarker | null>(null);
  const leaflet = useRef<typeof import("leaflet") | null>(null);
  const change = useRef(onChange);
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
      instance.on("click", (event) =>
        change.current({ lat: event.latlng.lat, lng: event.latlng.lng }),
      );
      observer = new ResizeObserver(() => instance.invalidateSize());
      observer.observe(container.current);
      setReady(true);
    })().catch(() => {
      if (alive)
        setMessage("Map unavailable. Use your location or enter the pickup coordinates below.");
    });
    return () => {
      alive = false;
      observer?.disconnect();
      map.current?.remove();
      map.current = null;
      marker.current = null;
    };
  }, []);
  useEffect(() => {
    if (!ready || !map.current || !leaflet.current) return;
    if (marker.current) {
      marker.current.remove();
      marker.current = null;
    }
    if (value) {
      marker.current = leaflet.current
        .circleMarker([value.lat, value.lng], { radius: 9, color: "#7c3aed", fillOpacity: 1 })
        .addTo(map.current);
      map.current.setView([value.lat, value.lng], 17);
    }
  }, [ready, value?.lat, value?.lng]);
  const locate = () => {
    if (!navigator.geolocation) {
      setMessage("Location is unavailable in this browser.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        const pin = parseCoordinates(position.coords.latitude, position.coords.longitude);
        if (!pin) {
          setMessage("Could not determine valid coordinates.");
          return;
        }
        change.current(pin);
        if (position.coords.accuracy > 100) {
          setMessage(
            `Location pin set (accuracy ±${Math.round(position.coords.accuracy)}m). Tap the exact pickup entrance on the map if needed.`
          );
        } else {
          setMessage("Pin set from current location! Tap the map to adjust if needed.");
        }
      },
      (error) => {
        setLocating(false);
        setMessage(
          `Location access error (${error.message || "permission denied"}). Please tap the exact entrance on the map or enter coordinates manually.`
        );
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
    );
  };
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  return (
    <section className="space-y-3 rounded-xl border p-4">
      <h3 className="font-semibold">Exact pickup entrance</h3>
      <p className="text-sm text-muted-foreground">
        Tap the map where the rider should collect orders. Changing the address clears its pin.
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
