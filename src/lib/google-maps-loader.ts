/// <reference types="google.maps" />

declare global {
  interface Window {
    google?: typeof google;
    __localshoreSellerMapsInit?: () => void;
    gm_authFailure?: () => void;
  }
}

let mapsPromise: Promise<typeof google> | null = null;

export function loadGoogleMaps(retry = false): Promise<typeof google> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Google Maps can only load in the browser."));
  }
  if (window.google?.maps?.places) return Promise.resolve(window.google);
  if (mapsPromise && !retry) return mapsPromise;
  mapsPromise = null;

  const env = import.meta.env as ImportMetaEnv & {
    VITE_GOOGLE_MAPS_API_KEY?: string;
    VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY?: string;
    VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_TRACKING_ID?: string;
  };
  const key = env.VITE_GOOGLE_MAPS_API_KEY || env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY;
  const channel = env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_TRACKING_ID;
  if (!key)
    return Promise.reject(new Error("Google Maps key missing. Set VITE_GOOGLE_MAPS_API_KEY."));

  mapsPromise = new Promise((resolve, reject) => {
    const callbackName = "__localshoreSellerMapsInit";
    const cleanup = () => {
      delete window[callbackName];
      if (window.gm_authFailure === onAuthFailure) delete window.gm_authFailure;
    };
    const fail = (message: string) => {
      cleanup();
      mapsPromise = null;
      reject(new Error(message));
    };
    const onAuthFailure = () =>
      fail("Google Maps rejected this domain. Check the browser key's website restrictions.");

    window.gm_authFailure = onAuthFailure;
    window[callbackName] = () => {
      if (window.google?.maps?.places) {
        cleanup();
        resolve(window.google);
      } else {
        fail("Google Maps loaded without the Places library.");
      }
    };

    const script = document.createElement("script");
    const params = new URLSearchParams({
      key,
      loading: "async",
      callback: callbackName,
      libraries: "places",
      v: "weekly",
    });
    if (channel) params.set("channel", channel);
    script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
    script.async = true;
    script.dataset.localshoreSellerMaps = "true";
    script.onerror = () => fail("Google Maps could not load. Check your network and API key.");
    document.head.appendChild(script);
  });

  return mapsPromise;
}
