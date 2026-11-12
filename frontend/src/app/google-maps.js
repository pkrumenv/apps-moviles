let mapsLoader;

export function loadGoogleMaps(key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY) {
  if (window.google?.maps) return Promise.resolve(window.google.maps);
  if (!key) return Promise.reject(new Error("Configura VITE_GOOGLE_MAPS_API_KEY para usar Google Maps."));
  if (mapsLoader) return mapsLoader;

  mapsLoader = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    const callback = `mapsReady_${Math.random().toString(36).slice(2)}`;
    window[callback] = () => {
      delete window[callback];
      if (window.google?.maps) resolve(window.google.maps);
      else { mapsLoader = null; reject(new Error("Google Maps no respondió correctamente.")); }
    };
    script.async = true;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&callback=${callback}&v=weekly`;
    script.onerror = () => {
      delete window[callback];
      mapsLoader = null;
      reject(new Error("No se pudo cargar Google Maps. Revisa la clave y sus restricciones."));
    };
    document.head.appendChild(script);
  });
  return mapsLoader;
}
