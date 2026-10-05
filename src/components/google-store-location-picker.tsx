/// <reference types="google.maps" />

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, LocateFixed, Loader2, MapPin, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { loadGoogleMaps } from "@/lib/google-maps-loader";
import type { Coordinates } from "@/lib/coordinates";

export interface GoogleAddressDetails {
  formattedAddress: string;
  city: string;
  state: string;
  pincode: string;
  placeId: string | null;
}

export interface GoogleLocationUpdate {
  coordinates: Coordinates;
  address: GoogleAddressDetails | null;
  pending: boolean;
}

interface Props {
  value: Coordinates | null;
  addressLabel?: string;
  onLocationChange: (update: GoogleLocationUpdate) => void;
  title?: string;
  description?: string;
  className?: string;
}

const DEFAULT_VIEWPORT: google.maps.LatLngLiteral = { lat: 20.5937, lng: 78.9629 };

function addressDetails(
  formattedAddress: string,
  components: Array<google.maps.GeocoderAddressComponent | google.maps.places.AddressComponent>,
  placeId?: string | null,
): GoogleAddressDetails {
  const component = (type: string) => {
    const part = components.find((item) => item.types.includes(type));
    if (!part) return "";
    return ("long_name" in part ? part.long_name : part.longText) ?? "";
  };
  const city =
    component("locality") ||
    component("postal_town") ||
    component("administrative_area_level_2") ||
    component("sublocality_level_1");

  return {
    formattedAddress,
    city,
    state: component("administrative_area_level_1"),
    pincode: component("postal_code"),
    placeId: placeId || null,
  };
}

export function GoogleStoreLocationPicker({
  value,
  addressLabel,
  onLocationChange,
  title = "Store Location",
  description = "Search your shop address, use GPS, or tap and drag the pin to your exact shop entrance.",
  className = "",
}: Props) {
  const mapElement = useRef<HTMLDivElement>(null);
  const searchElement = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markerRef = useRef<google.maps.Marker | null>(null);
  const geocoderRef = useRef<google.maps.Geocoder | null>(null);
  const autocompleteRef = useRef<google.maps.places.PlaceAutocompleteElement | null>(null);
  const addressRequestRef = useRef(0);
  const onChangeRef = useRef(onLocationChange);
  const initialValueRef = useRef(value);
  const [mapLoading, setMapLoading] = useState(true);
  const [mapError, setMapError] = useState("");
  const [retryAttempt, setRetryAttempt] = useState(0);
  const [locating, setLocating] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [selected, setSelected] = useState<Coordinates | null>(value);

  onChangeRef.current = onLocationChange;

  useEffect(() => {
    let cancelled = false;
    let clickListener: google.maps.MapsEventListener | undefined;
    let dragListener: google.maps.MapsEventListener | undefined;
    let placeListener: ((event: Event) => void) | undefined;

    const initialize = async (retry = false) => {
      setMapLoading(true);
      setMapError("");
      try {
        const googleApi = await loadGoogleMaps(retry);
        if (cancelled || !mapElement.current || !searchElement.current) return;

        const saved = initialValueRef.current;
        const map = new googleApi.maps.Map(mapElement.current, {
          center: saved ?? DEFAULT_VIEWPORT,
          zoom: saved ? 17 : 5,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: true,
          clickableIcons: false,
          gestureHandling: "greedy",
          mapTypeId: googleApi.maps.MapTypeId.ROADMAP,
        });
        mapRef.current = map;
        geocoderRef.current = new googleApi.maps.Geocoder();
        const marker = new googleApi.maps.Marker({
          map,
          position: saved ?? undefined,
          draggable: true,
          title: "Store entrance",
          animation: googleApi.maps.Animation.DROP,
        });
        markerRef.current = marker;

        const autocomplete = new googleApi.maps.places.PlaceAutocompleteElement({
          includedRegionCodes: ["in"],
        });
        autocomplete.placeholder = "Search your shop address";
        autocomplete.setAttribute("aria-label", "Search your shop address with Google Places");
        autocomplete.className = "google-place-autocomplete";
        searchElement.current.replaceChildren(autocomplete);
        autocompleteRef.current = autocomplete;

        const resolvePin = (point: Coordinates, selectedAddress?: GoogleAddressDetails) => {
          const requestId = ++addressRequestRef.current;
          marker.setPosition(point);
          map.panTo(point);
          map.setZoom(Math.max(map.getZoom() ?? 15, 17));
          setSelected(point);
          setMapError("");
          setResolving(true);
          onChangeRef.current({ coordinates: point, address: null, pending: true });

          if (selectedAddress) {
            setResolving(false);
            onChangeRef.current({
              coordinates: point,
              address: selectedAddress,
              pending: false,
            });
            return;
          }

          void geocoderRef.current
            ?.geocode({ location: point })
            .then(({ results }) => {
              if (cancelled || requestId !== addressRequestRef.current) return;
              const result = results.find((candidate) => candidate.address_components.length > 0);
              if (!result) throw new Error("Google Maps could not find an address at this pin.");
              setResolving(false);
              onChangeRef.current({
                coordinates: point,
                address: addressDetails(
                  result.formatted_address,
                  result.address_components,
                  result.place_id,
                ),
                pending: false,
              });
            })
            .catch((error: unknown) => {
              if (cancelled || requestId !== addressRequestRef.current) return;
              setResolving(false);
              const message =
                error instanceof Error ? error.message : "Could not look up this address.";
              setMapError(`${message} You can enter the address fields manually.`);
              onChangeRef.current({ coordinates: point, address: null, pending: false });
            });
        };

        clickListener = map.addListener("click", (event: google.maps.MapMouseEvent) => {
          if (event.latLng) resolvePin({ lat: event.latLng.lat(), lng: event.latLng.lng() });
        });
        dragListener = marker.addListener("dragend", () => {
          const position = marker.getPosition();
          if (position) resolvePin({ lat: position.lat(), lng: position.lng() });
        });
        placeListener = (event: Event) => {
          void (async () => {
            try {
              const selection = event as google.maps.places.PlacePredictionSelectEvent;
              const place = selection.placePrediction.toPlace();
              await place.fetchFields({
                fields: ["addressComponents", "formattedAddress", "location", "id"],
              });
              if (!place.location || !place.formattedAddress) {
                throw new Error("Choose a complete address from the Google suggestions.");
              }
              resolvePin(
                { lat: place.location.lat(), lng: place.location.lng() },
                addressDetails(place.formattedAddress, place.addressComponents ?? [], place.id),
              );
            } catch (error) {
              setMapError(
                error instanceof Error ? error.message : "Could not load the selected place.",
              );
            }
          })();
        };
        autocomplete.addEventListener("gmp-select", placeListener);
        map.addListener("idle", () => {
          autocomplete.locationBias = (map.getZoom() ?? 0) >= 10 ? (map.getBounds() ?? null) : null;
        });
        setMapLoading(false);
      } catch (error) {
        if (!cancelled) {
          setMapLoading(false);
          setMapError(error instanceof Error ? error.message : "Google Maps could not load.");
        }
      }
    };

    void initialize();
    return () => {
      cancelled = true;
      addressRequestRef.current += 1;
      clickListener?.remove();
      dragListener?.remove();
      if (autocompleteRef.current && placeListener)
        autocompleteRef.current.removeEventListener("gmp-select", placeListener);
      if (markerRef.current) google.maps.event.clearInstanceListeners(markerRef.current);
      if (mapRef.current) google.maps.event.clearInstanceListeners(mapRef.current);
      mapRef.current = null;
      markerRef.current = null;
      geocoderRef.current = null;
      autocompleteRef.current = null;
    };
  }, [retryAttempt]);

  useEffect(() => {
    const map = mapRef.current;
    const marker = markerRef.current;
    if (!map || !marker || !value) return;
    marker.setPosition(value);
    map.panTo(value);
    map.setZoom(Math.max(map.getZoom() ?? 15, 17));
    setSelected(value);
  }, [value?.lat, value?.lng]);

  const useCurrentLocation = () => {
    setMapError("");
    if (!navigator.geolocation) {
      setMapError(
        "This browser does not support device location. Search for your address instead.",
      );
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        const requestId = ++addressRequestRef.current;
        const point = { lat: position.coords.latitude, lng: position.coords.longitude };
        setAccuracy(position.coords.accuracy);
        const marker = markerRef.current;
        if (!marker || !mapRef.current) return;
        marker.setPosition(point);
        mapRef.current.panTo(point);
        mapRef.current.setZoom(18);
        setSelected(point);
        setResolving(true);
        onChangeRef.current({ coordinates: point, address: null, pending: true });
        void geocoderRef.current
          ?.geocode({ location: point })
          .then(({ results }) => {
            if (requestId !== addressRequestRef.current) return;
            const result = results.find((candidate) => candidate.address_components.length > 0);
            if (!result)
              throw new Error("Google Maps could not find an address at your GPS location.");
            setResolving(false);
            onChangeRef.current({
              coordinates: point,
              address: addressDetails(
                result.formatted_address,
                result.address_components,
                result.place_id,
              ),
              pending: false,
            });
          })
          .catch((error: unknown) => {
            if (requestId !== addressRequestRef.current) return;
            setResolving(false);
            setMapError(
              `${error instanceof Error ? error.message : "Could not look up the GPS address."} You can enter the address fields manually.`,
            );
            onChangeRef.current({ coordinates: point, address: null, pending: false });
          });
      },
      (error) => {
        setLocating(false);
        const message =
          error.code === error.PERMISSION_DENIED
            ? "Location permission was denied. Allow it in your browser settings or search for the shop address."
            : error.code === error.POSITION_UNAVAILABLE
              ? "Your device could not determine its location. Search for the shop address instead."
              : error.code === error.TIMEOUT
                ? "Getting your location took too long. Try again or search for the shop address."
                : "Could not get your current location. Search for the shop address instead.";
        setMapError(message);
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
    );
  };

  return (
    <section className={`space-y-3 ${className}`}>
      <div>
        <h3 className="font-semibold">{title}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <div ref={searchElement} className="google-place-autocomplete min-w-0 flex-1" />
        <Button
          type="button"
          variant="outline"
          className="shrink-0"
          onClick={useCurrentLocation}
          disabled={locating || mapLoading || !mapRef.current}
        >
          {locating ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <LocateFixed className="h-4 w-4" />
          )}
          Use My Current Location
        </Button>
      </div>
      <div className="relative h-72 overflow-hidden rounded-xl border bg-muted sm:h-80">
        <div
          ref={mapElement}
          className="h-full w-full"
          aria-label="Google map for store location"
        />
        {mapLoading && (
          <div className="absolute inset-0 grid place-items-center bg-background/80 text-sm text-muted-foreground">
            <span>
              <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
              Loading Google Maps…
            </span>
          </div>
        )}
        {mapError && !mapLoading && !mapRef.current && (
          <div className="absolute inset-0 grid place-items-center bg-background/95 p-5 text-center">
            <div className="max-w-md">
              <AlertTriangle className="mx-auto h-6 w-6 text-destructive" />
              <p className="mt-2 text-sm font-medium">Google Maps unavailable</p>
              <p className="mt-1 text-xs text-muted-foreground">{mapError}</p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mt-3"
                onClick={() => setRetryAttempt((attempt) => attempt + 1)}
              >
                <RefreshCw className="h-3.5 w-3.5" /> Retry
              </Button>
            </div>
          </div>
        )}
      </div>
      <div className="flex flex-col gap-1 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <span>Tap the map or drag the pin to your exact shop entrance.</span>
        {resolving ? (
          <span className="inline-flex items-center gap-1 text-primary">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Updating address…
          </span>
        ) : selected ? (
          <span className="inline-flex items-center gap-1 font-mono">
            <MapPin className="h-3.5 w-3.5 text-primary" />
            {selected.lat.toFixed(6)}, {selected.lng.toFixed(6)}
          </span>
        ) : (
          <span>No location selected yet.</span>
        )}
      </div>
      {accuracy !== null && (
        <p className="text-xs text-muted-foreground">
          GPS estimate accuracy ±{Math.round(accuracy)} m. Adjust the pin to the shop entrance
          before confirming.
        </p>
      )}
      {mapError && mapRef.current && (
        <p role="status" className="text-xs text-amber-700">
          {mapError}
        </p>
      )}
    </section>
  );
}
