/// <reference types="google.maps" />

import { useEffect, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { loadGoogleMaps } from "@/lib/google-maps-loader";
import { parseCoordinates } from "@/lib/coordinates";
import type { AdminStore } from "@/shared/shops/store-contracts";
import type { ServiceZone } from "@/shared/shops/store-contracts";

const INDIA_VIEW = { lat: 20.5937, lng: 78.9629 };

function pinColor(store: AdminStore) {
  if (["disabled", "suspended", "rejected"].includes(store.status ?? "")) return "#ef4444";
  if (!store.location_verified) return "#f59e0b";
  if (!store.accepts_orders) return "#64748b";
  return "#10b981";
}

export function AdminStoresMap({ stores }: { stores: AdminStore[] }) {
  const mapElement = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    const markers: google.maps.Marker[] = [];
    let map: google.maps.Map | null = null;
    let info: google.maps.InfoWindow | null = null;
    void loadGoogleMaps()
      .then((api) => {
        if (cancelled || !mapElement.current) return;
        map = new api.maps.Map(mapElement.current, {
          center: INDIA_VIEW,
          zoom: 5,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: true,
          clickableIcons: false,
        });
        info = new api.maps.InfoWindow();
        const bounds = new api.maps.LatLngBounds();
        stores.forEach((store) => {
          const point =
            store.resolved_location?.coordinates ??
            parseCoordinates(store.latitude, store.longitude);
          if (!point) return;
          const marker = new api.maps.Marker({
            map,
            position: point,
            title: store.name || "Store location",
            icon: {
              path: api.maps.SymbolPath.CIRCLE,
              fillColor: pinColor(store),
              fillOpacity: 1,
              strokeColor: "#ffffff",
              strokeWeight: 2,
              scale: 8,
            },
          });
          marker.addListener("click", () => {
            const container = document.createElement("div");
            container.className = "space-y-1 p-1 text-sm";
            const title = document.createElement("strong");
            title.textContent = store.name || "Unnamed store";
            const seller = document.createElement("div");
            seller.textContent =
              store.seller?.business_name ||
              store.seller?.full_name ||
              `Seller ${store.seller_id.slice(0, 8)}`;
            const address = document.createElement("div");
            address.textContent =
              [
                store.resolved_location?.address,
                store.resolved_location?.city,
                store.resolved_location?.state,
              ]
                .filter(Boolean)
                .join(", ") || "Address not set";
            const state = document.createElement("div");
            const radius = store.resolved_service_radius?.km ?? store.service_radius_km;
            state.textContent = `${store.status ?? "unknown"} · ${store.location_verified ? "verified" : "verification pending"} · ${radius == null ? "radius not set" : `${radius} km radius`}`;
            const link = document.createElement("a");
            link.href = `/admin/stores/${encodeURIComponent(store.id)}`;
            link.textContent = "View Store →";
            link.className = "font-semibold text-fuchsia-700";
            container.append(title, seller, address, state, link);
            info?.setContent(container);
            info?.open({ map, anchor: marker });
          });
          markers.push(marker);
          bounds.extend(point);
        });
        if (markers.length) {
          map.fitBounds(bounds);
          if (markers.length === 1) map.setZoom(15);
        }
        setLoading(false);
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "Google Maps could not load.");
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
      markers.forEach((marker) => marker.setMap(null));
      info?.close();
      map = null;
    };
  }, [stores]);

  return (
    <div className="space-y-2">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {loading && <p className="text-xs text-muted-foreground">Loading Google Maps…</p>}
      <div
        ref={mapElement}
        className="h-[min(68vh,640px)] min-h-80 w-full rounded-xl border bg-muted"
        role="region"
        aria-label="Map of LocalShore stores"
      />
      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span>● Active/verified</span>
        <span className="text-amber-600">● Verification pending</span>
        <span className="text-slate-500">● Offline</span>
        <span className="text-red-500">● Disabled</span>
      </div>
    </div>
  );
}

export function AdminServiceZonesMap({ zones }: { zones: ServiceZone[] }) {
  const mapElement = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    const circles: google.maps.Circle[] = [];
    const markers: google.maps.Marker[] = [];
    let map: google.maps.Map | null = null;
    void loadGoogleMaps()
      .then((api) => {
        if (cancelled || !mapElement.current) return;
        map = new api.maps.Map(mapElement.current, {
          center: INDIA_VIEW,
          zoom: 5,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: true,
          clickableIcons: false,
        });
        const bounds = new api.maps.LatLngBounds();
        for (const zone of zones) {
          const center = parseCoordinates(zone.latitude, zone.longitude);
          if (!center) continue;
          const color = zone.is_active ? "#a0009d" : "#94a3b8";
          const circle = new api.maps.Circle({
            map,
            center,
            radius: Math.max(0, Number(zone.radius_km)) * 1000,
            strokeColor: color,
            strokeOpacity: zone.is_active ? 0.8 : 0.45,
            strokeWeight: 2,
            fillColor: color,
            fillOpacity: zone.is_active ? 0.13 : 0.06,
          });
          const marker = new api.maps.Marker({
            map,
            position: center,
            title: `${zone.name}, ${zone.city}`,
          });
          circles.push(circle);
          markers.push(marker);
          bounds.union(circle.getBounds() ?? new api.maps.LatLngBounds(center, center));
        }
        if (markers.length) map.fitBounds(bounds);
      })
      .catch((cause: unknown) => {
        if (!cancelled)
          setError(cause instanceof Error ? cause.message : "Google Maps could not load.");
      });
    return () => {
      cancelled = true;
      circles.forEach((circle) => circle.setMap(null));
      markers.forEach((marker) => marker.setMap(null));
      map = null;
    };
  }, [zones]);
  return (
    <div className="space-y-2">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div
        ref={mapElement}
        className="h-80 w-full rounded-xl border bg-muted sm:h-[420px]"
        role="region"
        aria-label="Service zone radius map"
      />
    </div>
  );
}
